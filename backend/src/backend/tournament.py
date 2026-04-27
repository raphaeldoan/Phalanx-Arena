from __future__ import annotations

import argparse
import inspect
import json
import shutil
import sys
from collections import defaultdict
from concurrent.futures import Executor, ProcessPoolExecutor, ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from itertools import combinations
from pathlib import Path
from typing import Callable, Sequence, TextIO

from .ai_common import AiDecisionError
from .battle_reports import default_tournament_battle_report_dir, write_match_battle_report
from .headless import (
    DEFAULT_MAX_ACTIONS,
    HEADLESS_BENCHMARK_PROFILE,
    CommanderSpec,
    MatchResult,
    UsageTotals,
    build_commander,
    resolve_provider,
    run_headless_match,
)
from .models import AiInputMode, ArmyId, ReplayData

TOURNAMENT_SCENARIO_ID = "classic_battle"
DEFAULT_SEED_PAIRS = 3
MATCHES_PER_SEED_PAIR = 4


def other_army(army: ArmyId) -> ArmyId:
    return ArmyId.B if army == ArmyId.A else ArmyId.A


def battle_score_total(match: MatchResult, army: ArmyId) -> int:
    for score in match.battle_scores:
        if score.get("army") == army:
            total = score.get("total")
            if isinstance(total, int):
                return total
    return 0


def match_points_for_army(match: MatchResult, army: ArmyId) -> float:
    if not match.finished or match.winner is None:
        return 0.5
    return 1.0 if match.winner == army else 0.0


def winner_by_summary_metrics(
    summary_by_label: dict[str, dict[str, object]],
    competitor_labels: tuple[str, str],
    metrics: Sequence[str],
) -> str | None:
    left_label, right_label = competitor_labels
    for metric in metrics:
        left_value = summary_by_label[left_label].get(metric)
        right_value = summary_by_label[right_label].get(metric)
        if not isinstance(left_value, (int, float)) or not isinstance(right_value, (int, float)):
            continue
        if left_value > right_value:
            return left_label
        if right_value > left_value:
            return right_label
    return None


@dataclass(frozen=True, slots=True)
class ResolvedCompetitor:
    spec: CommanderSpec
    provider: str


@dataclass(frozen=True, slots=True)
class ScheduledMatch:
    seed_pair_index: int
    seed_match_index: int
    match_index: int
    seed: int
    army_a: ResolvedCompetitor
    army_b: ResolvedCompetitor
    deployment_first_army: ArmyId
    first_bound_army: ArmyId


@dataclass(slots=True)
class SeedPairResult:
    seed_pair_index: int
    seed: int
    winner: str | None
    summary_by_label: dict[str, dict[str, object]]
    matches: list[MatchResult]

    def to_dict(self) -> dict[str, object]:
        return {
            "seed_pair_index": self.seed_pair_index,
            "seed": self.seed,
            "winner": self.winner,
            "summary": self.summary_by_label,
            "matches": [match.to_dict() for match in self.matches],
        }


@dataclass(slots=True)
class PairingResult:
    pairing_index: int
    scenario_id: str
    competitor_labels: tuple[str, str]
    competitor_models: dict[str, str]
    competitor_providers: dict[str, str]
    seed_pair_count: int
    majority_threshold: int
    winner: str | None
    summary_by_label: dict[str, dict[str, object]]
    seed_pairs: list[SeedPairResult]

    def to_dict(self) -> dict[str, object]:
        return {
            "pairing_index": self.pairing_index,
            "scenario_id": self.scenario_id,
            "seed_pair_count": self.seed_pair_count,
            "majority_threshold": self.majority_threshold,
            "winner": self.winner,
            "competitors": [
                {
                    "label": label,
                    "model": self.competitor_models[label],
                    "provider": self.competitor_providers[label],
                }
                for label in self.competitor_labels
            ],
            "summary": self.summary_by_label,
            "seed_pairs": [seed_pair.to_dict() for seed_pair in self.seed_pairs],
        }


@dataclass(slots=True)
class CompetitorStats:
    spec: CommanderSpec
    provider: str
    games: int = 0
    game_points: float = 0.0
    wins: int = 0
    losses: int = 0
    draws: int = 0
    unfinished: int = 0
    pairing_wins: int = 0
    pairing_losses: int = 0
    pairing_ties: int = 0
    seed_pair_wins: int = 0
    seed_pair_losses: int = 0
    seed_pair_ties: int = 0
    games_as_a: int = 0
    games_as_b: int = 0
    wins_as_a: int = 0
    wins_as_b: int = 0
    battle_score_differential: int = 0
    usage: UsageTotals = field(default_factory=UsageTotals)

    def add_match(self, match: MatchResult, army: ArmyId) -> None:
        self.games += 1
        self.game_points += match_points_for_army(match, army)
        if army == ArmyId.A:
            self.games_as_a += 1
        else:
            self.games_as_b += 1

        if not match.finished:
            self.unfinished += 1
        elif match.winner is None:
            self.draws += 1
        elif match.winner == army:
            self.wins += 1
            if army == ArmyId.A:
                self.wins_as_a += 1
            else:
                self.wins_as_b += 1
        else:
            self.losses += 1

        self.battle_score_differential += battle_score_total(match, army) - battle_score_total(match, other_army(army))
        self.usage.merge(match.usage_by_army[army])

    def average_battle_score_differential(self) -> float | None:
        if self.games < 1:
            return None
        return self.battle_score_differential / self.games


@dataclass(slots=True)
class TournamentStanding:
    rank: int
    label: str
    model: str
    provider: str
    games: int
    game_points: float
    wins: int
    losses: int
    draws: int
    unfinished: int
    pairing_wins: int
    pairing_losses: int
    pairing_ties: int
    seed_pair_wins: int
    seed_pair_losses: int
    seed_pair_ties: int
    games_as_a: int
    games_as_b: int
    wins_as_a: int
    wins_as_b: int
    head_to_head_game_points: float
    head_to_head_seed_pair_wins: int
    battle_score_differential: int
    average_battle_score_differential: float | None
    average_tokens_per_game: float | None
    average_cost_usd_per_game: float | None
    cost_per_win: float | None
    usage: dict[str, object]

    def to_dict(self) -> dict[str, object]:
        return {
            "rank": self.rank,
            "label": self.label,
            "model": self.model,
            "provider": self.provider,
            "games": self.games,
            "game_points": self.game_points,
            "wins": self.wins,
            "losses": self.losses,
            "draws": self.draws,
            "unfinished": self.unfinished,
            "pairing_wins": self.pairing_wins,
            "pairing_losses": self.pairing_losses,
            "pairing_ties": self.pairing_ties,
            "seed_pair_wins": self.seed_pair_wins,
            "seed_pair_losses": self.seed_pair_losses,
            "seed_pair_ties": self.seed_pair_ties,
            "games_as_a": self.games_as_a,
            "games_as_b": self.games_as_b,
            "wins_as_a": self.wins_as_a,
            "wins_as_b": self.wins_as_b,
            "head_to_head_game_points": self.head_to_head_game_points,
            "head_to_head_seed_pair_wins": self.head_to_head_seed_pair_wins,
            "battle_score_differential": self.battle_score_differential,
            "average_battle_score_differential": self.average_battle_score_differential,
            "average_tokens_per_game": self.average_tokens_per_game,
            "average_cost_usd_per_game": self.average_cost_usd_per_game,
            "cost_per_win": self.cost_per_win,
            "usage": self.usage,
        }


@dataclass(slots=True)
class TournamentResult:
    scenario_id: str
    benchmark_profile: str
    include_rationale: bool
    max_actions: int
    seed_start: int
    seed_pairs: int
    competitors: list[dict[str, object]]
    standings: list[TournamentStanding]
    pairings: list[PairingResult]
    battle_reports_dir: str | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "scenario_id": self.scenario_id,
            "benchmark_profile": self.benchmark_profile,
            "include_rationale": self.include_rationale,
            "max_actions": self.max_actions,
            "seed_start": self.seed_start,
            "seed_pairs": self.seed_pairs,
            "pairings_count": len(self.pairings),
            "games_per_pairing": self.seed_pairs * MATCHES_PER_SEED_PAIR,
            "total_games": len(self.pairings) * self.seed_pairs * MATCHES_PER_SEED_PAIR,
            "competitors": self.competitors,
            "standings": [standing.to_dict() for standing in self.standings],
            "side_summary": build_side_summary(self.pairings),
            "role_summary": build_role_summary(self.pairings),
            "pairings": [pairing.to_dict() for pairing in self.pairings],
            "battle_reports_dir": self.battle_reports_dir,
        }


def coerce_int(value: object, *, default: int = 0) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return default
    return default


def coerce_float(value: object, *, default: float = 0.0) -> float:
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return default
    return default


def parse_army(value: object) -> ArmyId | None:
    if value is None:
        return None
    try:
        return ArmyId(str(value))
    except ValueError:
        return None


def usage_totals_from_dict(payload: object) -> UsageTotals:
    if not isinstance(payload, dict):
        return UsageTotals()
    priced_turns = coerce_int(payload.get("priced_turns"))
    total_cost_usd = coerce_float(payload.get("total_cost_usd")) if priced_turns else 0.0
    return UsageTotals(
        turns=coerce_int(payload.get("turns")),
        tracked_turns=coerce_int(payload.get("tracked_turns")),
        priced_turns=priced_turns,
        input_tokens=coerce_int(payload.get("input_tokens")),
        output_tokens=coerce_int(payload.get("output_tokens")),
        total_tokens=coerce_int(payload.get("total_tokens")),
        cached_input_tokens=coerce_int(payload.get("cached_input_tokens")),
        reasoning_tokens=coerce_int(payload.get("reasoning_tokens")),
        total_cost_usd=total_cost_usd,
    )


