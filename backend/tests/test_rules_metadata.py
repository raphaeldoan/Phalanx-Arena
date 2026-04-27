import pytest

from backend.engine.rules_metadata import load_prompt_unit_profiles
from backend.engine.runtime import get_engine_runtime
from backend.models import UnitKind


@pytest.fixture(autouse=True)
def clear_runtime_caches():
    get_engine_runtime.cache_clear()
    load_prompt_unit_profiles.cache_clear()
    yield
    load_prompt_unit_profiles.cache_clear()
    get_engine_runtime.cache_clear()


def test_unit_defaults_are_loaded_from_rust_rules_metadata() -> None:
    metadata = get_engine_runtime().rules_metadata()

    assert metadata["unit_kinds"] == [kind.value for kind in UnitKind]

    defaults = {
        (UnitKind(str(item["kind"])), bool(item["leader"])): item
        for item in metadata["unit_defaults"]
        if isinstance(item, dict)
    }

    for kind in UnitKind:
        for leader in (False, True):
            expected = defaults[(kind, leader)]

            assert expected["kind"] == kind.value
            assert expected["leader"] is leader
            assert isinstance(expected["formation_class"], str)
            assert isinstance(expected["quality"], str)
            assert isinstance(expected["can_evade"], bool)
            assert isinstance(expected["unit_class"], str)
            assert isinstance(expected["pursuit_class"], str)
            assert isinstance(expected["morale_value"], int)
            assert isinstance(expected["formation_state"], str)
            assert isinstance(expected["default_name"], str)


def test_python_prompt_profiles_are_loaded_from_rust_rules_metadata() -> None:
    metadata = get_engine_runtime().rules_metadata()
    rust_profiles = {
        UnitKind(str(item["kind"])): item
        for item in metadata["unit_profiles"]
        if isinstance(item, dict)
    }
    python_profiles = load_prompt_unit_profiles()

    assert set(python_profiles) == set(UnitKind)

    for kind, expected in rust_profiles.items():
        profile = python_profiles[kind]
        assert profile.movement == expected["movement"]
        assert profile.march_bonus == expected["march_bonus"]
        assert profile.close_vs_foot == expected["close_vs_foot"]
        assert profile.close_vs_mounted == expected["close_vs_mounted"]
        assert profile.missile_range == expected["missile_range"]
        assert profile.missile_strength == expected["missile_strength"]
        assert profile.missile_defense == expected["missile_defense"]
        assert profile.support_eligible is expected["support_eligible"]
        assert profile.pursuit_distance == expected["pursuit_distance"]
        assert profile.mounted is expected["mounted"]
        assert profile.screen_height == expected["screen_height"]
        assert [kind.value for kind in profile.pass_through] == expected["pass_through"]
