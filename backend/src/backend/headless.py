from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence

from .ai_common import AI_INTENT_MAX_CHARS, STRICT_BENCHMARK_PROFILE, AiCommander
from .engine.runtime import get_engine_runtime
from .models import (
    Action,
    AiInputMode,
    AiIntentUpdate,
    AiTurnRequest,
    ArmyId,
    CreateGameRequest,
    DeployAction,
    EndBoundAction,
    FinalizeDeploymentAction,
    GamePhase,
    GameSnapshot,
    LegalAction,
    ReplayData,
)
from .provider_factory import (
    build_commander as build_ai_commander,
    infer_provider,
    resolve_provider_api_key_env,
    resolve_provider_base_url,
    resolve_provider_name,
)
from .store import GameStore


DEFAULT_MAX_ACTIONS = 400
HEADLESS_BENCHMARK_PROFILE = STRICT_BENCHMARK_PROFILE
DecisionLogger = Callable[[dict[str, object]], None]


@dataclass(frozen=True, slots=True)
class CommanderSpec:
    label: str
    model: str
    provider: str = "auto"
    api_key_env: str | None = None
    base_url: str | None = None
    timeout_seconds: float | None = None


@dataclass(slots=True)
class UsageTotals:
    turns: int = 0
    tracked_turns: int = 0
    priced_turns: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    cached_input_tokens: int = 0
    reasoning_tokens: int = 0
    total_cost_usd: float = 0.0

    def add(self, usage) -> None:
        self.turns += 1
        if usage is None:
            return
        if any(
            value is not None
            for value in (
                usage.input_tokens,
                usage.output_tokens,
                usage.total_tokens,
                usage.cached_input_tokens,
                usage.reasoning_tokens,
            )
        ):
            self.tracked_turns += 1
        if usage.input_tokens is not None:
            self.input_tokens += usage.input_tokens
        if usage.output_tokens is not None:
            self.output_tokens += usage.output_tokens
        if usage.total_tokens is not None:
            self.total_tokens += usage.total_tokens
        elif usage.input_tokens is not None or usage.output_tokens is not None:
            self.total_tokens += (usage.input_tokens or 0) + (usage.output_tokens or 0)
        if usage.cached_input_tokens is not None:
            self.cached_input_tokens += usage.cached_input_tokens
        if usage.reasoning_tokens is not None:
            self.reasoning_tokens += usage.reasoning_tokens
        if usage.total_cost_usd is not None:
            self.priced_turns += 1
            self.total_cost_usd += usage.total_cost_usd

    def merge(self, other: "UsageTotals") -> None:
        self.turns += other.turns
        self.tracked_turns += other.tracked_turns
        self.priced_turns += other.priced_turns
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.total_tokens += other.total_tokens
        self.cached_input_tokens += other.cached_input_tokens
        self.reasoning_tokens += other.reasoning_tokens
        self.total_cost_usd += other.total_cost_usd

    def to_dict(self) -> dict[str, object]:
        return {
            "turns": self.turns,
            "tracked_turns": self.tracked_turns,
            "priced_turns": self.priced_turns,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.total_tokens,
            "cached_input_tokens": self.cached_input_tokens,
            "reasoning_tokens": self.reasoning_tokens,
            "total_cost_usd": self.total_cost_usd if self.priced_turns else None,
        }


@dataclass(slots=True)
class MatchResult:
    match_index: int
    scenario_id: str
    seed: int
    input_mode: AiInputMode
    commander_labels: dict[ArmyId, str]
    commander_models: dict[ArmyId, str]
    winner: ArmyId | None
    winner_reason: str | None
    finished: bool
    max_actions_reached: bool
    bound_number: int
    action_count: int
    battle_scores: list[dict[str, object]]
    attrition_status: list[dict[str, object]]
    usage_by_army: dict[ArmyId, UsageTotals]
    replay: ReplayData
    battle_report_path: str | None = None
    deployment_analysis: dict[str, object] | None = None
    behavior_analysis: dict[str, object] | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "match_index": self.match_index,
            "scenario_id": self.scenario_id,
            "seed": self.seed,
            "input_mode": self.input_mode,
            "commander_labels": {army: label for army, label in self.commander_labels.items()},
            "commander_models": {army: model for army, model in self.commander_models.items()},
            "winner": self.winner,
            "winner_reason": self.winner_reason,
            "finished": self.finished,
            "max_actions_reached": self.max_actions_reached,
            "bound_number": self.bound_number,
            "action_count": self.action_count,
            "battle_scores": self.battle_scores,
            "attrition_status": self.attrition_status,
            "usage_by_army": {army: totals.to_dict() for army, totals in self.usage_by_army.items()},
            "replay": self.replay.model_dump(mode="json"),
            "battle_report_path": self.battle_report_path,
            "deployment_analysis": self.deployment_analysis,
            "behavior_analysis": self.behavior_analysis,
        }


