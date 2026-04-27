from __future__ import annotations

from pydantic import TypeAdapter

from .engine import get_engine_runtime
from .models import Action, CreateGameRequest, GameSnapshot, GameState, LegalAction, ReplayData, ScenarioSummary


LEGAL_ACTION_AS_ACTION = TypeAdapter(Action)


class GameStore:
    def __init__(self) -> None:
        self._runtime = get_engine_runtime()
        self._games = getattr(self._runtime, "_games", {})

    def list_scenarios(self) -> list[ScenarioSummary]:
        return self._runtime.list_scenarios()

    def create_game(self, request: CreateGameRequest) -> GameSnapshot:
        return self._runtime.create_game(request)

    def create_from_replay(self, replay: ReplayData) -> GameSnapshot:
        return self._runtime.create_from_replay(replay)

    def clone_game(self, game_id: str) -> GameSnapshot:
        return self._runtime.clone_game(game_id)

    def snapshot(self, game_id: str) -> GameSnapshot:
        return self._runtime.snapshot(game_id)

    def apply(self, game_id: str, action: Action) -> GameSnapshot:
        return self._runtime.apply(game_id, action)

    def apply_legal_action(self, game_id: str, legal_action: LegalAction) -> GameSnapshot:
        action = LEGAL_ACTION_AS_ACTION.validate_python(legal_action.model_dump(mode="json"))
        return self.apply(game_id, action)

    def apply_legal_action_index(self, game_id: str, index: int) -> GameSnapshot:
        return self._runtime.apply_legal_action_index(game_id, index)

    def undo(self, game_id: str) -> GameSnapshot:
        return self._runtime.undo(game_id)

    def replay(self, game_id: str) -> ReplayData:
        return self._runtime.replay(game_id)

    def drop_game(self, game_id: str) -> None:
        self._runtime.drop_game(game_id)

    def get(self, game_id: str) -> GameState:
        return self.snapshot(game_id).state
