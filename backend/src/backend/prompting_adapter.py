from __future__ import annotations

from .engine.runtime import get_engine_runtime
from .models import Action, AiTurnRequest, GameSnapshot, LegalAction


def build_user_prompt(
    snapshot: GameSnapshot,
    request: AiTurnRequest,
    action_catalog: list[dict[str, object]],
    action_history: list[Action] | None = None,
    prompt_profile: str | None = None,
) -> str:
    return get_engine_runtime().build_user_prompt(
        snapshot,
        request,
        action_catalog,
        action_history or [],
        prompt_profile=prompt_profile,
    )


def build_action_catalog(legal_actions: list[LegalAction]) -> list[dict[str, object]]:
    return get_engine_runtime().build_action_catalog(legal_actions)


def describe_legal_action(action: LegalAction) -> str:
    return get_engine_runtime().describe_legal_action(action)


def legal_action_to_action(action: LegalAction) -> Action:
    return get_engine_runtime().legal_action_to_action(action)