@dataclass(slots=True)
class BenchmarkResult:
    scenario_id: str
    input_mode: AiInputMode
    benchmark_profile: str
    include_rationale: bool
    max_actions: int
    commander_labels: dict[ArmyId, str]
    commander_models: dict[ArmyId, str]
    matches: list[MatchResult]

    def to_dict(self) -> dict[str, object]:
        summary_by_army: dict[ArmyId, dict[str, object]] = {}
        for army in (ArmyId.A, ArmyId.B):
            usage_totals = UsageTotals()
            wins = losses = draws = unfinished = 0
            for match in self.matches:
                usage_totals.merge(match.usage_by_army[army])
                if not match.finished:
                    unfinished += 1
                elif match.winner is None:
                    draws += 1
                elif match.winner == army:
                    wins += 1
                else:
                    losses += 1
            summary_by_army[army] = {
                "label": self.commander_labels[army],
                "model": self.commander_models[army],
                "wins": wins,
                "losses": losses,
                "draws": draws,
                "unfinished": unfinished,
                "usage": usage_totals.to_dict(),
            }

        return {
            "scenario_id": self.scenario_id,
            "games": len(self.matches),
            "input_mode": self.input_mode,
            "benchmark_profile": self.benchmark_profile,
            "include_rationale": self.include_rationale,
            "max_actions": self.max_actions,
            "commanders": {
                army: {"label": self.commander_labels[army], "model": self.commander_models[army]}
                for army in (ArmyId.A, ArmyId.B)
            },
            "summary": summary_by_army,
            "matches": [match.to_dict() for match in self.matches],
        }


def resolve_provider(spec: CommanderSpec) -> str:
    try:
        return resolve_provider_name(model=spec.model, provider=spec.provider)
    except RuntimeError as error:
        raise RuntimeError(f"Unsupported provider {spec.provider!r} for commander {spec.label!r}.") from error


def build_commander(spec: CommanderSpec) -> AiCommander:
    return build_commander_for_spec(spec)


def is_terminal_state(state) -> bool:
    return state.winner is not None or getattr(state, "draw", False)


def resolve_api_key_env(spec: CommanderSpec, provider_name: str) -> str:
    return resolve_provider_api_key_env(provider_name, spec.api_key_env)


def resolve_base_url(spec: CommanderSpec, provider_name: str) -> str | None:
    return resolve_provider_base_url(provider_name, spec.base_url)


def build_commander_for_spec(spec: CommanderSpec) -> AiCommander:
    return build_ai_commander(
        model=spec.model,
        provider=spec.provider,
        api_key_env=spec.api_key_env,
        base_url=spec.base_url,
        timeout_seconds=spec.timeout_seconds,
        benchmark_profile=HEADLESS_BENCHMARK_PROFILE,
    )


def should_auto_end_bound(snapshot) -> bool:
    return (
        snapshot.state.phase == GamePhase.BATTLE
        and snapshot.state.pips_remaining == 0
        and len(snapshot.legal_actions) == 1
        and snapshot.legal_actions[0].type == "end_bound"
    )


def can_update_intent(snapshot, army: ArmyId, current_intent: str) -> bool:
    if snapshot.state.current_player != army:
        return False
    if snapshot.state.phase == GamePhase.DEPLOYMENT:
        return not current_intent.strip()
    if snapshot.state.phase != GamePhase.BATTLE:
        return False
    if snapshot.state.pips_remaining != snapshot.state.last_pip_roll:
        return False
    return not any(
        unit.army == army and not unit.eliminated and unit.activated_this_bound
        for unit in snapshot.state.units
    )


def trim_intent(intent: str) -> str:
    return " ".join(intent.split()).strip()[:AI_INTENT_MAX_CHARS]


def legal_action_to_action(action: LegalAction) -> Action:
    return get_engine_runtime().legal_action_to_action(action)


def find_matching_legal_action(snapshot: GameSnapshot, action: Action) -> LegalAction | None:
    for legal_action in snapshot.legal_actions:
        materialized = legal_action_to_action(legal_action)
        if materialized.model_dump(mode="json") == action.model_dump(mode="json"):
            return legal_action
    return None


def active_reserve_unit_ids(snapshot: GameSnapshot) -> list[str]:
    return sorted(
        unit.id
        for unit in getattr(snapshot.state, "units", [])
        if unit.army == snapshot.state.current_player
        and not unit.eliminated
        and not getattr(unit, "deployed", True)
    )


def first_deploy_action_for_unit(snapshot: GameSnapshot, unit_id: str) -> DeployAction | None:
    for legal_action in snapshot.legal_actions:
        if legal_action.type == "deploy" and legal_action.unit_id == unit_id:
            return legal_action_to_action(legal_action)  # type: ignore[return-value]
    return None


def finalize_action_if_legal(snapshot: GameSnapshot) -> FinalizeDeploymentAction | None:
    for legal_action in snapshot.legal_actions:
        if legal_action.type == "finalize_deployment":
            return FinalizeDeploymentAction(type="finalize_deployment")
    return None


