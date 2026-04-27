from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from ..models import UnitKind
from .runtime import get_engine_runtime


@dataclass(frozen=True, slots=True)
class PromptUnitProfile:
    movement: int
    march_bonus: int
    close_vs_foot: int
    close_vs_mounted: int
    missile_range: int
    missile_strength: int
    missile_defense: int
    support_eligible: bool
    pursuit_distance: int
    mounted: bool
    screen_height: int
    pass_through: tuple[UnitKind, ...]


@lru_cache(maxsize=1)
def load_prompt_unit_profiles() -> dict[UnitKind, PromptUnitProfile]:
    metadata = get_engine_runtime().rules_metadata()
    profiles: dict[UnitKind, PromptUnitProfile] = {}
    for item in metadata.get("unit_profiles", []):
        if not isinstance(item, dict):
            continue
        kind = UnitKind(str(item["kind"]))
        pass_through = tuple(UnitKind(str(pass_kind)) for pass_kind in item.get("pass_through", []))
        profiles[kind] = PromptUnitProfile(
            int(item["movement"]),
            int(item["march_bonus"]),
            int(item["close_vs_foot"]),
            int(item["close_vs_mounted"]),
            int(item["missile_range"]),
            int(item["missile_strength"]),
            int(item["missile_defense"]),
            bool(item["support_eligible"]),
            int(item["pursuit_distance"]),
            bool(item["mounted"]),
            int(item["screen_height"]),
            pass_through,
        )
    return profiles


def prompt_unit_profile(kind: UnitKind | str) -> PromptUnitProfile | None:
    try:
        unit_kind = UnitKind(kind)
    except ValueError:
        return None
    return load_prompt_unit_profiles().get(unit_kind)
