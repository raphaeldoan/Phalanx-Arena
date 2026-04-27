from __future__ import annotations

from .models import Coord, Direction, GameState, LogEntry


def footprint_keys_for(position: Coord, facing: Direction) -> tuple[tuple[int, int], ...]:
    return ((position.x, position.y),)


def append_log(state: GameState, message: str) -> None:
    step = len(state.log) + 1
    state.log.append(LogEntry(step=step, message=message))