def apply_if_still_legal(store: GameStore, game_id: str, snapshot: GameSnapshot, action: Action) -> GameSnapshot | None:
    if find_matching_legal_action(snapshot, action) is None:
        return None
    return store.apply(game_id, action)


def apply_deployment_batch(
    *,
    store: GameStore,
    game_id: str,
    snapshot: GameSnapshot,
    selected_actions: list[Action],
) -> tuple[GameSnapshot, int]:
    applied_count = 0
    finalized = False
    used_unit_ids: set[str] = set()

    for action in selected_actions:
        if snapshot.state.phase != GamePhase.DEPLOYMENT:
            break
        if action.type == "deploy":
            if action.unit_id in used_unit_ids:
                continue
            next_snapshot = apply_if_still_legal(store, game_id, snapshot, action)
            if next_snapshot is None:
                continue
            snapshot = next_snapshot
            used_unit_ids.add(action.unit_id)
            applied_count += 1
            continue
        if action.type == "finalize_deployment":
            next_snapshot = apply_if_still_legal(store, game_id, snapshot, action)
            if next_snapshot is None:
                continue
            snapshot = next_snapshot
            finalized = True
            applied_count += 1
            break

    while snapshot.state.phase == GamePhase.DEPLOYMENT:
        reserve_unit_ids = active_reserve_unit_ids(snapshot)
        if not reserve_unit_ids:
            break
        deployed_one = False
        for unit_id in reserve_unit_ids:
            action = first_deploy_action_for_unit(snapshot, unit_id)
            if action is None:
                continue
            snapshot = store.apply(game_id, action)
            applied_count += 1
            deployed_one = True
            break
        if not deployed_one:
            break

    if not finalized and snapshot.state.phase == GamePhase.DEPLOYMENT:
        finalize_action = finalize_action_if_legal(snapshot)
        if finalize_action is not None:
            snapshot = store.apply(game_id, finalize_action)
            applied_count += 1

    return snapshot, applied_count


def apply_battle_batch(
    *,
    store: GameStore,
    game_id: str,
    snapshot: GameSnapshot,
    selected_actions: list[Action],
    behavior_analysis: dict[str, object],
    match_index: int,
    seed: int,
    army: ArmyId,
    label: str | None,
    model: str | None,
    action_number: int,
    max_actions: int,
    decision_logger: DecisionLogger | None = None,
) -> tuple[GameSnapshot, int]:
    applied_count = 0
    order_number = 0
    model_snapshot = snapshot
    record_battle_model_turn(behavior_analysis, army, model_snapshot)

    for action in selected_actions:
        order_number += 1
        if applied_count >= max(0, max_actions - 1):
            break
        if snapshot.state.phase != GamePhase.BATTLE or is_terminal_state(snapshot.state):
            break
        if action.type == "end_bound":
            break

        if find_matching_legal_action(snapshot, action) is None:
            emit_decision_event(
                decision_logger,
                kind="order_skipped",
                phase="bound_plan",
                match_index=match_index,
                seed=seed,
                army=army,
                label=label,
                model=model,
                bound_number=snapshot.state.bound_number,
                action_number=action_number,
                order_number=order_number,
                action_type=action.type,
                reason="not_legal_after_prior_orders",
            )
            continue

        try:
            next_snapshot = store.apply(game_id, action)
            record_battle_choice(behavior_analysis, army, model_snapshot, action)
            snapshot = next_snapshot
            applied_count += 1
        except Exception as error:
            emit_decision_event(
                decision_logger,
                kind="order_skipped",
                phase="bound_plan",
                match_index=match_index,
                seed=seed,
                army=army,
                label=label,
                model=model,
                bound_number=snapshot.state.bound_number,
                action_number=action_number,
                order_number=order_number,
                action_type=action.type,
                reason=type(error).__name__,
                error=str(error),
            )

    if (
        applied_count < max_actions
        and snapshot.state.phase == GamePhase.BATTLE
        and not is_terminal_state(snapshot.state)
        and find_matching_legal_action(snapshot, EndBoundAction(type="end_bound")) is not None
    ):
        snapshot = store.apply(game_id, EndBoundAction(type="end_bound"))
        applied_count += 1

    return snapshot, applied_count


def should_use_hidden_deployment(snapshot: GameSnapshot) -> bool:
    if snapshot.state.phase != GamePhase.DEPLOYMENT:
        return False
    units = list(getattr(snapshot.state, "units", []) or [])
    armies_with_reserves = {
        unit.army
        for unit in units
        if not unit.eliminated and not getattr(unit, "deployed", True)
    }
    return ArmyId.A in armies_with_reserves and ArmyId.B in armies_with_reserves


def deployment_first_army_other(army: ArmyId) -> ArmyId:
    return ArmyId.B if army == ArmyId.A else ArmyId.A