def match_result_from_dict(payload: object) -> MatchResult:
    if not isinstance(payload, dict):
        raise ValueError("Saved match payload must be an object.")

    commander_labels_payload = payload.get("commander_labels")
    commander_models_payload = payload.get("commander_models")
    usage_payload = payload.get("usage_by_army")
    replay_payload = payload.get("replay")

    if not isinstance(commander_labels_payload, dict) or not isinstance(commander_models_payload, dict):
        raise ValueError("Saved match payload is missing commander metadata.")
    if not isinstance(usage_payload, dict):
        raise ValueError("Saved match payload is missing usage metadata.")

    commander_labels = {
        army: str(commander_labels_payload.get(army.value) or "")
        for army in (ArmyId.A, ArmyId.B)
    }
    commander_models = {
        army: str(commander_models_payload.get(army.value) or "")
        for army in (ArmyId.A, ArmyId.B)
    }
    usage_by_army = {
        army: usage_totals_from_dict(usage_payload.get(army.value))
        for army in (ArmyId.A, ArmyId.B)
    }

    winner = parse_army(payload.get("winner"))
    input_mode = AiInputMode(str(payload.get("input_mode") or AiInputMode.TEXT_ONLY))
    replay = ReplayData.model_validate(replay_payload if replay_payload is not None else {})

    return MatchResult(
        match_index=coerce_int(payload.get("match_index")),
        scenario_id=str(payload.get("scenario_id") or TOURNAMENT_SCENARIO_ID),
        seed=coerce_int(payload.get("seed")),
        input_mode=input_mode,
        commander_labels=commander_labels,
        commander_models=commander_models,
        winner=winner,
        winner_reason=str(payload.get("winner_reason")) if payload.get("winner_reason") is not None else None,
        finished=bool(payload.get("finished")),
        max_actions_reached=bool(payload.get("max_actions_reached")),
        bound_number=coerce_int(payload.get("bound_number")),
        action_count=coerce_int(payload.get("action_count")),
        battle_scores=list(payload.get("battle_scores") or []),
        attrition_status=list(payload.get("attrition_status") or []),
        usage_by_army=usage_by_army,
        replay=replay,
        battle_report_path=str(payload.get("battle_report_path")) if payload.get("battle_report_path") is not None else None,
    )


def seed_pair_result_from_dict(payload: object) -> SeedPairResult:
    if not isinstance(payload, dict):
        raise ValueError("Saved seed-pair payload must be an object.")
    matches_payload = payload.get("matches")
    if not isinstance(matches_payload, list):
        raise ValueError("Saved seed-pair payload is missing matches.")
    winner = payload.get("winner")
    return SeedPairResult(
        seed_pair_index=coerce_int(payload.get("seed_pair_index")),
        seed=coerce_int(payload.get("seed")),
        winner=str(winner) if winner is not None else None,
        summary_by_label=dict(payload.get("summary") or {}),
        matches=[match_result_from_dict(match_payload) for match_payload in matches_payload],
    )


def pairing_result_from_dict(payload: object) -> PairingResult:
    if not isinstance(payload, dict):
        raise ValueError("Saved pairing payload must be an object.")

    competitors_payload = payload.get("competitors")
    seed_pairs_payload = payload.get("seed_pairs")
    if not isinstance(competitors_payload, list) or len(competitors_payload) != 2:
        raise ValueError("Saved pairing payload must contain exactly two competitors.")
    if not isinstance(seed_pairs_payload, list):
        raise ValueError("Saved pairing payload is missing seed pairs.")

    competitor_labels: list[str] = []
    competitor_models: dict[str, str] = {}
    competitor_providers: dict[str, str] = {}
    for competitor_payload in competitors_payload:
        if not isinstance(competitor_payload, dict):
            raise ValueError("Saved pairing competitor entries must be objects.")
        label = str(competitor_payload.get("label") or "")
        if not label:
            raise ValueError("Saved pairing competitor entries must include a label.")
        competitor_labels.append(label)
        competitor_models[label] = str(competitor_payload.get("model") or "")
        competitor_providers[label] = str(competitor_payload.get("provider") or "")

    winner = payload.get("winner")
    return PairingResult(
        pairing_index=coerce_int(payload.get("pairing_index")),
        scenario_id=str(payload.get("scenario_id") or TOURNAMENT_SCENARIO_ID),
        competitor_labels=(competitor_labels[0], competitor_labels[1]),
        competitor_models=competitor_models,
        competitor_providers=competitor_providers,
        seed_pair_count=coerce_int(payload.get("seed_pair_count"), default=len(seed_pairs_payload)),
        majority_threshold=coerce_int(payload.get("majority_threshold")),
        winner=str(winner) if winner is not None else None,
        summary_by_label=dict(payload.get("summary") or {}),
        seed_pairs=[seed_pair_result_from_dict(seed_pair_payload) for seed_pair_payload in seed_pairs_payload],
    )


def ordered_pairings(pairings_by_index: dict[int, PairingResult]) -> list[PairingResult]:
    return [pairings_by_index[index] for index in sorted(pairings_by_index)]


def build_tournament_result(
    *,
    resolved_competitors: Sequence[ResolvedCompetitor],
    pairings: Sequence[PairingResult],
    include_rationale: bool,
    max_actions: int,
    seed_start: int,
    seed_pair_count: int,
    standings: list[TournamentStanding] | None = None,
) -> TournamentResult:
    standings = standings if standings is not None else build_standings(resolved_competitors, pairings)
    return TournamentResult(
        scenario_id=TOURNAMENT_SCENARIO_ID,
        benchmark_profile=HEADLESS_BENCHMARK_PROFILE,
        include_rationale=include_rationale,
        max_actions=max_actions,
        seed_start=seed_start,
        seed_pairs=seed_pair_count,
        competitors=[
            {
                "label": competitor.spec.label,
                "model": competitor.spec.model,
                "provider": competitor.provider,
            }
            for competitor in resolved_competitors
        ],
        standings=standings,
        pairings=list(pairings),
    )


