from pathlib import Path

import pytest

from backend.engine.runtime import get_engine_runtime


REPO_ROOT = Path(__file__).resolve().parents[2]
ENGINE_SCENARIO_LIBRARY = REPO_ROOT / "engine" / "engine-core" / "scenario_library"


@pytest.fixture(autouse=True)
def clear_runtime_cache():
    get_engine_runtime.cache_clear()
    yield
    get_engine_runtime.cache_clear()


def test_backend_lists_scenarios_from_rust_runtime() -> None:
    summaries = get_engine_runtime().list_scenarios()
    expected_ids = sorted(path.stem for path in ENGINE_SCENARIO_LIBRARY.glob("*.json"))

    assert sorted(summary.scenario_id for summary in summaries) == expected_ids