def emit_decision_event(decision_logger: DecisionLogger | None, **event: object) -> None:
    if decision_logger is None:
        return
    decision_logger({key: value for key, value in event.items() if value is not None})


def deployment_choice_log_fields(snapshot: GameSnapshot) -> dict[str, object]:
    deploy_actions = [action for action in snapshot.legal_actions if action.type == "deploy"]
    if not deploy_actions:
        return {}
    units = {action.unit_id for action in deploy_actions}
    cells = {(action.destination.x, action.destination.y) for action in deploy_actions}
    return {
        "deployment_unit_count": len(units),
        "deployment_cell_count": len(cells),
    }


def decision_selected_indices(decision) -> list[int]:
    if decision.action_indices is not None:
        return list(decision.action_indices)
    return [decision.action_index]


def emit_model_decision_event(
    decision_logger: DecisionLogger | None,
    *,
    phase: str,
    match_index: int,
    seed: int,
    army: ArmyId,
    label: str | None,
    model: str | None,
    bound_number: int,
    legal_action_count: int,
    decision,
    elapsed_seconds: float,
    deployment_batch: bool = False,
    battle_batch: bool = False,
    action_number: int | None = None,
    ) -> None:
    placements = decision.deployment_placements or []
    battle_orders = decision.battle_orders or []
    usage = decision.usage
    emit_decision_event(
        decision_logger,
        kind="decision",
        phase=phase,
        match_index=match_index,
        seed=seed,
        army=army,
        label=label,
        model=model or decision.model,
        bound_number=bound_number,
        action_number=action_number,
        legal_action_count=legal_action_count,
        selected_action_index=decision.action_index,
        selected_action_indices=decision_selected_indices(decision),
        action_summary=decision.action_summary,
        deployment_batch=deployment_batch,
        battle_batch=battle_batch,
        deployment_placements=len(placements),
        battle_orders=len(battle_orders),
        reasoning=decision.reasoning or None,
        intent_update=decision.intent_update,
        elapsed_seconds=round(elapsed_seconds, 2),
        input_tokens=None if usage is None else usage.input_tokens,
        output_tokens=None if usage is None else usage.output_tokens,
        reasoning_tokens=None if usage is None else usage.reasoning_tokens,
        total_tokens=None if usage is None else usage.total_tokens,
        total_cost_usd=None if usage is None else usage.total_cost_usd,
    )


def collect_hidden_deployment_decisions(
    *,
    store: GameStore,
    scenario_id: str,
    seed: int,
    match_index: int,
    deployment_first_army: ArmyId,
    first_bound_army: ArmyId,
    commanders_by_army: dict[ArmyId, AiCommander],
    commander_labels: dict[ArmyId, str],
    commander_models: dict[ArmyId, str],
    usage_by_army: dict[ArmyId, UsageTotals],
    include_rationale: bool,
    decision_logger: DecisionLogger | None = None,
) -> dict[ArmyId, AiDecision]:
    decisions: dict[ArmyId, AiDecision] = {}
    for army in (deployment_first_army, deployment_first_army_other(deployment_first_army)):
        planning_snapshot = store.create_game(
            CreateGameRequest(
                scenario_id=scenario_id,
                seed=seed,
                deployment_first_army=army,
                first_bound_army=first_bound_army,
            )
        )
        planning_game_id = planning_snapshot.state.game_id
        try:
            commander = commanders_by_army[army]
            turn_request = AiTurnRequest(
                army=army,
                input_mode=AiInputMode.TEXT_ONLY,
                include_rationale=include_rationale,
                deployment_batch=True,
            )
            started_at = time.monotonic()
            emit_decision_event(
                decision_logger,
                kind="decision_request",
                phase="deployment",
                match_index=match_index,
                seed=seed,
                army=army,
                label=commander_labels.get(army),
                model=commander_models.get(army),
                bound_number=planning_snapshot.state.bound_number,
                legal_action_count=len(planning_snapshot.legal_actions),
                deployment_batch=True,
                **deployment_choice_log_fields(planning_snapshot),
            )
            try:
                decision = commander.choose_action(planning_snapshot, turn_request, [])
            except Exception as error:
                emit_decision_event(
                    decision_logger,
                    kind="decision_error",
                    phase="deployment",
                    match_index=match_index,
                    seed=seed,
                    army=army,
                    label=commander_labels.get(army),
                    model=commander_models.get(army),
                    bound_number=planning_snapshot.state.bound_number,
                    elapsed_seconds=round(time.monotonic() - started_at, 2),
                    error_type=type(error).__name__,
                    error=str(error),
                )
                raise
            usage_by_army[army].add(decision.usage)
            emit_model_decision_event(
                decision_logger,
                phase="deployment",
                match_index=match_index,
                seed=seed,
                army=army,
                label=commander_labels.get(army),
                model=commander_models.get(army),
                bound_number=planning_snapshot.state.bound_number,
                legal_action_count=len(planning_snapshot.legal_actions),
                decision=decision,
                elapsed_seconds=time.monotonic() - started_at,
                deployment_batch=True,
            )
            decisions[army] = decision
        finally:
            store.drop_game(planning_game_id)
    return decisions