def write_tournament_snapshot(tournament: TournamentResult, *, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_json_payload(output_path, tournament.to_dict())


def write_json_payload(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f"{path.name}.tmp")
    temp_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temp_path.replace(path)


def tournament_checkpoint_dir(output_path: Path) -> Path:
    return output_path.parent / f"{output_path.stem}-checkpoints"


def pairing_checkpoint_path(output_path: Path, *, pairing_index: int) -> Path:
    return tournament_checkpoint_dir(output_path) / f"pairing-{pairing_index:03d}.json"


def clear_tournament_checkpoints(output_path: Path) -> None:
    checkpoint_dir = tournament_checkpoint_dir(output_path)
    if checkpoint_dir.exists():
        shutil.rmtree(checkpoint_dir)


def remove_empty_tournament_checkpoint_dir(output_path: Path) -> None:
    checkpoint_dir = tournament_checkpoint_dir(output_path)
    if checkpoint_dir.exists() and not any(checkpoint_dir.iterdir()):
        checkpoint_dir.rmdir()


def write_pairing_checkpoint(pairing: PairingResult, *, output_path: Path) -> None:
    write_json_payload(pairing_checkpoint_path(output_path, pairing_index=pairing.pairing_index), pairing.to_dict())


def remove_pairing_checkpoint(output_path: Path, *, pairing_index: int) -> None:
    checkpoint_path = pairing_checkpoint_path(output_path, pairing_index=pairing_index)
    if checkpoint_path.exists():
        checkpoint_path.unlink()


def pairing_match_count(pairing: PairingResult) -> int:
    return sum(len(seed_pair.matches) for seed_pair in pairing.seed_pairs)


def is_pairing_complete(pairing: PairingResult, *, seed_pair_count: int) -> bool:
    return pairing_match_count(pairing) >= seed_pair_count * MATCHES_PER_SEED_PAIR


def normalize_skip_values(values: Sequence[str] | None) -> set[str]:
    if values is None:
        return set()
    return {value.strip().casefold() for value in values if value.strip()}


def pairing_matches_skip_filters(
    left: ResolvedCompetitor,
    right: ResolvedCompetitor,
    *,
    skip_labels: set[str],
    skip_providers: set[str],
) -> bool:
    labels = {left.spec.label.casefold(), right.spec.label.casefold()}
    providers = {left.provider.casefold(), right.provider.casefold()}
    return bool(labels & skip_labels or providers & skip_providers)


def pairing_scheduler_labels(pairing: tuple[int, ResolvedCompetitor, ResolvedCompetitor]) -> tuple[str, str]:
    _, left, right = pairing
    return left.spec.label, right.spec.label


def pop_next_balanced_pairing(
    pending_pairings: list[tuple[int, ResolvedCompetitor, ResolvedCompetitor]],
    *,
    active_label_counts: dict[str, int],
) -> tuple[int, ResolvedCompetitor, ResolvedCompetitor]:
    if not pending_pairings:
        raise ValueError("No pending pairings to schedule.")

    best_index = 0
    best_key: tuple[int, int, int, int] | None = None
    for index, pairing in enumerate(pending_pairings):
        left_label, right_label = pairing_scheduler_labels(pairing)
        left_active = active_label_counts.get(left_label, 0)
        right_active = active_label_counts.get(right_label, 0)
        key = (
            int(left_active > 0) + int(right_active > 0),
            left_active + right_active,
            max(left_active, right_active),
            index,
        )
        if best_key is None or key < best_key:
            best_key = key
            best_index = index

    return pending_pairings.pop(best_index)


def update_active_pairing_labels(
    active_label_counts: dict[str, int],
    pairing: tuple[int, ResolvedCompetitor, ResolvedCompetitor],
    *,
    delta: int,
) -> None:
    for label in pairing_scheduler_labels(pairing):
        new_value = active_label_counts.get(label, 0) + delta
        if new_value <= 0:
            active_label_counts.pop(label, None)
        else:
            active_label_counts[label] = new_value


def load_resumed_pairings(
    output_path: Path,
    *,
    resolved_competitors: Sequence[ResolvedCompetitor],
    include_rationale: bool,
    max_actions: int,
    seed_start: int,
    seed_pair_count: int,
) -> list[PairingResult]:
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Tournament snapshot must be a JSON object.")

    expected_competitors = [
        {
            "label": competitor.spec.label,
            "model": competitor.spec.model,
            "provider": competitor.provider,
        }
        for competitor in resolved_competitors
    ]

    if payload.get("scenario_id") != TOURNAMENT_SCENARIO_ID:
        raise ValueError("Tournament snapshot scenario does not match the classic_battle runner.")
    if payload.get("benchmark_profile") != HEADLESS_BENCHMARK_PROFILE:
        raise ValueError("Tournament snapshot benchmark profile does not match this runner.")
    if bool(payload.get("include_rationale")) != include_rationale:
        raise ValueError("Tournament snapshot rationale setting does not match the requested run.")
    if coerce_int(payload.get("max_actions"), default=max_actions) != max_actions:
        raise ValueError("Tournament snapshot max-actions setting does not match the requested run.")
    if coerce_int(payload.get("seed_start"), default=seed_start) != seed_start:
        raise ValueError("Tournament snapshot seed-start setting does not match the requested run.")
    if coerce_int(payload.get("seed_pairs"), default=seed_pair_count) != seed_pair_count:
        raise ValueError("Tournament snapshot seed-pairs setting does not match the requested run.")
    if payload.get("competitors") != expected_competitors:
        raise ValueError("Tournament snapshot competitors do not match the requested run.")

    pairings_payload = payload.get("pairings")
    if not isinstance(pairings_payload, list):
        raise ValueError("Tournament snapshot is missing the saved pairings array.")

    expected_pairings = {
        pairing_index: (left.spec.label, right.spec.label)
        for pairing_index, (left, right) in enumerate(combinations(resolved_competitors, 2))
    }

    resumed_pairings_by_index: dict[int, PairingResult] = {}
    for pairing_payload in pairings_payload:
        pairing = pairing_result_from_dict(pairing_payload)
        expected_labels = expected_pairings.get(pairing.pairing_index)
        if expected_labels is None:
            raise ValueError(f"Tournament snapshot includes unexpected pairing index {pairing.pairing_index}.")
        if pairing.competitor_labels != expected_labels:
            raise ValueError(
                f"Tournament snapshot pairing {pairing.pairing_index} does not match the requested competitor order."
            )
        resumed_pairings_by_index[pairing.pairing_index] = pairing

    checkpoint_dir = tournament_checkpoint_dir(output_path)
    if checkpoint_dir.exists():
        for checkpoint_path in sorted(checkpoint_dir.glob("pairing-*.json")):
            checkpoint_payload = json.loads(checkpoint_path.read_text(encoding="utf-8"))
            pairing = pairing_result_from_dict(checkpoint_payload)
            expected_labels = expected_pairings.get(pairing.pairing_index)
            if expected_labels is None:
                raise ValueError(f"Tournament checkpoint includes unexpected pairing index {pairing.pairing_index}.")
            if pairing.competitor_labels != expected_labels:
                raise ValueError(
                    f"Tournament checkpoint pairing {pairing.pairing_index} does not match the requested competitor order."
                )
            current = resumed_pairings_by_index.get(pairing.pairing_index)
            if current is None or pairing_match_count(pairing) > pairing_match_count(current):
                resumed_pairings_by_index[pairing.pairing_index] = pairing

    return [resumed_pairings_by_index[index] for index in sorted(resumed_pairings_by_index)]


@dataclass(frozen=True, slots=True)
class TournamentProgressEvent:
    kind: str
    total_pairings: int
    completed_pairings: int
    total_matches: int
    completed_matches: int
    competitor_count: int | None = None
    seed_pair_count: int | None = None
    scheduled_pairings: int | None = None
    skipped_pairings: int = 0
    pairing_index: int | None = None
    pairing_labels: tuple[str, str] | None = None
    seed_pair_index: int | None = None
    seed_match_index: int | None = None
    seed: int | None = None
    match_index: int | None = None
    army_a_label: str | None = None
    army_b_label: str | None = None
    deployment_first_army: ArmyId | None = None
    first_bound_army: ArmyId | None = None
    match_result: MatchResult | None = None
    seed_pair_result: SeedPairResult | None = None
    pairing_result: PairingResult | None = None
    standings: list[TournamentStanding] | None = None


def build_side_summary(pairings: Sequence[PairingResult]) -> dict[str, object]:
    summary = {
        ArmyId.A: {"games": 0, "wins": 0, "losses": 0, "draws": 0, "unfinished": 0},
        ArmyId.B: {"games": 0, "wins": 0, "losses": 0, "draws": 0, "unfinished": 0},
    }
    for pairing in pairings:
        for seed_pair in pairing.seed_pairs:
            for match in seed_pair.matches:
                for army in (ArmyId.A, ArmyId.B):
                    side = summary[army]
                    side["games"] += 1
                    if not match.finished:
                        side["unfinished"] += 1
                    elif match.winner is None:
                        side["draws"] += 1
                    elif match.winner == army:
                        side["wins"] += 1
                    else:
                        side["losses"] += 1

    result: dict[str, object] = {}
    for army, side in summary.items():
        games = int(side["games"])
        wins = int(side["wins"])
        result[army.value] = {
            **side,
            "win_rate": (wins / games) if games else None,
        }
    return result


def empty_role_bucket() -> dict[str, int]:
    return {"games": 0, "wins": 0, "losses": 0, "draws": 0, "unfinished": 0}


def record_role_result(bucket: dict[str, int], match: MatchResult, army: ArmyId) -> None:
    bucket["games"] += 1
    if not match.finished:
        bucket["unfinished"] += 1
    elif match.winner is None:
        bucket["draws"] += 1
    elif match.winner == army:
        bucket["wins"] += 1
    else:
        bucket["losses"] += 1


def finalize_role_summary(summary: dict[str, dict[str, dict[str, int]]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for group_name, buckets in summary.items():
        result[group_name] = {}
        for bucket_name, bucket in buckets.items():
            games = int(bucket["games"])
            wins = int(bucket["wins"])
            result[group_name][bucket_name] = {
                **bucket,
                "win_rate": (wins / games) if games else None,
            }
    return result


def build_role_summary(pairings: Sequence[PairingResult]) -> dict[str, object]:
    summary = {
        "roster_position": {
            "left": empty_role_bucket(),
            "right": empty_role_bucket(),
        },
        "deployment_order": {
            "first": empty_role_bucket(),
            "second": empty_role_bucket(),
        },
        "first_bound_order": {
            "first": empty_role_bucket(),
            "second": empty_role_bucket(),
        },
    }
    for pairing in pairings:
        left_label, right_label = pairing.competitor_labels
        for seed_pair in pairing.seed_pairs:
            for match in seed_pair.matches:
                for army in (ArmyId.A, ArmyId.B):
                    label = match.commander_labels[army]
                    if label == left_label:
                        record_role_result(summary["roster_position"]["left"], match, army)
                    elif label == right_label:
                        record_role_result(summary["roster_position"]["right"], match, army)

                    deployment_key = "first" if match.replay.deployment_first_army == army else "second"
                    record_role_result(summary["deployment_order"][deployment_key], match, army)
                    first_bound_key = "first" if match.replay.first_bound_army == army else "second"
                    record_role_result(summary["first_bound_order"][first_bound_key], match, army)

    return finalize_role_summary(summary)


def battle_scores_by_label(match: MatchResult) -> dict[str, int]:
    return {
        match.commander_labels[ArmyId.A]: battle_score_total(match, ArmyId.A),
        match.commander_labels[ArmyId.B]: battle_score_total(match, ArmyId.B),
    }


def describe_match_outcome(match: MatchResult) -> str:
    if not match.finished:
        return "unfinished"
    if match.winner is None:
        return "draw"
    return f"winner {match.commander_labels[match.winner]}"


def format_standings_summary(standings: Sequence[TournamentStanding], *, limit: int = 5) -> str:
    preview = [
        f"{standing.rank}. {standing.label} {standing.game_points:.1f} pts ({standing.wins}-{standing.losses}-{standing.draws})"
        for standing in standings[:limit]
    ]
    if len(standings) > limit:
        preview.append("...")
    return " | ".join(preview)


def log_tournament_progress(event: TournamentProgressEvent, *, stream: TextIO = sys.stderr) -> None:
    if event.kind == "tournament_started":
        phase_suffix = ""
        if event.scheduled_pairings is not None and event.scheduled_pairings != event.total_pairings:
            phase_suffix = f" Scheduling {event.scheduled_pairings} pairings this phase"
            if event.skipped_pairings:
                phase_suffix += f"; {event.skipped_pairings} skipped for later"
            phase_suffix += "."
        print(
            (
                f"Starting tournament: {event.competitor_count} competitors, "
                f"{event.total_pairings} pairings, {event.total_matches} matches, "
                f"{event.seed_pair_count} seed pairs per pairing."
                f"{phase_suffix}"
            ),
            file=stream,
            flush=True,
        )
        return

    if event.kind == "pairing_started" and event.pairing_labels is not None and event.pairing_index is not None:
        print(
            f"[pairing {event.pairing_index + 1}/{event.total_pairings}] {event.pairing_labels[0]} vs {event.pairing_labels[1]}",
            file=stream,
            flush=True,
        )
        return

    if event.kind == "match_started" and event.seed is not None:
        deployment_first = event.deployment_first_army or ArmyId.A
        first_bound = event.first_bound_army or deployment_first
        print(
            (
                f"  [match {event.completed_matches + 1}/{event.total_matches} | seed {event.seed} | role "
                f"{(event.seed_match_index or 0) + 1}/{MATCHES_PER_SEED_PAIR} | deploy {deployment_first} | first {first_bound}] "
                f"{event.army_a_label} (Army A) vs {event.army_b_label} (Army B)"
            ),
            file=stream,
            flush=True,
        )
        return

    if event.kind == "match_finished" and event.match_result is not None:
        scores = battle_scores_by_label(event.match_result)
        label_a = event.match_result.commander_labels[ArmyId.A]
        label_b = event.match_result.commander_labels[ArmyId.B]
        print(
            (
                f"  [match {event.completed_matches}/{event.total_matches} complete] "
                f"{describe_match_outcome(event.match_result)} | "
                f"{label_a} {scores[label_a]}-{scores[label_b]} {label_b} | "
                f"bound {event.match_result.bound_number} | actions {event.match_result.action_count}"
            ),
            file=stream,
            flush=True,
        )
        return

    if event.kind == "seed_pair_finished" and event.seed_pair_result is not None and event.pairing_labels is not None:
        left_label, right_label = event.pairing_labels
        left_points = float(event.seed_pair_result.summary_by_label[left_label]["game_points"])
        right_points = float(event.seed_pair_result.summary_by_label[right_label]["game_points"])
        winner_label = event.seed_pair_result.winner or "tie"
        print(
            (
                f"  [seed pair {(event.seed_pair_index or 0) + 1}/{event.seed_pair_count} | seed {event.seed}] "
                f"{left_label} {left_points:.1f} - {right_points:.1f} {right_label} | {winner_label}"
            ),
            file=stream,
            flush=True,
        )
        return

    if event.kind == "pairing_finished" and event.pairing_result is not None and event.pairing_labels is not None:
        left_label, right_label = event.pairing_labels
        left_summary = event.pairing_result.summary_by_label[left_label]
        right_summary = event.pairing_result.summary_by_label[right_label]
        winner_label = event.pairing_result.winner or "tie"
        print(
            (
                f"[pairing {event.completed_pairings}/{event.total_pairings} complete] "
                f"{winner_label} | seed pairs "
                f"{left_summary['seed_pair_wins']}-{left_summary['seed_pair_losses']}-{left_summary['seed_pair_ties']} / "
                f"{right_summary['seed_pair_wins']}-{right_summary['seed_pair_losses']}-{right_summary['seed_pair_ties']} | "
                f"game points {left_summary['game_points']:.1f}-{right_summary['game_points']:.1f}"
            ),
            file=stream,
            flush=True,
        )
        if event.standings:
            print(f"  Standings: {format_standings_summary(event.standings)}", file=stream, flush=True)
        return

    if event.kind == "tournament_finished":
        if event.skipped_pairings:
            print(f"Tournament phase complete; {event.skipped_pairings} pairings left for later.", file=stream, flush=True)
        else:
            print("Tournament complete.", file=stream, flush=True)
        if event.standings:
            print(f"Final standings: {format_standings_summary(event.standings, limit=len(event.standings))}", file=stream, flush=True)


def compact_log_text(value: object, *, limit: int = 180) -> str:
    text = "" if value is None else str(value)
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


def decision_event_usage_suffix(event: dict[str, object]) -> str:
    parts = []
    for key, label in (
        ("input_tokens", "in"),
        ("output_tokens", "out"),
        ("reasoning_tokens", "reason"),
        ("total_tokens", "total"),
    ):
        value = event.get(key)
        if isinstance(value, int):
            parts.append(f"{label} {value}")
    cost = event.get("total_cost_usd")
    if isinstance(cost, (int, float)):
        parts.append(f"${cost:.4f}")
    return "" if not parts else " | " + ", ".join(parts)


def log_decision_progress(event: dict[str, object], *, stream: TextIO = sys.stderr) -> None:
    kind = str(event.get("kind", "decision"))
    phase = str(event.get("phase", "?"))
    label = compact_log_text(event.get("label") or event.get("model") or "?")
    army = event.get("army")
    army_text = army.value if isinstance(army, ArmyId) else str(army or "?")
    match_index = int(event.get("match_index", 0)) + 1
    seed = event.get("seed", "?")
    bound = event.get("bound_number", "?")
    action_number = event.get("action_number")
    action_part = "" if action_number is None else f" | action {action_number}"

    if kind == "decision_request":
        legal_count = event.get("legal_action_count", "?")
        deployment_units = event.get("deployment_unit_count")
        deployment_cells = event.get("deployment_cell_count")
        if event.get("deployment_batch") and isinstance(deployment_units, int) and isinstance(deployment_cells, int):
            choice_text = (
                f"raw legal actions {legal_count}; deployment prompt "
                f"{deployment_units} units x {deployment_cells} cells"
            )
        elif event.get("battle_batch"):
            choice_text = f"legal actions {legal_count}; bound plan"
        else:
            choice_text = f"legal actions {legal_count}"
        print(
            (
                f"    [request | match {match_index} | seed {seed} | {phase} | bound {bound}{action_part}] "
                f"{label} Army {army_text}; {choice_text}"
            ),
            file=stream,
            flush=True,
        )
        return

    elapsed = event.get("elapsed_seconds")
    elapsed_part = f" in {elapsed}s" if isinstance(elapsed, (int, float)) else ""
    if kind == "decision_error":
        error_type = compact_log_text(event.get("error_type") or "error", limit=80)
        error = compact_log_text(event.get("error"), limit=220)
        print(
            (
                f"    [decision error | match {match_index} | seed {seed} | {phase} | bound {bound}{action_part}] "
                f"{label} Army {army_text}{elapsed_part}: {error_type}: {error}"
            ),
            file=stream,
            flush=True,
        )
        return

    if kind == "order_skipped":
        order_number = event.get("order_number", "?")
        action_type = compact_log_text(event.get("action_type") or "action", limit=40)
        reason = compact_log_text(event.get("reason") or "skipped", limit=120)
        print(
            (
                f"    [order skipped | match {match_index} | seed {seed} | {phase} | bound {bound}{action_part}] "
                f"{label} Army {army_text} order {order_number} {action_type}: {reason}"
            ),
            file=stream,
            flush=True,
        )
        return

    indices = event.get("selected_action_indices")
    if isinstance(indices, list):
        index_text = ",".join(str(index) for index in indices)
    else:
        index_text = str(event.get("selected_action_index", "?"))
    summary = compact_log_text(event.get("action_summary"), limit=220)
    placement_count = event.get("deployment_placements")
    placement_part = ""
    if event.get("deployment_batch") and isinstance(placement_count, int):
        placement_part = f" | placements {placement_count}"
    print(
        (
            f"    [decision | match {match_index} | seed {seed} | {phase} | bound {bound}{action_part}] "
            f"{label} Army {army_text} -> idx {index_text}: {summary}{placement_part}{elapsed_part}"
            f"{decision_event_usage_suffix(event)}"
        ),
        file=stream,
        flush=True,
    )


def summarize_seed_pair(
    *,
    seed_pair_index: int,
    seed: int,
    matches: list[MatchResult],
    competitor_labels: tuple[str, str],
) -> SeedPairResult:
    summary_by_label = {
        label: {
            "game_points": 0.0,
            "match_wins": 0,
            "match_losses": 0,
            "draws": 0,
            "unfinished": 0,
            "battle_score_differential": 0,
        }
        for label in competitor_labels
    }

    for match in matches:
        for army in (ArmyId.A, ArmyId.B):
            label = match.commander_labels[army]
            summary_by_label[label]["game_points"] += match_points_for_army(match, army)
            summary_by_label[label]["battle_score_differential"] += (
                battle_score_total(match, army) - battle_score_total(match, other_army(army))
            )

        label_a = match.commander_labels[ArmyId.A]
        label_b = match.commander_labels[ArmyId.B]
        if not match.finished:
            summary_by_label[label_a]["unfinished"] += 1
            summary_by_label[label_b]["unfinished"] += 1
        elif match.winner is None:
            summary_by_label[label_a]["draws"] += 1
            summary_by_label[label_b]["draws"] += 1
        else:
            winner_label = match.commander_labels[match.winner]
            loser_label = label_b if winner_label == label_a else label_a
            summary_by_label[winner_label]["match_wins"] += 1
            summary_by_label[loser_label]["match_losses"] += 1

    return SeedPairResult(
        seed_pair_index=seed_pair_index,
        seed=seed,
        winner=winner_by_summary_metrics(summary_by_label, competitor_labels, ("game_points",)),
        summary_by_label=summary_by_label,
        matches=matches,
    )


def summarize_pairing(
    *,
    pairing_index: int,
    left: ResolvedCompetitor,
    right: ResolvedCompetitor,
    seed_pairs: list[SeedPairResult],
    scheduled_seed_pair_count: int | None = None,
) -> PairingResult:
    competitor_labels = (left.spec.label, right.spec.label)
    summary_by_label = {
        label: {
            "game_points": 0.0,
            "match_wins": 0,
            "match_losses": 0,
            "draws": 0,
            "unfinished": 0,
            "seed_pair_wins": 0,
            "seed_pair_losses": 0,
            "seed_pair_ties": 0,
            "battle_score_differential": 0,
        }
        for label in competitor_labels
    }

    for seed_pair in seed_pairs:
        for label in competitor_labels:
            seed_summary = seed_pair.summary_by_label[label]
            for key in ("game_points", "match_wins", "match_losses", "draws", "unfinished", "battle_score_differential"):
                summary_by_label[label][key] += seed_summary[key]

        if seed_pair.winner is None:
            for label in competitor_labels:
                summary_by_label[label]["seed_pair_ties"] += 1
        else:
            loser = competitor_labels[1] if seed_pair.winner == competitor_labels[0] else competitor_labels[0]
            summary_by_label[seed_pair.winner]["seed_pair_wins"] += 1
            summary_by_label[loser]["seed_pair_losses"] += 1

    target_seed_pair_count = scheduled_seed_pair_count if scheduled_seed_pair_count is not None else len(seed_pairs)
    majority_threshold = (target_seed_pair_count // 2) + 1
    return PairingResult(
        pairing_index=pairing_index,
        scenario_id=TOURNAMENT_SCENARIO_ID,
        competitor_labels=competitor_labels,
        competitor_models={
            left.spec.label: left.spec.model,
            right.spec.label: right.spec.model,
        },
        competitor_providers={
            left.spec.label: left.provider,
            right.spec.label: right.provider,
        },
        seed_pair_count=target_seed_pair_count,
        majority_threshold=majority_threshold,
        winner=winner_by_summary_metrics(
            summary_by_label,
            competitor_labels,
            ("seed_pair_wins", "game_points"),
        ),
        summary_by_label=summary_by_label,
        seed_pairs=seed_pairs,
    )


def build_pairing_match_schedule(
    *,
    pairing_index: int,
    left: ResolvedCompetitor,
    right: ResolvedCompetitor,
    seed_start: int,
    seed_pair_count: int,
) -> list[ScheduledMatch]:
    match_schedule: list[ScheduledMatch] = []
    for seed_pair_index in range(seed_pair_count):
        seed = seed_start + seed_pair_index
        role_cases = full_seed_match_roles(left, right)
        for seed_match_index in seed_match_execution_order(seed=seed, pairing_index=pairing_index):
            army_a, army_b, first_army = role_cases[seed_match_index]
            match_schedule.append(
                ScheduledMatch(
                    seed_pair_index=seed_pair_index,
                    seed_match_index=seed_match_index,
                    match_index=seed_pair_index * MATCHES_PER_SEED_PAIR + seed_match_index,
                    seed=seed,
                    army_a=army_a,
                    army_b=army_b,
                    deployment_first_army=first_army,
                    first_bound_army=first_army,
                )
            )
    return match_schedule


def seed_match_execution_order(*, seed: int, pairing_index: int) -> tuple[int, int, int, int]:
    if (seed + pairing_index) % 2 == 0:
        return (0, 1, 2, 3)
    return (1, 0, 3, 2)


def full_seed_match_roles(
    left: ResolvedCompetitor,
    right: ResolvedCompetitor,
) -> tuple[
    tuple[ResolvedCompetitor, ResolvedCompetitor, ArmyId],
    tuple[ResolvedCompetitor, ResolvedCompetitor, ArmyId],
    tuple[ResolvedCompetitor, ResolvedCompetitor, ArmyId],
    tuple[ResolvedCompetitor, ResolvedCompetitor, ArmyId],
]:
    return (
        (left, right, ArmyId.A),
        (right, left, ArmyId.A),
        (left, right, ArmyId.B),
        (right, left, ArmyId.B),
    )


def accepts_keyword_argument(callable_object: Callable[..., object], keyword: str) -> bool:
    try:
        signature = inspect.signature(callable_object)
    except (TypeError, ValueError):
        return True
    return keyword in signature.parameters or any(
        parameter.kind == inspect.Parameter.VAR_KEYWORD
        for parameter in signature.parameters.values()
    )


def parse_event_army(value: object) -> ArmyId | None:
    if isinstance(value, ArmyId):
        return value
    if isinstance(value, str):
        try:
            return ArmyId(value)
        except ValueError:
            return None
    return None


def build_decision_error_match_result(
    *,
    scheduled_match: ScheduledMatch,
    losing_army: ArmyId | None,
    decision_context: dict[str, object],
    error: AiDecisionError,
) -> MatchResult:
    commander_labels = {
        ArmyId.A: scheduled_match.army_a.spec.label,
        ArmyId.B: scheduled_match.army_b.spec.label,
    }
    commander_models = {
        ArmyId.A: scheduled_match.army_a.spec.model,
        ArmyId.B: scheduled_match.army_b.spec.model,
    }
    winner = other_army(losing_army) if losing_army is not None else None
    loser_text = commander_labels[losing_army] if losing_army is not None else "unknown commander"
    winner_reason_prefix = "decision_error_forfeit" if losing_army is not None else "decision_error_draw"
    winner_reason = (
        f"{winner_reason_prefix}: {loser_text}: {type(error).__name__}: "
        f"{compact_log_text(error, limit=300)}"
    )
    action_number = coerce_int(decision_context.get("action_number"), default=0)
    battle_scores = []
    for army in (ArmyId.A, ArmyId.B):
        battle_scores.append(
            {
                "army": army,
                "enemy_losses": 0,
                "total": 1 if winner == army else 0,
            }
        )

    return MatchResult(
        match_index=scheduled_match.match_index,
        scenario_id=TOURNAMENT_SCENARIO_ID,
        seed=scheduled_match.seed,
        input_mode=AiInputMode.TEXT_ONLY,
        commander_labels=commander_labels,
        commander_models=commander_models,
        winner=winner,
        winner_reason=winner_reason,
        finished=True,
        max_actions_reached=False,
        bound_number=coerce_int(decision_context.get("bound_number"), default=1),
        action_count=action_number,
        battle_scores=battle_scores,
        attrition_status=[
            {"army": ArmyId.A, "starting_units": 0, "losses": 0, "target_losses": 0},
            {"army": ArmyId.B, "starting_units": 0, "losses": 0, "target_losses": 0},
        ],
        usage_by_army={ArmyId.A: UsageTotals(), ArmyId.B: UsageTotals()},
        replay=ReplayData(
            scenario_id=TOURNAMENT_SCENARIO_ID,
            seed=scheduled_match.seed,
            deployment_first_army=scheduled_match.deployment_first_army,
            first_bound_army=scheduled_match.first_bound_army,
            actions=[],
        ),
        behavior_analysis={
            "decision_error": {
                "army": losing_army,
                "label": commander_labels[losing_army] if losing_army is not None else None,
                "phase": decision_context.get("phase"),
                "bound_number": coerce_int(decision_context.get("bound_number"), default=1),
                "action_number": action_number,
                "error_type": type(error).__name__,
                "error": str(error),
            }
        },
    )


def run_scheduled_match(
    *,
    scheduled_match: ScheduledMatch,
    include_rationale: bool,
    max_actions: int,
    log_decisions: bool = False,
) -> MatchResult:
    commanders_by_army = {
        ArmyId.A: build_commander(scheduled_match.army_a.spec),
        ArmyId.B: build_commander(scheduled_match.army_b.spec),
    }
    kwargs = {
        "scenario_id": TOURNAMENT_SCENARIO_ID,
        "seed": scheduled_match.seed,
        "match_index": scheduled_match.match_index,
        "commanders_by_army": commanders_by_army,
        "commander_labels": {
            ArmyId.A: scheduled_match.army_a.spec.label,
            ArmyId.B: scheduled_match.army_b.spec.label,
        },
        "commander_models": {
            ArmyId.A: scheduled_match.army_a.spec.model,
            ArmyId.B: scheduled_match.army_b.spec.model,
        },
        "include_rationale": include_rationale,
        "max_actions": max_actions,
        "deployment_first_army": scheduled_match.deployment_first_army,
        "first_bound_army": scheduled_match.first_bound_army,
    }
    decision_context: dict[str, object] = {}

    def capture_decision_progress(event: dict[str, object]) -> None:
        kind = event.get("kind")
        if kind in {"decision_request", "decision_error"}:
            army = parse_event_army(event.get("army"))
            if army is not None:
                decision_context["army"] = army
            for field_name in ("phase", "bound_number", "action_number"):
                if field_name in event:
                    decision_context[field_name] = event[field_name]
        if log_decisions:
            log_decision_progress(event)

    if accepts_keyword_argument(run_headless_match, "decision_logger"):
        kwargs["decision_logger"] = capture_decision_progress
    try:
        return run_headless_match(**kwargs)
    except AiDecisionError as error:
        return build_decision_error_match_result(
            scheduled_match=scheduled_match,
            losing_army=parse_event_army(decision_context.get("army")),
            decision_context=decision_context,
            error=error,
        )


def run_pairing_worker(
    *,
    pairing_index: int,
    left_spec: CommanderSpec,
    right_spec: CommanderSpec,
    seed_start: int,
    seed_pair_count: int,
    include_rationale: bool,
    max_actions: int,
    match_jobs: int,
    log_decisions: bool = False,
    checkpoint_output_path: Path | None = None,
    resumed_pairing: PairingResult | None = None,
) -> PairingResult:
    left = ResolvedCompetitor(
        spec=left_spec,
        provider=resolve_provider(left_spec),
    )
    right = ResolvedCompetitor(
        spec=right_spec,
        provider=resolve_provider(right_spec),
    )
    return run_pairing(
        pairing_index=pairing_index,
        left=left,
        right=right,
        seed_start=seed_start,
        seed_pair_count=seed_pair_count,
        include_rationale=include_rationale,
        max_actions=max_actions,
        match_jobs=match_jobs,
        log_decisions=log_decisions,
        checkpoint_output_path=checkpoint_output_path,
        resumed_pairing=resumed_pairing,
    )


def run_pairing(
    *,
    pairing_index: int,
    left: ResolvedCompetitor,
    right: ResolvedCompetitor,
    seed_start: int,
    seed_pair_count: int,
    include_rationale: bool = False,
    max_actions: int = DEFAULT_MAX_ACTIONS,
    match_jobs: int = 1,
    log_decisions: bool = False,
    checkpoint_output_path: Path | None = None,
    resumed_pairing: PairingResult | None = None,
    progress_callback: Callable[[TournamentProgressEvent], None] | None = None,
    total_pairings: int | None = None,
    total_matches: int | None = None,
    completed_pairings: int = 0,
    completed_matches_start: int = 0,
) -> PairingResult:
    if progress_callback is not None and (total_pairings is None or total_matches is None):
        raise ValueError("total_pairings and total_matches are required when progress_callback is provided.")
    if match_jobs < 1:
        raise ValueError("match_jobs must be at least 1.")

    seed_pair_results: dict[int, SeedPairResult] = {}
    matches_by_seed_pair = {seed_pair_index: {} for seed_pair_index in range(seed_pair_count)}
    pairing_labels = (left.spec.label, right.spec.label)
    if resumed_pairing is not None and resumed_pairing.competitor_labels != pairing_labels:
        raise ValueError(f"Resumed pairing {resumed_pairing.pairing_index} does not match the requested competitors.")

    def infer_seed_match_index(match: MatchResult) -> int:
        for seed_match_index, expected in enumerate(full_seed_match_roles(left, right)):
            if (
                match.commander_labels[ArmyId.A] == expected[0].spec.label
                and match.commander_labels[ArmyId.B] == expected[1].spec.label
                and match.replay.deployment_first_army == expected[2]
                and match.replay.first_bound_army == expected[2]
            ):
                return seed_match_index
        raise ValueError(
            f"Resumed match {match.match_index} does not match the expected competitor labels and setup roles for pairing {pairing_index}."
        )

    resumed_match_count = 0
    if resumed_pairing is not None:
        for seed_pair in resumed_pairing.seed_pairs:
            seed_pair_results[seed_pair.seed_pair_index] = seed_pair
            seed_pair_matches = matches_by_seed_pair.setdefault(seed_pair.seed_pair_index, {})
            for match in seed_pair.matches:
                seed_pair_matches[infer_seed_match_index(match)] = match
                resumed_match_count += 1

    completed_matches = completed_matches_start + resumed_match_count
    full_match_schedule = build_pairing_match_schedule(
        pairing_index=pairing_index,
        left=left,
        right=right,
        seed_start=seed_start,
        seed_pair_count=seed_pair_count,
    )
    match_schedule = [
        scheduled_match
        for scheduled_match in full_match_schedule
        if scheduled_match.seed_match_index not in matches_by_seed_pair[scheduled_match.seed_pair_index]
    ]

    def persist_pairing_checkpoint() -> None:
        if checkpoint_output_path is None:
            return
        partial_pairing = summarize_pairing(
            pairing_index=pairing_index,
            left=left,
            right=right,
            seed_pairs=[seed_pair_results[index] for index in sorted(seed_pair_results)],
            scheduled_seed_pair_count=seed_pair_count,
        )
        write_pairing_checkpoint(partial_pairing, output_path=checkpoint_output_path)

    if progress_callback is not None:
        progress_callback(
            TournamentProgressEvent(
                kind="pairing_started",
                total_pairings=total_pairings,
                completed_pairings=completed_pairings,
                total_matches=total_matches,
                completed_matches=completed_matches,
                seed_pair_count=seed_pair_count,
                pairing_index=pairing_index,
                pairing_labels=pairing_labels,
            )
        )

    def emit_match_started(scheduled_match: ScheduledMatch) -> None:
        if progress_callback is None:
            return
        progress_callback(
            TournamentProgressEvent(
                kind="match_started",
                total_pairings=total_pairings,
                completed_pairings=completed_pairings,
                total_matches=total_matches,
                completed_matches=completed_matches,
                seed_pair_count=seed_pair_count,
                pairing_index=pairing_index,
                pairing_labels=pairing_labels,
                seed_pair_index=scheduled_match.seed_pair_index,
                seed_match_index=scheduled_match.seed_match_index,
                seed=scheduled_match.seed,
                match_index=scheduled_match.match_index,
                army_a_label=scheduled_match.army_a.spec.label,
                army_b_label=scheduled_match.army_b.spec.label,
                deployment_first_army=scheduled_match.deployment_first_army,
                first_bound_army=scheduled_match.first_bound_army,
            )
        )

    def record_match_completion(scheduled_match: ScheduledMatch, match: MatchResult) -> None:
        nonlocal completed_matches
        completed_matches += 1
        matches_by_seed_pair[scheduled_match.seed_pair_index][scheduled_match.seed_match_index] = match

        seed_pair_matches = matches_by_seed_pair[scheduled_match.seed_pair_index]
        seed_pair_result = summarize_seed_pair(
            seed_pair_index=scheduled_match.seed_pair_index,
            seed=scheduled_match.seed,
            matches=[seed_pair_matches[index] for index in sorted(seed_pair_matches)],
            competitor_labels=pairing_labels,
        )
        seed_pair_results[scheduled_match.seed_pair_index] = seed_pair_result
        persist_pairing_checkpoint()

        if progress_callback is not None:
            progress_callback(
                TournamentProgressEvent(
                    kind="match_finished",
                    total_pairings=total_pairings,
                    completed_pairings=completed_pairings,
                    total_matches=total_matches,
                    completed_matches=completed_matches,
                    seed_pair_count=seed_pair_count,
                    pairing_index=pairing_index,
                    pairing_labels=pairing_labels,
                    seed_pair_index=scheduled_match.seed_pair_index,
                    seed_match_index=scheduled_match.seed_match_index,
                    seed=scheduled_match.seed,
                    match_index=scheduled_match.match_index,
                    match_result=match,
                )
            )

        if len(seed_pair_matches) != MATCHES_PER_SEED_PAIR:
            return

        if progress_callback is not None:
            progress_callback(
                TournamentProgressEvent(
                    kind="seed_pair_finished",
                    total_pairings=total_pairings,
                    completed_pairings=completed_pairings,
                    total_matches=total_matches,
                    completed_matches=completed_matches,
                    seed_pair_count=seed_pair_count,
                    pairing_index=pairing_index,
                    pairing_labels=pairing_labels,
                    seed_pair_index=scheduled_match.seed_pair_index,
                    seed=scheduled_match.seed,
                    seed_pair_result=seed_pair_result,
                )
            )

    if match_jobs == 1 or len(match_schedule) <= 1:
        for scheduled_match in match_schedule:
            emit_match_started(scheduled_match)
            match = run_scheduled_match(
                scheduled_match=scheduled_match,
                include_rationale=include_rationale,
                max_actions=max_actions,
                log_decisions=log_decisions,
            )
            record_match_completion(scheduled_match, match)
    else:
        max_workers = min(match_jobs, len(match_schedule))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {}
            for scheduled_match in match_schedule:
                emit_match_started(scheduled_match)
                future = executor.submit(
                    run_scheduled_match,
                    scheduled_match=scheduled_match,
                    include_rationale=include_rationale,
                    max_actions=max_actions,
                    log_decisions=log_decisions,
                )
                futures[future] = scheduled_match

            for future in as_completed(futures):
                scheduled_match = futures[future]
                record_match_completion(scheduled_match, future.result())

    return summarize_pairing(
        pairing_index=pairing_index,
        left=left,
        right=right,
        seed_pairs=[seed_pair_results[index] for index in range(seed_pair_count)],
        scheduled_seed_pair_count=seed_pair_count,
    )


def build_stats(
    competitors: Sequence[ResolvedCompetitor],
    pairings: Sequence[PairingResult],
) -> tuple[dict[str, CompetitorStats], dict[str, dict[str, float]], dict[str, dict[str, int]]]:
    stats = {
        competitor.spec.label: CompetitorStats(spec=competitor.spec, provider=competitor.provider)
        for competitor in competitors
    }
    head_to_head_game_points: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    head_to_head_seed_pair_wins: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for pairing in pairings:
        left_label, right_label = pairing.competitor_labels
        if pairing.winner is None:
            stats[left_label].pairing_ties += 1
            stats[right_label].pairing_ties += 1
        else:
            loser = right_label if pairing.winner == left_label else left_label
            stats[pairing.winner].pairing_wins += 1
            stats[loser].pairing_losses += 1

        for seed_pair in pairing.seed_pairs:
            if seed_pair.winner is None:
                stats[left_label].seed_pair_ties += 1
                stats[right_label].seed_pair_ties += 1
            else:
                loser = right_label if seed_pair.winner == left_label else left_label
                stats[seed_pair.winner].seed_pair_wins += 1
                stats[loser].seed_pair_losses += 1
                head_to_head_seed_pair_wins[seed_pair.winner][loser] += 1

            for match in seed_pair.matches:
                label_a = match.commander_labels[ArmyId.A]
                label_b = match.commander_labels[ArmyId.B]
                stats[label_a].add_match(match, ArmyId.A)
                stats[label_b].add_match(match, ArmyId.B)
                head_to_head_game_points[label_a][label_b] += match_points_for_army(match, ArmyId.A)
                head_to_head_game_points[label_b][label_a] += match_points_for_army(match, ArmyId.B)

    return stats, head_to_head_game_points, head_to_head_seed_pair_wins


def build_standings(
    competitors: Sequence[ResolvedCompetitor],
    pairings: Sequence[PairingResult],
) -> list[TournamentStanding]:
    stats, head_to_head_game_points, head_to_head_seed_pair_wins = build_stats(competitors, pairings)
    labels = [competitor.spec.label for competitor in competitors]
    point_groups = sorted({stats[label].game_points for label in labels}, reverse=True)

    ordered_labels: list[str] = []
    head_to_head_points_by_label: dict[str, float] = {}
    head_to_head_seed_wins_by_label: dict[str, int] = {}

    for points in point_groups:
        cohort = [label for label in labels if stats[label].game_points == points]
        for label in cohort:
            head_to_head_points_by_label[label] = sum(
                head_to_head_game_points[label].get(other, 0.0) for other in cohort if other != label
            )
            head_to_head_seed_wins_by_label[label] = sum(
                head_to_head_seed_pair_wins[label].get(other, 0) for other in cohort if other != label
            )

        cohort.sort(
            key=lambda label: (
                -head_to_head_points_by_label[label],
                -head_to_head_seed_wins_by_label[label],
                stats[label].unfinished,
                label.lower(),
            )
        )
        ordered_labels.extend(cohort)

    standings: list[TournamentStanding] = []
    for rank, label in enumerate(ordered_labels, start=1):
        competitor_stats = stats[label]
        average_score_diff = competitor_stats.average_battle_score_differential()
        usage_dict = competitor_stats.usage.to_dict()
        average_tokens_per_game = None
        total_tokens = competitor_stats.usage.total_tokens
        if competitor_stats.games > 0 and total_tokens is not None:
            average_tokens_per_game = total_tokens / competitor_stats.games

        average_cost_usd_per_game = None
        if competitor_stats.games > 0 and competitor_stats.usage.priced_turns > 0:
            average_cost_usd_per_game = competitor_stats.usage.total_cost_usd / competitor_stats.games

        cost_per_win = None
        if competitor_stats.wins > 0 and competitor_stats.usage.priced_turns > 0:
            cost_per_win = competitor_stats.usage.total_cost_usd / competitor_stats.wins

        standings.append(
            TournamentStanding(
                rank=rank,
                label=label,
                model=competitor_stats.spec.model,
                provider=competitor_stats.provider,
                games=competitor_stats.games,
                game_points=competitor_stats.game_points,
                wins=competitor_stats.wins,
                losses=competitor_stats.losses,
                draws=competitor_stats.draws,
                unfinished=competitor_stats.unfinished,
                pairing_wins=competitor_stats.pairing_wins,
                pairing_losses=competitor_stats.pairing_losses,
                pairing_ties=competitor_stats.pairing_ties,
                seed_pair_wins=competitor_stats.seed_pair_wins,
                seed_pair_losses=competitor_stats.seed_pair_losses,
                seed_pair_ties=competitor_stats.seed_pair_ties,
                games_as_a=competitor_stats.games_as_a,
                games_as_b=competitor_stats.games_as_b,
                wins_as_a=competitor_stats.wins_as_a,
                wins_as_b=competitor_stats.wins_as_b,
                head_to_head_game_points=head_to_head_points_by_label.get(label, 0.0),
                head_to_head_seed_pair_wins=head_to_head_seed_wins_by_label.get(label, 0),
                battle_score_differential=competitor_stats.battle_score_differential,
                average_battle_score_differential=average_score_diff,
                average_tokens_per_game=average_tokens_per_game,
                average_cost_usd_per_game=average_cost_usd_per_game,
                cost_per_win=cost_per_win,
                usage=usage_dict,
            )
        )

    return standings


def run_tournament(
    *,
    competitor_specs: Sequence[CommanderSpec],
    seed_start: int,
    seed_pair_count: int = DEFAULT_SEED_PAIRS,
    include_rationale: bool = False,
    max_actions: int = DEFAULT_MAX_ACTIONS,
    progress_callback: Callable[[TournamentProgressEvent], None] | None = None,
    jobs: int = 1,
    match_jobs: int = 1,
    log_decisions: bool = False,
    snapshot_path: Path | None = None,
    resume_from_snapshot: bool = False,
    skip_labels: Sequence[str] | None = None,
    skip_providers: Sequence[str] | None = None,
    _executor_factory: Callable[[int], Executor] | None = None,
) -> TournamentResult:
    if len(competitor_specs) < 2:
        raise ValueError("The tournament requires at least two competitors.")
    if seed_pair_count < 1:
        raise ValueError("seed_pair_count must be at least 1.")
    if jobs < 1:
        raise ValueError("jobs must be at least 1.")
    if match_jobs < 1:
        raise ValueError("match_jobs must be at least 1.")
    if resume_from_snapshot and snapshot_path is None:
        raise ValueError("resume_from_snapshot requires snapshot_path to be set.")

    resolved_competitors = [
        ResolvedCompetitor(
            spec=spec,
            provider=resolve_provider(spec),
        )
        for spec in competitor_specs
    ]
    total_pairings = len(resolved_competitors) * (len(resolved_competitors) - 1) // 2
    total_matches = total_pairings * seed_pair_count * MATCHES_PER_SEED_PAIR
    pairing_schedule = list(enumerate(combinations(resolved_competitors, 2)))
    skip_label_set = normalize_skip_values(skip_labels)
    skip_provider_set = normalize_skip_values(skip_providers)

    pairings_by_index: dict[int, PairingResult] = {}
    resumed_pairings_by_index: dict[int, PairingResult] = {}
    if resume_from_snapshot and snapshot_path is not None and snapshot_path.exists():
        resumed_pairings = load_resumed_pairings(
            snapshot_path,
            resolved_competitors=resolved_competitors,
            include_rationale=include_rationale,
            max_actions=max_actions,
            seed_start=seed_start,
            seed_pair_count=seed_pair_count,
        )
        resumed_pairings_by_index = {pairing.pairing_index: pairing for pairing in resumed_pairings}
        pairings_by_index = {
            pairing.pairing_index: pairing
            for pairing in resumed_pairings
            if is_pairing_complete(pairing, seed_pair_count=seed_pair_count)
        }

    if snapshot_path is not None and not resume_from_snapshot:
        clear_tournament_checkpoints(snapshot_path)

    completed_pairings = len(pairings_by_index)
    completed_matches = sum(pairing_match_count(pairing) for pairing in resumed_pairings_by_index.values())
    if snapshot_path is not None and (not resume_from_snapshot or not snapshot_path.exists()):
        write_tournament_snapshot(
            build_tournament_result(
                resolved_competitors=resolved_competitors,
                pairings=ordered_pairings(pairings_by_index),
                include_rationale=include_rationale,
                max_actions=max_actions,
                seed_start=seed_start,
                seed_pair_count=seed_pair_count,
            ),
            output_path=snapshot_path,
        )
    skipped_pairings: list[tuple[int, ResolvedCompetitor, ResolvedCompetitor]] = []
    pending_pairings: list[tuple[int, ResolvedCompetitor, ResolvedCompetitor]] = []
    for pairing_index, (left, right) in pairing_schedule:
        if pairing_index in pairings_by_index:
            continue
        pairing_skipped = pairing_matches_skip_filters(
            left,
            right,
            skip_labels=skip_label_set,
            skip_providers=skip_provider_set,
        )
        if pairing_skipped:
            skipped_pairings.append((pairing_index, left, right))
        else:
            pending_pairings.append((pairing_index, left, right))

    if progress_callback is not None:
        progress_callback(
            TournamentProgressEvent(
                kind="tournament_started",
                total_pairings=total_pairings,
                completed_pairings=completed_pairings,
                total_matches=total_matches,
                completed_matches=completed_matches,
                competitor_count=len(resolved_competitors),
                seed_pair_count=seed_pair_count,
                scheduled_pairings=len(pending_pairings),
                skipped_pairings=len(skipped_pairings),
            )
        )

    def resumed_match_count_for_pairing(pairing_index: int) -> int:
        resumed_pairing = resumed_pairings_by_index.get(pairing_index)
        return pairing_match_count(resumed_pairing) if resumed_pairing is not None else 0

    if jobs == 1 or len(pending_pairings) <= 1:
        for pairing_index, left, right in pending_pairings:
            pairing = run_pairing(
                pairing_index=pairing_index,
                left=left,
                right=right,
                seed_start=seed_start,
                seed_pair_count=seed_pair_count,
                include_rationale=include_rationale,
                max_actions=max_actions,
                match_jobs=match_jobs,
                log_decisions=log_decisions,
                checkpoint_output_path=snapshot_path,
                resumed_pairing=resumed_pairings_by_index.get(pairing_index),
                progress_callback=progress_callback,
                total_pairings=total_pairings,
                total_matches=total_matches,
                completed_pairings=len(pairings_by_index),
                completed_matches_start=completed_matches - resumed_match_count_for_pairing(pairing_index),
            )
            pairings_by_index[pairing_index] = pairing
            completed_pairings = len(pairings_by_index)
            resumed_pairings_by_index[pairing_index] = pairing
            completed_matches = sum(pairing_match_count(saved_pairing) for saved_pairing in resumed_pairings_by_index.values())
            pairings = ordered_pairings(pairings_by_index)
            standings = build_standings(resolved_competitors, pairings)
            if snapshot_path is not None:
                write_tournament_snapshot(
                    build_tournament_result(
                        resolved_competitors=resolved_competitors,
                        pairings=pairings,
                        include_rationale=include_rationale,
                        max_actions=max_actions,
                        seed_start=seed_start,
                        seed_pair_count=seed_pair_count,
                        standings=standings,
                    ),
                    output_path=snapshot_path,
                )
                remove_pairing_checkpoint(snapshot_path, pairing_index=pairing_index)
            if progress_callback is not None:
                progress_callback(
                    TournamentProgressEvent(
                        kind="pairing_finished",
                        total_pairings=total_pairings,
                        completed_pairings=completed_pairings,
                        total_matches=total_matches,
                        completed_matches=completed_matches,
                        pairing_index=pairing_index,
                        pairing_labels=(left.spec.label, right.spec.label),
                        seed_pair_count=seed_pair_count,
                        pairing_result=pairing,
                        standings=standings,
                    )
                )
    else:
        executor_factory = _executor_factory or ProcessPoolExecutor
        max_workers = min(jobs, len(pending_pairings))
        with executor_factory(max_workers) as executor:
            pending_queue = list(pending_pairings)
            active_label_counts: dict[str, int] = {}
            futures = {}

            def submit_next_pairing() -> bool:
                if not pending_queue:
                    return False
                pairing_index, left, right = pop_next_balanced_pairing(
                    pending_queue,
                    active_label_counts=active_label_counts,
                )
                if progress_callback is not None:
                    progress_callback(
                        TournamentProgressEvent(
                            kind="pairing_started",
                            total_pairings=total_pairings,
                            completed_pairings=len(pairings_by_index),
                            total_matches=total_matches,
                            completed_matches=completed_matches - resumed_match_count_for_pairing(pairing_index),
                            seed_pair_count=seed_pair_count,
                            pairing_index=pairing_index,
                            pairing_labels=(left.spec.label, right.spec.label),
                        )
                    )
                scheduled_pairing = (pairing_index, left, right)
                update_active_pairing_labels(active_label_counts, scheduled_pairing, delta=1)
                future = executor.submit(
                    run_pairing_worker,
                    pairing_index=pairing_index,
                    left_spec=left.spec,
                    right_spec=right.spec,
                    seed_start=seed_start,
                    seed_pair_count=seed_pair_count,
                    include_rationale=include_rationale,
                    max_actions=max_actions,
                    match_jobs=match_jobs,
                    log_decisions=log_decisions,
                    checkpoint_output_path=snapshot_path,
                    resumed_pairing=resumed_pairings_by_index.get(pairing_index),
                )
                futures[future] = scheduled_pairing
                return True

            while pending_queue and len(futures) < max_workers:
                submit_next_pairing()

            while futures:
                future = next(as_completed(futures))
                pairing_index, left, right = futures[future]
                del futures[future]
                update_active_pairing_labels(active_label_counts, (pairing_index, left, right), delta=-1)
                pairing = future.result()
                pairings_by_index[pairing_index] = pairing
                completed_pairings = len(pairings_by_index)
                resumed_pairings_by_index[pairing_index] = pairing
                completed_matches = sum(pairing_match_count(saved_pairing) for saved_pairing in resumed_pairings_by_index.values())
                pairings = ordered_pairings(pairings_by_index)
                standings = build_standings(resolved_competitors, pairings)
                if snapshot_path is not None:
                    write_tournament_snapshot(
                        build_tournament_result(
                            resolved_competitors=resolved_competitors,
                            pairings=pairings,
                            include_rationale=include_rationale,
                            max_actions=max_actions,
                            seed_start=seed_start,
                            seed_pair_count=seed_pair_count,
                            standings=standings,
                        ),
                        output_path=snapshot_path,
                    )
                    remove_pairing_checkpoint(snapshot_path, pairing_index=pairing_index)
                if progress_callback is not None:
                    progress_callback(
                        TournamentProgressEvent(
                            kind="pairing_finished",
                            total_pairings=total_pairings,
                            completed_pairings=completed_pairings,
                            total_matches=total_matches,
                            completed_matches=completed_matches,
                            pairing_index=pairing_index,
                            pairing_labels=(left.spec.label, right.spec.label),
                            seed_pair_count=seed_pair_count,
                            pairing_result=pairing,
                            standings=standings,
                        )
                    )

                while pending_queue and len(futures) < max_workers:
                    submit_next_pairing()

    pairings = ordered_pairings(pairings_by_index)
    standings = build_standings(resolved_competitors, pairings)
    if progress_callback is not None:
        progress_callback(
            TournamentProgressEvent(
                kind="tournament_finished",
                total_pairings=total_pairings,
                completed_pairings=len(pairings),
                total_matches=total_matches,
                completed_matches=len(pairings) * seed_pair_count * MATCHES_PER_SEED_PAIR,
                skipped_pairings=len(skipped_pairings),
                standings=standings,
            )
        )

    tournament = build_tournament_result(
        resolved_competitors=resolved_competitors,
        pairings=pairings,
        include_rationale=include_rationale,
        max_actions=max_actions,
        seed_start=seed_start,
        seed_pair_count=seed_pair_count,
        standings=standings,
    )
    if snapshot_path is not None:
        write_tournament_snapshot(tournament, output_path=snapshot_path)
        if skipped_pairings:
            remove_empty_tournament_checkpoint_dir(snapshot_path)
        else:
            clear_tournament_checkpoints(snapshot_path)
    return tournament


def expect_optional_string(value: object, *, field_name: str) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        trimmed = value.strip()
        return trimmed or None
    raise ValueError(f"Roster field {field_name!r} must be a string when provided.")


def expect_optional_float(value: object, *, field_name: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError(f"Roster field {field_name!r} must be a number when provided.")
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError as error:
            raise ValueError(f"Roster field {field_name!r} must be a number when provided.") from error
    raise ValueError(f"Roster field {field_name!r} must be a number when provided.")


def build_spec_from_roster_entry(entry: object, *, default_timeout_seconds: float | None) -> CommanderSpec:
    if isinstance(entry, str):
        model = entry.strip()
        if not model:
            raise ValueError("Roster entries cannot be empty strings.")
        return CommanderSpec(label=model, model=model, timeout_seconds=default_timeout_seconds)

    if not isinstance(entry, dict):
        raise ValueError("Each roster entry must be a model string or an object.")

    model = expect_optional_string(entry.get("model"), field_name="model")
    if model is None:
        raise ValueError("Each roster object must include a non-empty 'model' field.")

    label = expect_optional_string(entry.get("label"), field_name="label") or model
    provider = expect_optional_string(entry.get("provider"), field_name="provider") or "auto"
    api_key_env = expect_optional_string(entry.get("api_key_env"), field_name="api_key_env")
    base_url = expect_optional_string(entry.get("base_url"), field_name="base_url")
    timeout_seconds = expect_optional_float(entry.get("timeout_seconds"), field_name="timeout_seconds")
    if timeout_seconds is None:
        timeout_seconds = default_timeout_seconds

    return CommanderSpec(
        label=label,
        model=model,
        provider=provider,
        api_key_env=api_key_env,
        base_url=base_url,
        timeout_seconds=timeout_seconds,
    )


def ensure_unique_labels(specs: Sequence[CommanderSpec]) -> None:
    seen: set[str] = set()
    for spec in specs:
        if spec.label in seen:
            raise ValueError(f"Duplicate competitor label {spec.label!r}. Labels must be unique.")
        seen.add(spec.label)


def load_roster_specs(path: Path, *, default_timeout_seconds: float | None) -> list[CommanderSpec]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        competitors = payload.get("competitors")
        if competitors is None:
            raise ValueError("Roster JSON objects must contain a 'competitors' array.")
        payload = competitors

    if not isinstance(payload, list):
        raise ValueError("Roster JSON must be a list or an object containing a 'competitors' list.")

    specs = [build_spec_from_roster_entry(entry, default_timeout_seconds=default_timeout_seconds) for entry in payload]
    if len(specs) < 2:
        raise ValueError("The roster must contain at least two competitors.")
    ensure_unique_labels(specs)
    return specs


def build_specs_from_models(
    models: Sequence[str],
    *,
    default_timeout_seconds: float | None,
) -> list[CommanderSpec]:
    specs = []
    for model in models:
        normalized_model = model.strip()
        if not normalized_model:
            raise ValueError("Model names cannot be empty.")
        specs.append(CommanderSpec(label=normalized_model, model=normalized_model, timeout_seconds=default_timeout_seconds))

    if len(specs) < 2:
        raise ValueError("At least two --model arguments are required.")
    ensure_unique_labels(specs)
    return specs


def build_specs_for_side_bias_audit(
    model: str,
    *,
    provider: str | None,
    label: str | None,
    api_key_env: str | None,
    base_url: str | None,
    default_timeout_seconds: float | None,
) -> list[CommanderSpec]:
    normalized_model = model.strip()
    if not normalized_model:
        raise ValueError("--side-bias-model cannot be empty.")
    normalized_provider = (provider or "auto").strip() or "auto"
    base_label = (label.strip() if label else normalized_model) or normalized_model
    specs = [
        CommanderSpec(
            label=f"{base_label} side-audit copy 1",
            model=normalized_model,
            provider=normalized_provider,
            api_key_env=api_key_env,
            base_url=base_url,
            timeout_seconds=default_timeout_seconds,
        ),
        CommanderSpec(
            label=f"{base_label} side-audit copy 2",
            model=normalized_model,
            provider=normalized_provider,
            api_key_env=api_key_env,
            base_url=base_url,
            timeout_seconds=default_timeout_seconds,
        ),
    ]
    ensure_unique_labels(specs)
    return specs


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run a classic_battle-only round robin tournament using role-complete seed pairs for every model pairing."
        )
    )
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument(
        "--model",
        action="append",
        dest="models",
        help="Competitor model name. Repeat once per competitor for the simple inferred-provider path.",
    )
    source_group.add_argument(
        "--roster",
        help="Path to a JSON roster file for advanced competitor settings.",
    )
    source_group.add_argument(
        "--side-bias-model",
        help=(
            "Build a two-competitor self-play roster from one model. "
            "Use this to audit side/seed bias before a paid full tournament."
        ),
    )
    parser.add_argument(
        "--side-bias-provider",
        default="auto",
        help="Provider for --side-bias-model. Defaults to inferring from the model name.",
    )
    parser.add_argument(
        "--side-bias-label",
        help="Base display label for --side-bias-model audit copies. Defaults to the model name.",
    )
    parser.add_argument(
        "--side-bias-api-key-env",
        help="Environment variable holding the API key for --side-bias-model.",
    )
    parser.add_argument(
        "--side-bias-base-url",
        help="Optional provider-specific base URL for --side-bias-model.",
    )
    parser.add_argument(
        "--seed-pairs",
        type=int,
        default=DEFAULT_SEED_PAIRS,
        help=(
            "Number of role-complete seed pairs to run per pairing. "
            f"Each seed pair is four games. Default: {DEFAULT_SEED_PAIRS}."
        ),
    )
    parser.add_argument("--seed-start", type=int, default=7, help="Starting seed for the first seed pair.")
    parser.add_argument("--max-actions", type=int, default=DEFAULT_MAX_ACTIONS, help="Safety cap on actions per game.")
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=45.0,
        help="Default HTTP timeout per AI turn for competitors built from --model or roster entries without a timeout.",
    )
    parser.add_argument(
        "--with-rationale",
        action="store_true",
        help="Ask each model for a one or two sentence rationale alongside the chosen action index.",
    )
    parser.add_argument(
        "--live-logs",
        action="store_true",
        help="Stream live tournament progress to stderr while the benchmark is running.",
    )
    parser.add_argument(
        "--log-decisions",
        action="store_true",
        help="With --live-logs, also stream each model request, selected action, latency, and token usage to stderr.",
    )
    parser.add_argument(
        "--jobs",
        type=int,
        default=1,
        help="Number of pairing workers to run in parallel. Default: 1.",
    )
    parser.add_argument(
        "--match-jobs",
        type=int,
        default=1,
        help="Number of match workers to run in parallel inside each pairing. Default: 1.",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume from an existing --output JSON snapshot when it matches the requested roster and settings.",
    )
    parser.add_argument(
        "--skip-label",
        action="append",
        default=[],
        help=(
            "Skip pairings involving this competitor label for a phased run. "
            "Repeatable; omitted pairings can be filled later with --resume and the same --output."
        ),
    )
    parser.add_argument(
        "--skip-provider",
        action="append",
        default=[],
        help=(
            "Skip pairings involving this provider for a phased run. "
            "Repeatable; omitted pairings can be filled later with --resume and the same --output."
        ),
    )
    parser.add_argument("--output", help="Optional path for the JSON tournament report.")
    parser.add_argument(
        "--battle-report-dir",
        help=(
            "Optional directory for per-battle state-summary artifacts. "
            "Defaults to a sibling '<output stem>-battle-reports' directory when --output is set."
        ),
    )
    args = parser.parse_args(argv)

    if args.seed_pairs < 1:
        parser.error("--seed-pairs must be at least 1.")
    if args.jobs < 1:
        parser.error("--jobs must be at least 1.")
    if args.match_jobs < 1:
        parser.error("--match-jobs must be at least 1.")

    if args.models is not None and len(args.models) < 2:
        parser.error("At least two --model arguments are required.")
    if not args.side_bias_model and (
        args.side_bias_provider != "auto"
        or args.side_bias_label is not None
        or args.side_bias_api_key_env is not None
        or args.side_bias_base_url is not None
    ):
        parser.error("--side-bias-* options require --side-bias-model.")
    if args.resume and not args.output:
        parser.error("--resume requires --output so the runner can load the saved snapshot.")

    return args


def resolve_competitor_specs(args: argparse.Namespace) -> list[CommanderSpec]:
    if args.roster:
        return load_roster_specs(Path(args.roster), default_timeout_seconds=args.timeout_seconds)
    if args.side_bias_model:
        return build_specs_for_side_bias_audit(
            args.side_bias_model,
            provider=args.side_bias_provider,
            label=args.side_bias_label,
            api_key_env=args.side_bias_api_key_env,
            base_url=args.side_bias_base_url,
            default_timeout_seconds=args.timeout_seconds,
        )
    return build_specs_from_models(args.models, default_timeout_seconds=args.timeout_seconds)


def write_tournament_battle_reports(tournament: TournamentResult, *, output_dir: Path) -> int:
    output_dir.mkdir(parents=True, exist_ok=True)
    written = 0

    for pairing in tournament.pairings:
        for seed_pair in pairing.seed_pairs:
            for match in seed_pair.matches:
                report_path = write_match_battle_report(
                    match,
                    output_dir=output_dir,
                    pairing_index=pairing.pairing_index,
                    seed_pair_index=seed_pair.seed_pair_index,
                )
                match.battle_report_path = str(report_path)
                written += 1

    tournament.battle_reports_dir = str(output_dir)
    return written


def main(argv: Sequence[str] | None = None) -> None:
    args = parse_args(argv)
    competitor_specs = resolve_competitor_specs(args)
    progress_callback = log_tournament_progress if args.live_logs else None
    output_path = Path(args.output) if args.output else None
    tournament = run_tournament(
        competitor_specs=competitor_specs,
        seed_start=args.seed_start,
        seed_pair_count=args.seed_pairs,
        include_rationale=args.with_rationale,
        max_actions=args.max_actions,
        progress_callback=progress_callback,
        jobs=args.jobs,
        match_jobs=args.match_jobs,
        log_decisions=args.log_decisions,
        snapshot_path=output_path,
        resume_from_snapshot=args.resume,
        skip_labels=args.skip_label,
        skip_providers=args.skip_provider,
    )

    battle_report_dir = None
    clear_battle_report_dir = False
    if args.battle_report_dir:
        battle_report_dir = Path(args.battle_report_dir)
    elif args.output:
        battle_report_dir = default_tournament_battle_report_dir(Path(args.output))
        clear_battle_report_dir = not args.resume

    if battle_report_dir is not None:
        if clear_battle_report_dir and battle_report_dir.exists():
            shutil.rmtree(battle_report_dir)
        report_count = write_tournament_battle_reports(tournament, output_dir=battle_report_dir)
        print(f"Wrote {report_count} battle reports to {battle_report_dir}", file=sys.stderr)

    payload = json.dumps(tournament.to_dict(), indent=2)
    if output_path is not None:
        output_path.write_text(payload + "\n", encoding="utf-8")
        print(f"Wrote tournament report to {output_path}", file=sys.stderr)
    else:
        print(payload)


if __name__ == "__main__":
    main()
