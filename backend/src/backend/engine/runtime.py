from __future__ import annotations

import os
from functools import lru_cache
from typing import Protocol

from ..models import Action, CreateGameRequest, GameSnapshot, ReplayData, ScenarioSummary
from .native import NativeEngineUnavailable, create_native_runtime


class EngineRuntime(Protocol):
    _games: object

    def list_scenarios(self) -> list[ScenarioSummary]: ...
    def rules_metadata(self) -> dict[str, object]: ...
    def create_game(self, request: CreateGameRequest) -> GameSnapshot: ...
    def create_from_replay(self, replay: ReplayData) -> GameSnapshot: ...
    def clone_game(self, game_id: str) -> GameSnapshot: ...
    def snapshot(self, game_id: str) -> GameSnapshot: ...
    def apply(self, game_id: str, action: Action) -> GameSnapshot: ...
    def apply_legal_action_index(self, game_id: str, index: int) -> GameSnapshot: ...
    def undo(self, game_id: str) -> GameSnapshot: ...
    def drop_game(self, game_id: str) -> None: ...
    def replay(self, game_id: str) -> ReplayData: ...
    def get(self, game_id: str): ...
    def build_action_catalog(self, legal_actions): ...
    def build_user_prompt(self, snapshot, request, action_catalog, action_history=None, prompt_profile=None): ...
    def describe_legal_action(self, action): ...
    def legal_action_to_action(self, action): ...


def load_engine_runtime() -> EngineRuntime:
    backend_mode = os.environ.get("PHALANX_ENGINE_BACKEND", "auto").strip().lower() or "auto"
    if backend_mode == "python":
        raise RuntimeError(
            "PHALANX_ENGINE_BACKEND=python is no longer supported. "
            "The Python mirror has been removed; use the Rust engine runtime with "
            "PHALANX_ENGINE_BACKEND=auto, native, or rust."
        )
    if backend_mode not in {"auto", "native", "rust"}:
        raise RuntimeError(
            f"Unsupported PHALANX_ENGINE_BACKEND={backend_mode!r}. "
            "Use auto, native, or rust."
        )
    try:
        return create_native_runtime()
    except NativeEngineUnavailable as error:
        raise RuntimeError(
            "The Rust engine CLI runtime is required for backend execution. "
            "Ensure Rust and Cargo are installed, or set PHALANX_ENGINE_CLI_PATH to a built "
            "engine-cli binary."
        ) from error


@lru_cache(maxsize=1)
def get_engine_runtime() -> EngineRuntime:
    return load_engine_runtime()