def apply_hidden_deployment_decisions(
    *,
    store: GameStore,
    game_id: str,
    snapshot: GameSnapshot,
    decisions: dict[ArmyId, AiDecision],
    behavior_analysis: dict[str, object],
) -> tuple[GameSnapshot, int]:
    applied_total = 0
    while snapshot.state.phase == GamePhase.DEPLOYMENT:
        active_army = snapshot.state.current_player
        decision = decisions.get(active_army)
        if decision is None:
            break
        selected_actions = decision.actions if decision.actions is not None else [decision.action]
        snapshot, applied_count = apply_deployment_batch(
            store=store,
            game_id=game_id,
            snapshot=snapshot,
            selected_actions=selected_actions,
        )
        record_deployment_response(
            behavior_analysis,
            active_army,
            decision,
            selected_actions,
            applied_count,
        )
        applied_total += applied_count
        if applied_count == 0:
            break
    return snapshot, applied_total


def build_empty_behavior_analysis() -> dict[str, object]:
    return {
        str(army): {
            "model_turns": 0,
            "action_counts": {},
            "group_actions_available_turns": 0,
            "group_actions_selected": 0,
            "group_units_ordered": 0,
            "single_move_actions": 0,
            "single_moves_when_group_available": 0,
            "end_bound_actions": 0,
            "pips_left_on_model_end_bound": 0,
            "deployment_response": {
                "model_placement_count": 0,
                "duplicate_unit_placement_count": 0,
                "model_deploy_actions_returned": 0,
                "invalid_or_unmatched_placement_count": 0,
                "applied_batch_actions": 0,
                "deterministic_completion_actions": 0,
            },
        }
        for army in (ArmyId.A, ArmyId.B)
    }


def record_deployment_response(
    behavior_analysis: dict[str, object],
    army: ArmyId,
    decision,
    selected_actions: list[Action],
    applied_count: int,
) -> None:
    army_analysis = behavior_analysis[str(army)]
    deployment = army_analysis["deployment_response"]
    placements = decision.deployment_placements or []
    placement_unit_ids = [placement.unit_id for placement in placements]
    duplicate_count = len(placement_unit_ids) - len(set(placement_unit_ids))
    returned_deploy_actions = sum(1 for action in selected_actions if action.type == "deploy")
    deployment["model_placement_count"] += len(placements)
    deployment["duplicate_unit_placement_count"] += duplicate_count
    deployment["model_deploy_actions_returned"] += returned_deploy_actions
    deployment["invalid_or_unmatched_placement_count"] += max(0, len(placements) - returned_deploy_actions)
    deployment["applied_batch_actions"] += applied_count
    deployment["deterministic_completion_actions"] += max(0, applied_count - returned_deploy_actions)


def battle_group_actions(snapshot: GameSnapshot) -> list[LegalAction]:
    return [
        legal_action for legal_action in snapshot.legal_actions
        if legal_action.type in {"group_move", "group_march_move", "group_charge"}
    ]


def record_battle_model_turn(
    behavior_analysis: dict[str, object],
    army: ArmyId,
    snapshot: GameSnapshot,
) -> None:
    army_analysis = behavior_analysis[str(army)]
    army_analysis["model_turns"] += 1
    if battle_group_actions(snapshot):
        army_analysis["group_actions_available_turns"] += 1


def record_battle_choice(
    behavior_analysis: dict[str, object],
    army: ArmyId,
    snapshot: GameSnapshot,
    action: Action,
) -> None:
    army_analysis = behavior_analysis[str(army)]
    action_counts = army_analysis["action_counts"]
    action_counts[action.type] = action_counts.get(action.type, 0) + 1

    group_actions = battle_group_actions(snapshot)
    if action.type in {"group_move", "group_march_move", "group_charge"}:
        army_analysis["group_actions_selected"] += 1
        army_analysis["group_units_ordered"] += len(action.unit_ids)
        return

    if action.type in {"move", "march_move", "charge"}:
        army_analysis["single_move_actions"] += 1
        if any(action.unit_id in getattr(group_action, "unit_ids", []) for group_action in group_actions):
            army_analysis["single_moves_when_group_available"] += 1
        return

    if action.type == "end_bound":
        army_analysis["end_bound_actions"] += 1
        army_analysis["pips_left_on_model_end_bound"] += snapshot.state.pips_remaining


def build_deployment_analysis(snapshot: GameSnapshot) -> dict[str, object]:
    return {
        str(army): analyze_deployment_for_army(snapshot, army)
        for army in (ArmyId.A, ArmyId.B)
    }


