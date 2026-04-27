from __future__ import annotations

import json
import re
from pathlib import Path

from .headless import MatchResult
from .models import ArmyId, CreateGameRequest
from .store import GameStore

BOUND_CHECKPOINT = 10


def _sanitize_path_component(value: str, *, max_length: int = 48) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.strip().lower())
    normalized = re.sub(r"-{2,}", "-", normalized).strip("-")
    if not normalized:
        normalized = "unnamed"
    return normalized[:max_length].rstrip("-") or "unnamed"


def _scores_by_army(state) -> dict[str, int]:
    scores = {ArmyId.A.value: 0, ArmyId.B.value: 0}
    for entry in state.battle_scores:
        scores[entry.army.value] = entry.total
    return scores


def _losses_by_army(state) -> dict[str, int]:
    losses = {ArmyId.A.value: 0, ArmyId.B.value: 0}
    for entry in state.attrition_status:
        losses[entry.army.value] = entry.losses
    return losses


def _delta_by_army(previous: dict[str, int], current: dict[str, int]) -> dict[str, int]:
    return {
        army: current.get(army, 0) - previous.get(army, 0)
        for army in (ArmyId.A.value, ArmyId.B.value)
    }


def _decisive_logs(logs: list[str]) -> list[str]:
    keywords = (
        "destroyed",
        "morale loss",
        "broken",
        "shaken",
        "fallen",
        "wins:",
        "fled",
        "recoiled",
    )
    return [log for log in logs if any(keyword in log.lower() for keyword in keywords)]


def build_decisive_events(score_events: list[dict[str, object]]) -> list[dict[str, object]]:
    decisive_events: list[dict[str, object]] = []
    previous_scores = {ArmyId.A.value: 0, ArmyId.B.value: 0}
    previous_losses = {ArmyId.A.value: 0, ArmyId.B.value: 0}

    for event in score_events:
        scores = event.get("scores")
        losses = event.get("losses")
        logs = event.get("logs")
        if not isinstance(scores, dict) or not isinstance(losses, dict) or not isinstance(logs, list):
            continue

        current_scores = {
            ArmyId.A.value: int(scores.get(ArmyId.A.value, 0)),
            ArmyId.B.value: int(scores.get(ArmyId.B.value, 0)),
        }
        current_losses = {
            ArmyId.A.value: int(losses.get(ArmyId.A.value, 0)),
            ArmyId.B.value: int(losses.get(ArmyId.B.value, 0)),
        }
        score_delta = _delta_by_army(previous_scores, current_scores)
        loss_delta = _delta_by_army(previous_losses, current_losses)
        if any(score_delta.values()) or any(loss_delta.values()):
            decisive_events.append(
                {
                    "action_index": event.get("action_index"),
                    "bound_number": event.get("bound_number"),
                    "current_player": event.get("current_player"),
                    "scores": current_scores,
                    "losses": current_losses,
                    "score_delta": score_delta,
                    "loss_delta": loss_delta,
                    "logs": _decisive_logs([str(log) for log in logs]),
                }
            )

        previous_scores = current_scores
        previous_losses = current_losses

    return decisive_events


def build_match_battle_report(
    match: MatchResult,
    *,
    pairing_index: int,
    seed_pair_index: int,
    checkpoint_bound: int = BOUND_CHECKPOINT,
) -> dict[str, object]:
    store = GameStore()
    snapshot = store.create_game(
        CreateGameRequest(
            scenario_id=match.replay.scenario_id,
            seed=match.replay.seed,
            deployment_first_army=match.replay.deployment_first_army,
            first_bound_army=match.replay.first_bound_army,
        )
    )
    game_id = snapshot.state.game_id
    previous_log_length = len(snapshot.state.log)
    checkpoint_snapshot = None
    checkpoint_action_index = None
    score_events: list[dict[str, object]] = []

    try:
        for action_index, action in enumerate(match.replay.actions, start=1):
            snapshot = store.apply(game_id, action)
            state = snapshot.state
            if checkpoint_snapshot is None and state.bound_number >= checkpoint_bound:
                checkpoint_snapshot = state.model_dump(mode="json")
                checkpoint_action_index = action_index

            new_logs = [entry.message for entry in state.log[previous_log_length:]]
            previous_log_length = len(state.log)
            score_events.append(
                {
                    "action_index": action_index,
                    "bound_number": state.bound_number,
                    "current_player": state.current_player,
                    "scores": _scores_by_army(state),
                    "losses": _losses_by_army(state),
                    "logs": new_logs,
                }
            )

        final_state = snapshot.state.model_dump(mode="json")
    finally:
        store.drop_game(game_id)

    return {
        "scenario_id": match.scenario_id,
        "seed": match.seed,
        "pairing_index": pairing_index,
        "seed_pair_index": seed_pair_index,
        "match_index": match.match_index,
        "commanders": {
            ArmyId.A.value: {
                "label": match.commander_labels[ArmyId.A],
                "model": match.commander_models[ArmyId.A],
            },
            ArmyId.B.value: {
                "label": match.commander_labels[ArmyId.B],
                "model": match.commander_models[ArmyId.B],
            },
        },
        "winner": match.winner,
        "winner_reason": match.winner_reason,
        "finished": match.finished,
        "max_actions_reached": match.max_actions_reached,
        "action_count": match.action_count,
        "bound10_action_index": checkpoint_action_index,
        "final_action_index": len(match.replay.actions),
        "bound10": checkpoint_snapshot,
        "final": final_state,
        "decisive_events": build_decisive_events(score_events),
        "score_events": score_events,
    }


def battle_report_directory_name(match: MatchResult, *, pairing_index: int) -> str:
    label_a = _sanitize_path_component(match.commander_labels[ArmyId.A])
    label_b = _sanitize_path_component(match.commander_labels[ArmyId.B])
    return (
        f"battle-report-{match.scenario_id}-seed{match.seed:04d}-"
        f"pairing{pairing_index:03d}-match{match.match_index:03d}-{label_a}-vs-{label_b}"
    )


def write_match_battle_report(
    match: MatchResult,
    *,
    output_dir: Path,
    pairing_index: int,
    seed_pair_index: int,
) -> Path:
    report_dir = output_dir / battle_report_directory_name(match, pairing_index=pairing_index)
    report_dir.mkdir(parents=True, exist_ok=True)
    report_payload = build_match_battle_report(
        match,
        pairing_index=pairing_index,
        seed_pair_index=seed_pair_index,
    )
    report_path = report_dir / "state-summary.json"
    report_path.write_text(json.dumps(report_payload, indent=2) + "\n", encoding="utf-8")
    return report_path


def default_tournament_battle_report_dir(output_path: Path) -> Path:
    return output_path.with_name(f"{output_path.stem}-battle-reports")
