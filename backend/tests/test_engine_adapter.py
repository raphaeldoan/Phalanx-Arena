import pytest

from backend.engine.runtime import get_engine_runtime
from backend.models import CreateGameRequest
from backend.store import GameStore

ENGINE_ADAPTER_SCENARIO_ID = "classic_battle"


@pytest.fixture(autouse=True)
def clear_runtime_cache():
    get_engine_runtime.cache_clear()
    yield
    get_engine_runtime.cache_clear()


def test_engine_runtime_uses_native_binding_by_default(monkeypatch) -> None:
    monkeypatch.delenv("PHALANX_ENGINE_BACKEND", raising=False)
    store = GameStore()

    assert store._runtime.__class__.__name__ == "NativeRuntimeAdapter"


def test_engine_runtime_accepts_rust_alias(monkeypatch) -> None:
    monkeypatch.setenv("PHALANX_ENGINE_BACKEND", "rust")
    store = GameStore()

    assert store._runtime.__class__.__name__ == "NativeRuntimeAdapter"


def test_engine_runtime_rejects_removed_python_backend(monkeypatch) -> None:
    monkeypatch.setenv("PHALANX_ENGINE_BACKEND", "python")

    with pytest.raises(RuntimeError, match="Python mirror has been removed"):
        GameStore()


@pytest.mark.parametrize("backend_mode", ["auto", "native", "rust"])
def test_clone_game_preserves_state_and_can_diverge(monkeypatch, backend_mode: str) -> None:
    monkeypatch.setenv("PHALANX_ENGINE_BACKEND", backend_mode)
    store = GameStore()
    snapshot = store.create_game(CreateGameRequest(scenario_id=ENGINE_ADAPTER_SCENARIO_ID, seed=7))

    cloned_snapshot = store.clone_game(snapshot.state.game_id)

    assert cloned_snapshot.state.game_id != snapshot.state.game_id
    assert cloned_snapshot.state.model_dump(mode="json", exclude={"game_id"}) == snapshot.state.model_dump(
        mode="json",
        exclude={"game_id"},
    )

    original_after = store.apply_legal_action_index(snapshot.state.game_id, 0)
    cloned_after = store.snapshot(cloned_snapshot.state.game_id)

    assert original_after.state.model_dump(mode="json", exclude={"game_id"}) != cloned_after.state.model_dump(
        mode="json",
        exclude={"game_id"},
    )


@pytest.mark.parametrize("backend_mode", ["auto", "native", "rust"])
def test_apply_legal_action_index_matches_manual_action_application(monkeypatch, backend_mode: str) -> None:
    monkeypatch.setenv("PHALANX_ENGINE_BACKEND", backend_mode)
    store = GameStore()
    index_snapshot = store.create_game(CreateGameRequest(scenario_id=ENGINE_ADAPTER_SCENARIO_ID, seed=7))
    manual_snapshot = store.create_game(CreateGameRequest(scenario_id=ENGINE_ADAPTER_SCENARIO_ID, seed=7))
    helper_snapshot = store.create_game(CreateGameRequest(scenario_id=ENGINE_ADAPTER_SCENARIO_ID, seed=7))

    manual_action = manual_snapshot.legal_actions[0]

    indexed_after = store.apply_legal_action_index(index_snapshot.state.game_id, 0)
    manual_after = store.apply(manual_snapshot.state.game_id, store._runtime.legal_action_to_action(manual_action))
    helper_after = store.apply_legal_action(helper_snapshot.state.game_id, helper_snapshot.legal_actions[0])

    assert indexed_after.model_dump(mode="json", exclude={"state": {"game_id"}}) == manual_after.model_dump(
        mode="json",
        exclude={"state": {"game_id"}},
    )
    assert helper_after.model_dump(mode="json", exclude={"state": {"game_id"}}) == manual_after.model_dump(
        mode="json",
        exclude={"state": {"game_id"}},
    )


@pytest.mark.parametrize("backend_mode", ["auto", "native", "rust"])
def test_drop_game_removes_runtime_state(monkeypatch, backend_mode: str) -> None:
    monkeypatch.setenv("PHALANX_ENGINE_BACKEND", backend_mode)
    store = GameStore()
    snapshot = store.create_game(CreateGameRequest(scenario_id=ENGINE_ADAPTER_SCENARIO_ID, seed=7))

    store.drop_game(snapshot.state.game_id)

    with pytest.raises(KeyError):
        store.snapshot(snapshot.state.game_id)