def analyze_deployment_for_army(snapshot: GameSnapshot, army: ArmyId) -> dict[str, object]:
    units = [
        unit for unit in getattr(snapshot.state, "units", [])
        if unit.army == army and not unit.eliminated and getattr(unit, "deployed", True)
    ]
    leaders = [unit for unit in units if unit.leader and not getattr(unit, "off_map", False)]
    leader = sorted(leaders, key=lambda unit: unit.id)[0] if leaders else None
    pikes = [unit for unit in units if str(getattr(unit, "unit_class", "")) == "Pike"]
    xs = [unit.position.x for unit in units]
    ys = [unit.position.y for unit in units]
    leader_distances = [
        manhattan(unit.position, leader.position)
        for unit in units
        if leader is not None and unit.id != leader.id
    ]
    largest_pike_group = largest_orthogonal_group_size([(unit.position.x, unit.position.y) for unit in pikes])
    pike_units = len(pikes)
    return {
        "units": len(units),
        "in_command": sum(1 for unit in units if unit.in_command),
        "out_of_command": sum(1 for unit in units if not unit.in_command),
        "leader": None if leader is None else {"unit_id": leader.id, "x": leader.position.x, "y": leader.position.y},
        "average_leader_distance": round(sum(leader_distances) / len(leader_distances), 2) if leader_distances else None,
        "frontage": max(xs) - min(xs) + 1 if xs else 0,
        "depth": max(ys) - min(ys) + 1 if ys else 0,
        "pike_units": pike_units,
        "ordered_pikes": sum(1 for unit in pikes if str(getattr(unit, "formation_state", "")) == "OrderedPike"),
        "largest_pike_group": largest_pike_group,
        "pike_contiguity": round(largest_pike_group / pike_units, 2) if pike_units else None,
    }


def manhattan(left, right) -> int:
    return abs(left.x - right.x) + abs(left.y - right.y)


def largest_orthogonal_group_size(points: list[tuple[int, int]]) -> int:
    remaining = set(points)
    largest = 0
    while remaining:
        start = remaining.pop()
        stack = [start]
        size = 1
        while stack:
            x, y = stack.pop()
            for neighbor in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if neighbor in remaining:
                    remaining.remove(neighbor)
                    stack.append(neighbor)
                    size += 1
        largest = max(largest, size)
    return largest


def run_headless_match(
    *,
    scenario_id: str,
    seed: int,
    match_index: int,
    commanders_by_army: dict[ArmyId, AiCommander],
    commander_labels: dict[ArmyId, str],
    commander_models: dict[ArmyId, str],
    include_rationale: bool = False,
    max_actions: int = DEFAULT_MAX_ACTIONS,
    deployment_first_army: ArmyId = ArmyId.A,
    first_bound_army: ArmyId = ArmyId.A,
    decision_logger: DecisionLogger | None = None,
) -> MatchResult:
    store = GameStore()
    snapshot = store.create_game(
        CreateGameRequest(
            scenario_id=scenario_id,
            seed=seed,
            deployment_first_army=deployment_first_army,
            first_bound_army=first_bound_army,
        )
    )
    game_id = snapshot.state.game_id
    usage_by_army = {ArmyId.A: UsageTotals(), ArmyId.B: UsageTotals()}
    intents_by_army = {ArmyId.A: "", ArmyId.B: ""}
    intent_updates: list[AiIntentUpdate] = []
    deployment_analysis: dict[str, object] | None = None
    behavior_analysis = build_empty_behavior_analysis()
    action_count = 0

    try:
        if should_use_hidden_deployment(snapshot):
            deployment_decisions = collect_hidden_deployment_decisions(
                store=store,
                scenario_id=scenario_id,
                seed=seed,
                match_index=match_index,
                deployment_first_army=deployment_first_army,
                first_bound_army=first_bound_army,
                commanders_by_army=commanders_by_army,
                commander_labels=commander_labels,
                commander_models=commander_models,
                usage_by_army=usage_by_army,
                include_rationale=include_rationale,
                decision_logger=decision_logger,
            )
            snapshot, applied_deployment_actions = apply_hidden_deployment_decisions(
                store=store,
                game_id=game_id,
                snapshot=snapshot,
                decisions=deployment_decisions,
                behavior_analysis=behavior_analysis,
            )
            action_count += applied_deployment_actions
            if snapshot.state.phase == GamePhase.BATTLE:
                deployment_analysis = build_deployment_analysis(snapshot)

        while not is_terminal_state(snapshot.state) and action_count < max_actions:
            active_army = snapshot.state.current_player
            applied_this_iteration = 1
            if should_auto_end_bound(snapshot):
                snapshot = store.apply(game_id, EndBoundAction(type="end_bound"))
            else:
                commander = commanders_by_army[active_army]
                replay = store.replay(game_id)
                current_intent = intents_by_army[active_army]
                intent_update_allowed = can_update_intent(snapshot, active_army, current_intent)
                deployment_batch = snapshot.state.phase == GamePhase.DEPLOYMENT
                battle_batch = snapshot.state.phase == GamePhase.BATTLE
                turn_request = AiTurnRequest(
                    army=active_army,
                    input_mode=AiInputMode.TEXT_ONLY,
                    include_rationale=include_rationale,
                    current_intent=current_intent,
                    can_update_intent=intent_update_allowed,
                    deployment_batch=deployment_batch,
                    battle_batch=battle_batch,
                )
                decision_started_at = time.monotonic()
                decision_phase = (
                    "deployment"
                    if deployment_batch
                    else "bound_plan"
                    if battle_batch
                    else "battle"
                )
                emit_decision_event(
                    decision_logger,
                    kind="decision_request",
                    phase=decision_phase,
                    match_index=match_index,
                    seed=seed,
                    army=active_army,
                    label=commander_labels.get(active_army),
                    model=commander_models.get(active_army),
                    bound_number=snapshot.state.bound_number,
                    action_number=action_count + 1,
                    legal_action_count=len(snapshot.legal_actions),
                    deployment_batch=deployment_batch,
                    battle_batch=battle_batch,
                    **(deployment_choice_log_fields(snapshot) if deployment_batch else {}),
                )
                try:
                    decision = commander.choose_action(snapshot, turn_request, replay.actions)
                except Exception as error:
                    emit_decision_event(
                        decision_logger,
                        kind="decision_error",
                        phase=decision_phase,
                        match_index=match_index,
                        seed=seed,
                        army=active_army,
                        label=commander_labels.get(active_army),
                        model=commander_models.get(active_army),
                        bound_number=snapshot.state.bound_number,
                        action_number=action_count + 1,
                        elapsed_seconds=round(time.monotonic() - decision_started_at, 2),
                        error_type=type(error).__name__,
                        error=str(error),
                    )
                    raise
                usage_by_army[active_army].add(decision.usage)
                emit_model_decision_event(
                    decision_logger,
                    phase=decision_phase,
                    match_index=match_index,
                    seed=seed,
                    army=active_army,
                    label=commander_labels.get(active_army),
                    model=commander_models.get(active_army),
                    bound_number=snapshot.state.bound_number,
                    legal_action_count=len(snapshot.legal_actions),
                    decision=decision,
                    elapsed_seconds=time.monotonic() - decision_started_at,
                    deployment_batch=deployment_batch,
                    battle_batch=battle_batch,
                    action_number=action_count + 1,
                )
                if intent_update_allowed and decision.intent_update:
                    intent = trim_intent(decision.intent_update)
                    if intent:
                        intents_by_army[active_army] = intent
                        intent_updates.append(
                            AiIntentUpdate(
                                army=active_army,
                                bound_number=snapshot.state.bound_number,
                                action_number=action_count + 1,
                                intent=intent,
                            )
                        )
                if deployment_batch:
                    selected_actions = decision.actions if decision.actions is not None else [decision.action]
                    was_deployment = snapshot.state.phase == GamePhase.DEPLOYMENT
                    snapshot, applied_this_iteration = apply_deployment_batch(
                        store=store,
                        game_id=game_id,
                        snapshot=snapshot,
                        selected_actions=selected_actions,
                    )
                    record_deployment_response(
                        behavior_analysis,
                        active_army,
                        decision,
                        selected_actions,
                        applied_this_iteration,
                    )
                    if was_deployment and snapshot.state.phase == GamePhase.BATTLE and deployment_analysis is None:
                        deployment_analysis = build_deployment_analysis(snapshot)
                    if applied_this_iteration == 0:
                        snapshot = store.apply(game_id, decision.action)
                        applied_this_iteration = 1
                else:
                    selected_actions = decision.actions if decision.actions is not None else [decision.action]
                    snapshot, applied_this_iteration = apply_battle_batch(
                        store=store,
                        game_id=game_id,
                        snapshot=snapshot,
                        selected_actions=selected_actions,
                        behavior_analysis=behavior_analysis,
                        match_index=match_index,
                        seed=seed,
                        army=active_army,
                        label=commander_labels.get(active_army),
                        model=commander_models.get(active_army),
                        action_number=action_count + 1,
                        max_actions=max_actions - action_count,
                        decision_logger=decision_logger,
                    )
            action_count += applied_this_iteration

        final_replay = store.replay(game_id).model_copy(update={"intent_updates": intent_updates})
        return MatchResult(
            match_index=match_index,
            scenario_id=scenario_id,
            seed=seed,
            input_mode=AiInputMode.TEXT_ONLY,
            commander_labels=commander_labels,
            commander_models=commander_models,
            winner=snapshot.state.winner,
            winner_reason=snapshot.state.winner_reason,
            finished=is_terminal_state(snapshot.state),
            max_actions_reached=not is_terminal_state(snapshot.state) and action_count >= max_actions,
            bound_number=snapshot.state.bound_number,
            action_count=action_count,
            battle_scores=[score.model_dump(mode="json") for score in snapshot.state.battle_scores],
            attrition_status=[status.model_dump(mode="json") for status in snapshot.state.attrition_status],
            usage_by_army=usage_by_army,
            replay=final_replay,
            deployment_analysis=deployment_analysis,
            behavior_analysis=behavior_analysis,
        )
    finally:
        store.drop_game(game_id)


def run_headless_benchmark(
    *,
    scenario_id: str,
    seeds: Sequence[int],
    commanders_by_army: dict[ArmyId, AiCommander],
    commander_labels: dict[ArmyId, str],
    commander_models: dict[ArmyId, str],
    include_rationale: bool = False,
    max_actions: int = DEFAULT_MAX_ACTIONS,
) -> BenchmarkResult:
    matches = [
        run_headless_match(
            scenario_id=scenario_id,
            seed=seed,
            match_index=index,
            commanders_by_army=commanders_by_army,
            commander_labels=commander_labels,
            commander_models=commander_models,
            include_rationale=include_rationale,
            max_actions=max_actions,
        )
        for index, seed in enumerate(seeds)
    ]
    return BenchmarkResult(
        scenario_id=scenario_id,
        input_mode=AiInputMode.TEXT_ONLY,
        benchmark_profile=HEADLESS_BENCHMARK_PROFILE,
        include_rationale=include_rationale,
        max_actions=max_actions,
        commander_labels=commander_labels,
        commander_models=commander_models,
        matches=matches,
    )


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run backend-only headless AI vs AI matches using the exact textual board description."
    )
    parser.add_argument("--scenario", default="classic_battle", help="Scenario id to run.")
    parser.add_argument("--games", type=int, default=1, help="Number of games to run.")
    parser.add_argument("--seed-start", type=int, default=7, help="Starting seed for the first game.")
    parser.add_argument("--max-actions", type=int, default=DEFAULT_MAX_ACTIONS, help="Safety cap on actions per game.")
    parser.add_argument("--model-a", required=True, help="Model name for army A.")
    parser.add_argument("--model-b", required=True, help="Model name for army B.")
    parser.add_argument("--label-a", help="Display label for army A. Defaults to model A.")
    parser.add_argument("--label-b", help="Display label for army B. Defaults to model B.")
    parser.add_argument(
        "--provider-a",
        default="auto",
        choices=("auto", "openai", "anthropic", "xai", "mistral", "gemini", "together", "openrouter"),
        help="Provider for army A. Defaults to inferring from the model name.",
    )
    parser.add_argument(
        "--provider-b",
        default="auto",
        choices=("auto", "openai", "anthropic", "xai", "mistral", "gemini", "together", "openrouter"),
        help="Provider for army B. Defaults to inferring from the model name.",
    )
    parser.add_argument("--api-key-env-a", help="Environment variable holding army A API key. Defaults per provider.")
    parser.add_argument("--api-key-env-b", help="Environment variable holding army B API key. Defaults per provider.")
    parser.add_argument("--base-url-a", help="Optional provider-specific base URL for army A.")
    parser.add_argument("--base-url-b", help="Optional provider-specific base URL for army B.")
    parser.add_argument("--timeout-seconds", type=float, default=45.0, help="HTTP timeout per AI turn.")
    parser.add_argument(
        "--with-rationale",
        action="store_true",
        help="Ask each model for a one or two sentence rationale alongside the chosen action index.",
    )
    parser.add_argument("--output", help="Optional path for the JSON benchmark report.")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> None:
    args = parse_args(argv)
    seeds = [args.seed_start + index for index in range(args.games)]

    commander_specs = {
        ArmyId.A: CommanderSpec(
            label=args.label_a or args.model_a,
            model=args.model_a,
            provider=args.provider_a,
            api_key_env=args.api_key_env_a,
            base_url=args.base_url_a,
            timeout_seconds=args.timeout_seconds,
        ),
        ArmyId.B: CommanderSpec(
            label=args.label_b or args.model_b,
            model=args.model_b,
            provider=args.provider_b,
            api_key_env=args.api_key_env_b,
            base_url=args.base_url_b,
            timeout_seconds=args.timeout_seconds,
        ),
    }
    commanders_by_army = {army: build_commander(spec) for army, spec in commander_specs.items()}
    commander_labels = {army: spec.label for army, spec in commander_specs.items()}
    commander_models = {army: spec.model for army, spec in commander_specs.items()}

    benchmark = run_headless_benchmark(
        scenario_id=args.scenario,
        seeds=seeds,
        commanders_by_army=commanders_by_army,
        commander_labels=commander_labels,
        commander_models=commander_models,
        include_rationale=args.with_rationale,
        max_actions=args.max_actions,
    )

    payload = json.dumps(benchmark.to_dict(), indent=2)
    if args.output:
        output_path = Path(args.output)
        output_path.write_text(payload + "\n", encoding="utf-8")
        print(f"Wrote headless benchmark report to {output_path}", file=sys.stderr)
    else:
        print(payload)
