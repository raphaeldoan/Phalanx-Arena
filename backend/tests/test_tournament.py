import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from io import StringIO
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.ai_common import AiDecisionError
from backend.battle_reports import write_match_battle_report
from backend.headless import CommanderSpec, MatchResult, UsageTotals
from backend.models import (
    ArmyId,
    AttritionStatus,
    BattleScore,
    Coord,
    Direction,
    EndBoundAction,
    GamePhase,
    GameState,
    LogEntry,
    ReplayData,
    Unit,
    UnitKind,
)
from backend.tournament import (
    PairingResult,
    SeedPairResult,
    TOURNAMENT_SCENARIO_ID,
    TournamentResult,
    log_tournament_progress,
    load_roster_specs,
    main,
    parse_args,
    resolve_competitor_specs,
    run_tournament,
    write_tournament_battle_reports,
)


def make_match(
    *,
    match_index: int,
    seed: int,
    commander_labels: dict[ArmyId, str],
    commander_models: dict[ArmyId, str],
    winner: ArmyId | None,
    finished: bool = True,
    battle_score_a: int | None = None,
    battle_score_b: int | None = None,
    deployment_first_army: ArmyId | None = None,
    first_bound_army: ArmyId | None = None,
) -> MatchResult:
    if deployment_first_army is None:
        deployment_first_army = ArmyId.A if match_index % 4 in (0, 1) else ArmyId.B
    if first_bound_army is None:
        first_bound_army = deployment_first_army
    if battle_score_a is None:
        battle_score_a = 5 if winner == ArmyId.A else 2 if winner == ArmyId.B else 3
    if battle_score_b is None:
        battle_score_b = 5 if winner == ArmyId.B else 2 if winner == ArmyId.A else 3
    return MatchResult(
        match_index=match_index,
        scenario_id=TOURNAMENT_SCENARIO_ID,
        seed=seed,
        input_mode="text_only",
        commander_labels=commander_labels,
        commander_models=commander_models,
        winner=winner,
        winner_reason="synthetic-result" if winner is not None else None,
        finished=finished,
        max_actions_reached=not finished,
        bound_number=12,
        action_count=48,
        battle_scores=[
            {"army": ArmyId.A, "enemy_losses": 0, "total": battle_score_a},
            {"army": ArmyId.B, "enemy_losses": 0, "total": battle_score_b},
        ],
        attrition_status=[
            {"army": ArmyId.A, "starting_units": 12, "losses": 1, "target_losses": 4},
            {"army": ArmyId.B, "starting_units": 12, "losses": 1, "target_losses": 4},
        ],
        usage_by_army={
            ArmyId.A: UsageTotals(turns=1, total_tokens=100, priced_turns=1, total_cost_usd=0.01),
            ArmyId.B: UsageTotals(turns=1, total_tokens=120, priced_turns=1, total_cost_usd=0.02),
        },
        replay=ReplayData(
            scenario_id=TOURNAMENT_SCENARIO_ID,
            seed=seed,
            deployment_first_army=deployment_first_army,
            first_bound_army=first_bound_army,
            actions=[],
        ),
    )


def make_state(
    *,
    seed: int,
    bound_number: int,
    current_player: ArmyId,
    log_messages: list[str],
    score_a: int = 0,
    score_b: int = 0,
    losses_a: int = 0,
    losses_b: int = 0,
    winner: ArmyId | None = None,
    winner_reason: str | None = None,
) -> GameState:
    return GameState(
        game_id="fake-game",
        engine_name="Test Engine",
        engine_version="0.0",
        design_basis="test-only",
        scenario_id=TOURNAMENT_SCENARIO_ID,
        scenario_name="Classic Battle",
        board_width=12,
        board_height=8,
        phase=GamePhase.BATTLE,
        bound_number=bound_number,
        current_player=current_player,
        pips_remaining=2,
        last_pip_roll=4,
        seed=seed,
        roll_index=bound_number,
        winner=winner,
        winner_reason=winner_reason,
        terrain=[],
        deployment_zones=[],
        deployment_ready=[ArmyId.A, ArmyId.B],
        attrition_status=[
            AttritionStatus(army=ArmyId.A, starting_units=12, losses=losses_a, target_losses=4),
            AttritionStatus(army=ArmyId.B, starting_units=12, losses=losses_b, target_losses=4),
        ],
        battle_scores=[
            BattleScore(army=ArmyId.A, enemy_losses=score_a, total=score_a),
            BattleScore(army=ArmyId.B, enemy_losses=score_b, total=score_b),
        ],
        victory_target=5,
        units=[
            Unit(
                id="A-1",
                army=ArmyId.A,
                name="Alpha Unit",
                kind=UnitKind.SPEAR,
                position=Coord(x=0, y=0),
                facing=Direction.N,
            ),
            Unit(
                id="B-1",
                army=ArmyId.B,
                name="Beta Unit",
                kind=UnitKind.SPEAR,
                position=Coord(x=1, y=1),
                facing=Direction.S,
            ),
        ],
        log=[LogEntry(step=index + 1, message=message) for index, message in enumerate(log_messages)],
        recent_resolutions=[],
    )


def test_load_roster_specs_supports_strings_and_objects(tmp_path: Path) -> None:
    roster_path = tmp_path / "roster.json"
    roster_path.write_text(
        """[
  "gpt-5.4-mini",
  {"label": "Claude", "model": "claude-opus-4-6", "provider": "anthropic"}
]""",
        encoding="utf-8",
    )

    specs = load_roster_specs(roster_path, default_timeout_seconds=30.0)

    assert specs == [
        CommanderSpec(label="gpt-5.4-mini", model="gpt-5.4-mini", timeout_seconds=30.0),
        CommanderSpec(
            label="Claude",
            model="claude-opus-4-6",
            provider="anthropic",
            timeout_seconds=30.0,
        ),
    ]


def test_repo_tournament_roster_loads_expected_competitors() -> None:
    roster_path = Path(__file__).resolve().parents[1] / "tournament-roster.json"

    specs = load_roster_specs(roster_path, default_timeout_seconds=45.0)

    assert specs == [
        CommanderSpec(
            label="OpenAI GPT-5.5",
            model="openai/gpt-5.5",
            provider="openrouter",
            timeout_seconds=45.0,
        ),
        CommanderSpec(
            label="Claude Opus 4.7",
            model="anthropic/claude-opus-4.7",
            provider="openrouter",
            timeout_seconds=45.0,
        ),
        CommanderSpec(
            label="Grok 4.20 Reasoning",
            model="x-ai/grok-4.20",
            provider="openrouter",
            timeout_seconds=45.0,
        ),
        CommanderSpec(
            label="Gemini 3.1 Pro Preview",
            model="google/gemini-3.1-pro-preview",
            provider="openrouter",
            timeout_seconds=45.0,
        ),
        CommanderSpec(
            label="Mistral Large 3",
            model="mistralai/mistral-large-2512",
            provider="openrouter",
            timeout_seconds=45.0,
        ),
        CommanderSpec(
            label="OpenAI GPT-5.4 Mini Baseline",
            model="openai/gpt-5.4-mini",
            provider="openrouter",
            timeout_seconds=45.0,
        ),
        CommanderSpec(
            label="Mistral Small Baseline",
            model="mistralai/mistral-small-2603",
            provider="openrouter",
            timeout_seconds=45.0,
        ),
    ]


def test_side_bias_audit_builds_two_copies_of_one_model() -> None:
    args = parse_args(
        [
            "--side-bias-model",
            "gpt-5.4",
            "--side-bias-provider",
            "openai",
            "--side-bias-label",
            "GPT-5.4",
            "--side-bias-api-key-env",
            "OPENAI_API_KEY",
            "--side-bias-base-url",
            "https://example.test/v1",
            "--timeout-seconds",
            "12",
        ]
    )

    specs = resolve_competitor_specs(args)

    assert specs == [
        CommanderSpec(
            label="GPT-5.4 side-audit copy 1",
            model="gpt-5.4",
            provider="openai",
            api_key_env="OPENAI_API_KEY",
            base_url="https://example.test/v1",
            timeout_seconds=12.0,
        ),
        CommanderSpec(
            label="GPT-5.4 side-audit copy 2",
            model="gpt-5.4",
            provider="openai",
            api_key_env="OPENAI_API_KEY",
            base_url="https://example.test/v1",
            timeout_seconds=12.0,
        ),
    ]


def test_side_bias_options_require_side_bias_model() -> None:
    with pytest.raises(SystemExit):
        parse_args(["--model", "alpha", "--model", "beta", "--side-bias-provider", "openai"])


def test_run_tournament_uses_role_complete_seed_pairs_and_majority_winner(monkeypatch) -> None:
    def fake_build_commander(spec: CommanderSpec):
        return f"commander:{spec.label}"

    def fake_resolve_provider(spec: CommanderSpec) -> str:
        return "openai"

    def fake_run_headless_match(
        *,
        scenario_id: str,
        seed: int,
        match_index: int,
        commanders_by_army,
        commander_labels,
        commander_models,
        include_rationale: bool = False,
        max_actions: int = 400,
        deployment_first_army: ArmyId = ArmyId.A,
        first_bound_army: ArmyId = ArmyId.A,
    ) -> MatchResult:
        assert scenario_id == TOURNAMENT_SCENARIO_ID
        alpha_is_a = commander_labels[ArmyId.A] == "Alpha"
        winner = None
        if seed == 7:
            winner = ArmyId.A if alpha_is_a else ArmyId.B
        elif seed == 8:
            winner = ArmyId.B if alpha_is_a else ArmyId.A
        elif seed == 9:
            winner = ArmyId.A if alpha_is_a else None
        elif seed == 10:
            winner = None
        elif seed == 11:
            winner = None if alpha_is_a else ArmyId.B
        return make_match(
            match_index=match_index,
            seed=seed,
            commander_labels=commander_labels,
            commander_models=commander_models,
            winner=winner,
            finished=True,
        )

    monkeypatch.setattr("backend.tournament.build_commander", fake_build_commander)
    monkeypatch.setattr("backend.tournament.resolve_provider", fake_resolve_provider)
    monkeypatch.setattr("backend.tournament.run_headless_match", fake_run_headless_match)

    result = run_tournament(
        competitor_specs=[
            CommanderSpec(label="Alpha", model="alpha-model"),
            CommanderSpec(label="Beta", model="beta-model"),
        ],
        seed_start=7,
        seed_pair_count=5,
    )

    assert isinstance(result, TournamentResult)
    assert result.scenario_id == TOURNAMENT_SCENARIO_ID
    assert len(result.pairings) == 1
    assert result.pairings[0].winner == "Alpha"
    assert result.pairings[0].summary_by_label["Alpha"]["seed_pair_wins"] == 3
    assert result.pairings[0].summary_by_label["Beta"]["seed_pair_wins"] == 1
    assert result.pairings[0].summary_by_label["Alpha"]["game_points"] == 12.0
    assert result.pairings[0].summary_by_label["Beta"]["game_points"] == 8.0
    assert result.standings[0].label == "Alpha"
    assert result.standings[0].game_points == 12.0
    assert result.standings[1].label == "Beta"
    assert result.standings[1].game_points == 8.0
    payload = result.to_dict()
    assert payload["games_per_pairing"] == 20
    assert payload["side_summary"]["A"]["games"] == 20
    assert payload["side_summary"]["B"]["games"] == 20
    assert payload["role_summary"]["roster_position"]["left"]["games"] == 20
    assert payload["role_summary"]["roster_position"]["right"]["games"] == 20
    assert payload["role_summary"]["deployment_order"]["first"]["games"] == 20
    assert payload["role_summary"]["deployment_order"]["second"]["games"] == 20
    assert payload["role_summary"]["first_bound_order"]["first"]["games"] == 20
    assert payload["role_summary"]["first_bound_order"]["second"]["games"] == 20


def test_run_tournament_breaks_total_point_ties_with_head_to_head(monkeypatch) -> None:
    def fake_build_commander(spec: CommanderSpec):
        return f"commander:{spec.label}"

    def fake_resolve_provider(spec: CommanderSpec) -> str:
        return "openai"

    def fake_run_headless_match(
        *,
        scenario_id: str,
        seed: int,
        match_index: int,
        commanders_by_army,
        commander_labels,
        commander_models,
        include_rationale: bool = False,
        max_actions: int = 400,
        deployment_first_army: ArmyId = ArmyId.A,
        first_bound_army: ArmyId = ArmyId.A,
    ) -> MatchResult:
        pair = frozenset(commander_labels.values())
        winner = None

        if pair == {"Alpha", "Beta"}:
            winner = ArmyId.A if commander_labels[ArmyId.A] == "Alpha" else None
        elif pair == {"Alpha", "Gamma"}:
            winner = ArmyId.A
        elif pair == {"Beta", "Gamma"}:
            winner = ArmyId.A if commander_labels[ArmyId.A] == "Beta" else ArmyId.B

        return make_match(
            match_index=match_index,
            seed=seed,
            commander_labels=commander_labels,
            commander_models=commander_models,
            winner=winner,
            finished=True,
        )

    monkeypatch.setattr("backend.tournament.build_commander", fake_build_commander)
    monkeypatch.setattr("backend.tournament.resolve_provider", fake_resolve_provider)
    monkeypatch.setattr("backend.tournament.run_headless_match", fake_run_headless_match)

    result = run_tournament(
        competitor_specs=[
            CommanderSpec(label="Alpha", model="alpha-model"),
            CommanderSpec(label="Beta", model="beta-model"),
            CommanderSpec(label="Gamma", model="gamma-model"),
        ],
        seed_start=7,
        seed_pair_count=1,
    )

    assert [standing.label for standing in result.standings] == ["Alpha", "Beta", "Gamma"]
    assert result.standings[0].game_points == 5.0
    assert result.standings[1].game_points == 5.0
    assert result.standings[0].head_to_head_game_points == 3.0
    assert result.standings[1].head_to_head_game_points == 1.0


def test_run_tournament_parallel_keeps_pairings_ordered(monkeypatch) -> None:
    def fake_build_commander(spec: CommanderSpec):
        return f"commander:{spec.label}"

    def fake_resolve_provider(spec: CommanderSpec) -> str:
        return "openai"

    def fake_run_headless_match(
        *,
        scenario_id: str,
        seed: int,
        match_index: int,
        commanders_by_army,
        commander_labels,
        commander_models,
        include_rationale: bool = False,
        max_actions: int = 400,
        deployment_first_army: ArmyId = ArmyId.A,
        first_bound_army: ArmyId = ArmyId.A,
    ) -> MatchResult:
        pair = frozenset(commander_labels.values())
        if pair == {"Alpha", "Gamma"}:
            time.sleep(0.05)
        elif pair == {"Alpha", "Beta"}:
            time.sleep(0.02)

        if "Alpha" in pair:
            winner_label = "Alpha"
        else:
            winner_label = "Beta"
        winner = ArmyId.A if commander_labels[ArmyId.A] == winner_label else ArmyId.B

        return make_match(
            match_index=match_index,
            seed=seed,
            commander_labels=commander_labels,
            commander_models=commander_models,
            winner=winner,
            finished=True,
        )

    monkeypatch.setattr("backend.tournament.build_commander", fake_build_commander)
    monkeypatch.setattr("backend.tournament.resolve_provider", fake_resolve_provider)
    monkeypatch.setattr("backend.tournament.run_headless_match", fake_run_headless_match)

    result = run_tournament(
        competitor_specs=[
            CommanderSpec(label="Alpha", model="alpha-model"),
            CommanderSpec(label="Beta", model="beta-model"),
            CommanderSpec(label="Gamma", model="gamma-model"),
        ],
        seed_start=7,
        seed_pair_count=1,
        jobs=2,
        _executor_factory=lambda workers: ThreadPoolExecutor(max_workers=workers),
    )

    assert [pairing.pairing_index for pairing in result.pairings] == [0, 1, 2]
    assert [pairing.competitor_labels for pairing in result.pairings] == [
        ("Alpha", "Beta"),
        ("Alpha", "Gamma"),
        ("Beta", "Gamma"),
    ]
    assert [standing.label for standing in result.standings] == ["Alpha", "Beta", "Gamma"]


def test_run_tournament_parallel_starts_balanced_pairings(monkeypatch) -> None:
    def fake_build_commander(spec: CommanderSpec):
        return f"commander:{spec.label}"

    def fake_resolve_provider(spec: CommanderSpec) -> str:
        return "openai"

    def fake_run_headless_match(
        *,
        scenario_id: str,
        seed: int,
        match_index: int,
        commanders_by_army,
        commander_labels,
        commander_models,
        include_rationale: bool = False,
        max_actions: int = 400,
        deployment_first_army: ArmyId = ArmyId.A,
        first_bound_army: ArmyId = ArmyId.A,
    ) -> MatchResult:
        time.sleep(0.01)
        return make_match(
            match_index=match_index,
            seed=seed,
            commander_labels=commander_labels,
            commander_models=commander_models,
            winner=ArmyId.A,
            finished=True,
        )

    monkeypatch.setattr("backend.tournament.build_commander", fake_build_commander)
    monkeypatch.setattr("backend.tournament.resolve_provider", fake_resolve_provider)
    monkeypatch.setattr("backend.tournament.run_headless_match", fake_run_headless_match)

    events = []
    run_tournament(
        competitor_specs=[
            CommanderSpec(label="Alpha", model="alpha-model"),
            CommanderSpec(label="Beta", model="beta-model"),
            CommanderSpec(label="Gamma", model="gamma-model"),
            CommanderSpec(label="Delta", model="delta-model"),
            CommanderSpec(label="Epsilon", model="epsilon-model"),
            CommanderSpec(label="Zeta", model="zeta-model"),
        ],
        seed_start=7,
        seed_pair_count=1,
        jobs=3,
        progress_callback=events.append,
        _executor_factory=lambda workers: ThreadPoolExecutor(max_workers=workers),
    )

    started_pairings = [event.pairing_labels for event in events if event.kind == "pairing_started"]
    assert started_pairings[:3] == [
        ("Alpha", "Beta"),
        ("Gamma", "Delta"),
        ("Epsilon", "Zeta"),
    ]
    assert len({label for pairing in started_pairings[:3] for label in pairing or ()}) == 6


def test_run_tournament_records_ai_decision_errors_as_match_forfeits(monkeypatch) -> None:
    failed_once = {"value": False}

    def fake_build_commander(spec: CommanderSpec):
        return f"commander:{spec.label}"

    def fake_resolve_provider(spec: CommanderSpec) -> str:
        return "openai"

    def fake_run_headless_match(
        *,
        scenario_id: str,
        seed: int,
        match_index: int,
        commanders_by_army,
        commander_labels,
        commander_models,
        include_rationale: bool = False,
        max_actions: int = 400,
        deployment_first_army: ArmyId = ArmyId.A,
        first_bound_army: ArmyId = ArmyId.A,
        decision_logger=None,
    ) -> MatchResult:
        if not failed_once["value"]:
            failed_once["value"] = True
            if decision_logger is not None:
                decision_logger(
                    {
                        "kind": "decision_error",
                        "phase": "bound_plan",
                        "army": ArmyId.B,
                        "bound_number": 3,
                        "action_number": 12,
                    }
                )
            raise AiDecisionError("OpenRouter selected action index 79, which is outside the legal action range.")

        return make_match(
            match_index=match_index,
            seed=seed,
            commander_labels=commander_labels,
            commander_models=commander_models,
            winner=ArmyId.A,
            finished=True,
            deployment_first_army=deployment_first_army,
            first_bound_army=first_bound_army,
        )

    monkeypatch.setattr("backend.tournament.build_commander", fake_build_commander)
    monkeypatch.setattr("backend.tournament.resolve_provider", fake_resolve_provider)
    monkeypatch.setattr("backend.tournament.run_headless_match", fake_run_headless_match)

    result = run_tournament(
        competitor_specs=[
            CommanderSpec(label="Alpha", model="alpha-model"),
            CommanderSpec(label="Beta", model="beta-model"),
        ],
        seed_start=7,
        seed_pair_count=1,
        log_decisions=True,
    )

    matches = result.pairings[0].seed_pairs[0].matches
    failed_match = next(match for match in matches if match.winner_reason and "decision_error_forfeit" in match.winner_reason)
    assert len(matches) == 4
    assert failed_match.finished
    assert failed_match.winner == ArmyId.A
    assert failed_match.replay.deployment_first_army == failed_match.replay.first_bound_army
    assert "outside the legal action range" in failed_match.winner_reason


def test_run_tournament_parallelizes_matches_and_keeps_seed_order(monkeypatch) -> None:
    activity = {"current": 0, "max": 0}
    activity_lock = threading.Lock()

    def fake_build_commander(spec: CommanderSpec):
        return f"commander:{spec.label}"

    def fake_resolve_provider(spec: CommanderSpec) -> str:
        return "openai"

    def fake_run_headless_match(
        *,
        scenario_id: str,
        seed: int,
        match_index: int,
        commanders_by_army,
        commander_labels,
        commander_models,
        include_rationale: bool = False,
        max_actions: int = 400,
        deployment_first_army: ArmyId = ArmyId.A,
        first_bound_army: ArmyId = ArmyId.A,
    ) -> MatchResult:
        with activity_lock:
            activity["current"] += 1
            activity["max"] = max(activity["max"], activity["current"])
        try:
            time.sleep({0: 0.08, 1: 0.02, 2: 0.06, 3: 0.01}[match_index % 4])
            return make_match(
                match_index=match_index,
                seed=seed,
                commander_labels=commander_labels,
                commander_models=commander_models,
                winner=ArmyId.A,
                finished=True,
            )
        finally:
            with activity_lock:
                activity["current"] -= 1

    monkeypatch.setattr("backend.tournament.build_commander", fake_build_commander)
    monkeypatch.setattr("backend.tournament.resolve_provider", fake_resolve_provider)
    monkeypatch.setattr("backend.tournament.run_headless_match", fake_run_headless_match)

    result = run_tournament(
        competitor_specs=[
            CommanderSpec(label="Alpha", model="alpha-model"),
            CommanderSpec(label="Beta", model="beta-model"),
        ],
        seed_start=7,
        seed_pair_count=2,
        match_jobs=2,
    )

    assert activity["max"] >= 2
    assert len(result.pairings) == 1
    assert result.pairings[0].competitor_labels == ("Alpha", "Beta")
    assert [seed_pair.seed_pair_index for seed_pair in result.pairings[0].seed_pairs] == [0, 1]
    assert [match.match_index for match in result.pairings[0].seed_pairs[0].matches] == [0, 1, 2, 3]
    assert [match.match_index for match in result.pairings[0].seed_pairs[1].matches] == [4, 5, 6, 7]
    assert [
        (
            match.commander_labels[ArmyId.A],
            match.commander_labels[ArmyId.B],
            match.replay.deployment_first_army,
            match.replay.first_bound_army,
        )
        for match in result.pairings[0].seed_pairs[0].matches
    ] == [
        ("Alpha", "Beta", ArmyId.A, ArmyId.A),
        ("Beta", "Alpha", ArmyId.A, ArmyId.A),
        ("Alpha", "Beta", ArmyId.B, ArmyId.B),
        ("Beta", "Alpha", ArmyId.B, ArmyId.B),
    ]


def test_parallel_matches_build_fresh_commanders_per_scheduled_match(monkeypatch) -> None:
    build_counter = {"value": 0}
    build_lock = threading.Lock()
    seen_by_label = {"Alpha": [], "Beta": []}

    def fake_build_commander(spec: CommanderSpec):
        with build_lock:
            build_index = build_counter["value"]
            build_counter["value"] += 1
        return SimpleNamespace(label=spec.label, build_index=build_index)

    def fake_resolve_provider(spec: CommanderSpec) -> str:
        return "openai"

    def fake_run_headless_match(
        *,
        scenario_id: str,
        seed: int,
        match_index: int,
        commanders_by_army,
        commander_labels,
        commander_models,
        include_rationale: bool = False,
        max_actions: int = 400,
        deployment_first_army: ArmyId = ArmyId.A,
        first_bound_army: ArmyId = ArmyId.A,
    ) -> MatchResult:
        with build_lock:
            for army, label in commander_labels.items():
                seen_by_label[label].append(commanders_by_army[army].build_index)
        time.sleep(0.01)
        return make_match(
            match_index=match_index,
            seed=seed,
            commander_labels=commander_labels,
            commander_models=commander_models,
            winner=ArmyId.A,
            finished=True,
        )

    monkeypatch.setattr("backend.tournament.build_commander", fake_build_commander)
    monkeypatch.setattr("backend.tournament.resolve_provider", fake_resolve_provider)
    monkeypatch.setattr("backend.tournament.run_headless_match", fake_run_headless_match)

    run_tournament(
        competitor_specs=[
            CommanderSpec(label="Alpha", model="alpha-model"),
            CommanderSpec(label="Beta", model="beta-model"),
        ],
        seed_start=7,
        seed_pair_count=2,
        match_jobs=2,
    )

    assert len(seen_by_label["Alpha"]) == 8
    assert len(seen_by_label["Beta"]) == 8
    assert len(set(seen_by_label["Alpha"])) == 8
    assert len(set(seen_by_label["Beta"])) == 8


def test_run_tournament_resume_recovers_partial_pairing_progress(monkeypatch, tmp_path: Path) -> None:
    run_number = {"value": 0}
    calls_by_run: dict[int, list[int]] = {0: [], 1: []}

    def fake_build_commander(spec: CommanderSpec):
        return f"commander:{spec.label}"

    def fake_resolve_provider(spec: CommanderSpec) -> str:
        return "openai"

    def fake_run_headless_match(
        *,
        scenario_id: str,
        seed: int,
        match_index: int,
        commanders_by_army,
        commander_labels,
        commander_models,
        include_rationale: bool = False,
        max_actions: int = 400,
        deployment_first_army: ArmyId = ArmyId.A,
        first_bound_army: ArmyId = ArmyId.A,
    ) -> MatchResult:
        calls_by_run[run_number["value"]].append(match_index)
        if run_number["value"] == 0 and match_index == 0:
            raise RuntimeError("synthetic rate limit")

        winner = ArmyId.A if commander_labels[ArmyId.A] == "Alpha" else ArmyId.B
        return make_match(
            match_index=match_index,
            seed=seed,
            commander_labels=commander_labels,
            commander_models=commander_models,
            winner=winner,
            finished=True,
        )

    monkeypatch.setattr("backend.tournament.build_commander", fake_build_commander)
    monkeypatch.setattr("backend.tournament.resolve_provider", fake_resolve_provider)
    monkeypatch.setattr("backend.tournament.run_headless_match", fake_run_headless_match)

    output_path = tmp_path / "tournament.json"

    with pytest.raises(RuntimeError, match="synthetic rate limit"):
        run_tournament(
            competitor_specs=[
                CommanderSpec(label="Alpha", model="alpha-model"),
                CommanderSpec(label="Beta", model="beta-model"),
            ],
            seed_start=7,
            seed_pair_count=2,
            snapshot_path=output_path,
        )

    assert output_path.exists()
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert payload["pairings"] == []

    checkpoint_dir = tmp_path / "tournament-checkpoints"
    checkpoint_files = sorted(checkpoint_dir.glob("pairing-*.json"))
    assert len(checkpoint_files) == 1
    checkpoint_payload = json.loads(checkpoint_files[0].read_text(encoding="utf-8"))
    assert checkpoint_payload["pairing_index"] == 0
    assert len(checkpoint_payload["seed_pairs"]) == 1
    assert len(checkpoint_payload["seed_pairs"][0]["matches"]) == 1
    assert calls_by_run[0] == [1, 0]

    run_number["value"] = 1
    result = run_tournament(
        competitor_specs=[
            CommanderSpec(label="Alpha", model="alpha-model"),
            CommanderSpec(label="Beta", model="beta-model"),
        ],
        seed_start=7,
        seed_pair_count=2,
        snapshot_path=output_path,
        resume_from_snapshot=True,
    )

    assert calls_by_run[1] == [0, 3, 2, 4, 5, 6, 7]
    assert len(result.pairings) == 1
    assert [match.match_index for match in result.pairings[0].seed_pairs[0].matches] == [0, 1, 2, 3]
    assert [match.match_index for match in result.pairings[0].seed_pairs[1].matches] == [4, 5, 6, 7]
    assert not checkpoint_dir.exists()


def test_run_tournament_resume_skips_completed_pairings(monkeypatch, tmp_path: Path) -> None:
    call_count = {"matches": 0}

    def fake_build_commander(spec: CommanderSpec):
        return f"commander:{spec.label}"

    def fake_resolve_provider(spec: CommanderSpec) -> str:
        return "openai"

    def fake_run_headless_match(
        *,
        scenario_id: str,
        seed: int,
        match_index: int,
        commanders_by_army,
        commander_labels,
        commander_models,
        include_rationale: bool = False,
        max_actions: int = 400,
        deployment_first_army: ArmyId = ArmyId.A,
        first_bound_army: ArmyId = ArmyId.A,
    ) -> MatchResult:
        call_count["matches"] += 1
        winner_label = min(commander_labels.values())
        winner = ArmyId.A if commander_labels[ArmyId.A] == winner_label else ArmyId.B
        return make_match(
            match_index=match_index,
            seed=seed,
            commander_labels=commander_labels,
            commander_models=commander_models,
            winner=winner,
            finished=True,
        )

    monkeypatch.setattr("backend.tournament.build_commander", fake_build_commander)
    monkeypatch.setattr("backend.tournament.resolve_provider", fake_resolve_provider)
    monkeypatch.setattr("backend.tournament.run_headless_match", fake_run_headless_match)

    output_path = tmp_path / "tournament.json"
    specs = [
        CommanderSpec(label="Alpha", model="alpha-model"),
        CommanderSpec(label="Beta", model="beta-model"),
        CommanderSpec(label="Gamma", model="gamma-model"),
    ]

    first_result = run_tournament(
        competitor_specs=specs,
        seed_start=7,
        seed_pair_count=1,
        snapshot_path=output_path,
    )

    assert len(first_result.pairings) == 3
    assert call_count["matches"] == 12

    payload = json.loads(output_path.read_text(encoding="utf-8"))
    payload["pairings"] = payload["pairings"][:1]
    payload["standings"] = []
    output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    call_count["matches"] = 0
    resumed_result = run_tournament(
        competitor_specs=specs,
        seed_start=7,
        seed_pair_count=1,
        snapshot_path=output_path,
        resume_from_snapshot=True,
    )

    assert len(resumed_result.pairings) == 3
    assert call_count["matches"] == 8


def test_run_tournament_can_skip_provider_pairings_then_resume_them(monkeypatch, tmp_path: Path) -> None:
    calls_by_pair: list[frozenset[str]] = []

    def fake_build_commander(spec: CommanderSpec):
        return f"commander:{spec.label}"

    def fake_resolve_provider(spec: CommanderSpec) -> str:
        return spec.provider or "openai"

    def fake_run_headless_match(
        *,
        scenario_id: str,
        seed: int,
        match_index: int,
        commanders_by_army,
        commander_labels,
        commander_models,
        include_rationale: bool = False,
        max_actions: int = 400,
        deployment_first_army: ArmyId = ArmyId.A,
        first_bound_army: ArmyId = ArmyId.A,
    ) -> MatchResult:
        calls_by_pair.append(frozenset(commander_labels.values()))
        winner_label = min(commander_labels.values())
        winner = ArmyId.A if commander_labels[ArmyId.A] == winner_label else ArmyId.B
        return make_match(
            match_index=match_index,
            seed=seed,
            commander_labels=commander_labels,
            commander_models=commander_models,
            winner=winner,
            finished=True,
        )

    monkeypatch.setattr("backend.tournament.build_commander", fake_build_commander)
    monkeypatch.setattr("backend.tournament.resolve_provider", fake_resolve_provider)
    monkeypatch.setattr("backend.tournament.run_headless_match", fake_run_headless_match)

    output_path = tmp_path / "tournament.json"
    specs = [
        CommanderSpec(label="Alpha", model="alpha-model", provider="openai"),
        CommanderSpec(label="Claude", model="claude-model", provider="anthropic"),
        CommanderSpec(label="Beta", model="beta-model", provider="openai"),
    ]

    first_phase = run_tournament(
        competitor_specs=specs,
        seed_start=7,
        seed_pair_count=1,
        snapshot_path=output_path,
        skip_providers=["anthropic"],
    )

    assert [pairing.pairing_index for pairing in first_phase.pairings] == [1]
    assert first_phase.pairings[0].competitor_labels == ("Alpha", "Beta")
    assert calls_by_pair == [frozenset({"Alpha", "Beta"})] * 4

    saved_payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert [competitor["label"] for competitor in saved_payload["competitors"]] == ["Alpha", "Claude", "Beta"]
    assert [pairing["pairing_index"] for pairing in saved_payload["pairings"]] == [1]

    calls_by_pair.clear()
    resumed = run_tournament(
        competitor_specs=specs,
        seed_start=7,
        seed_pair_count=1,
        snapshot_path=output_path,
        resume_from_snapshot=True,
    )

    assert [pairing.pairing_index for pairing in resumed.pairings] == [0, 1, 2]
    assert calls_by_pair == [frozenset({"Alpha", "Claude"})] * 4 + [frozenset({"Claude", "Beta"})] * 4


def test_main_clears_default_battle_report_dir_for_fresh_output(monkeypatch, tmp_path: Path) -> None:
    roster_path = tmp_path / "roster.json"
    roster_path.write_text(
        """[
  {"label": "Alpha", "model": "alpha-model", "provider": "openai"},
  {"label": "Beta", "model": "beta-model", "provider": "openai"}
]""",
        encoding="utf-8",
    )
    output_path = tmp_path / "tournament.json"
    battle_report_dir = tmp_path / "tournament-battle-reports"
    stale_report = battle_report_dir / "stale" / "state-summary.json"
    stale_report.parent.mkdir(parents=True)
    stale_report.write_text("old", encoding="utf-8")

    def fake_run_tournament(**kwargs) -> TournamentResult:
        return TournamentResult(
            scenario_id=TOURNAMENT_SCENARIO_ID,
            benchmark_profile="strict",
            include_rationale=False,
            max_actions=400,
            seed_start=7,
            seed_pairs=1,
            competitors=[
                {"label": "Alpha", "model": "alpha-model", "provider": "openai"},
                {"label": "Beta", "model": "beta-model", "provider": "openai"},
            ],
            standings=[],
            pairings=[],
        )

    def fake_write_tournament_battle_reports(tournament: TournamentResult, *, output_dir: Path) -> int:
        assert not stale_report.exists()
        output_dir.mkdir(parents=True)
        (output_dir / "fresh.txt").write_text("new", encoding="utf-8")
        tournament.battle_reports_dir = str(output_dir)
        return 0

    monkeypatch.setattr("backend.tournament.run_tournament", fake_run_tournament)
    monkeypatch.setattr("backend.tournament.write_tournament_battle_reports", fake_write_tournament_battle_reports)

    main(
        [
            "--roster",
            str(roster_path),
            "--seed-pairs",
            "1",
            "--seed-start",
            "7",
            "--output",
            str(output_path),
        ]
    )

    assert (battle_report_dir / "fresh.txt").exists()


def test_write_match_battle_report_replays_timeline(monkeypatch, tmp_path: Path) -> None:
    from backend import battle_reports

    actions = [EndBoundAction(type="end_bound") for _ in range(11)]
    match = make_match(
        match_index=3,
        seed=7,
        commander_labels={ArmyId.A: "Alpha", ArmyId.B: "Beta"},
        commander_models={ArmyId.A: "alpha-model", ArmyId.B: "beta-model"},
        winner=ArmyId.A,
        finished=True,
    )
    match.replay = ReplayData(scenario_id=TOURNAMENT_SCENARIO_ID, seed=7, actions=actions)

    snapshots = [
        make_state(seed=7, bound_number=1, current_player=ArmyId.A, log_messages=["A deployment phase begins."])
    ]
    for action_index in range(1, 12):
        cumulative_logs = ["A deployment phase begins."] + [f"Action {index} resolved." for index in range(1, action_index + 1)]
        snapshots.append(
            make_state(
                seed=7,
                bound_number=action_index,
                current_player=ArmyId.A if action_index % 2 else ArmyId.B,
                log_messages=cumulative_logs,
                score_a=5 if action_index == 11 else 0,
                score_b=2 if action_index == 11 else 0,
                losses_a=1 if action_index == 11 else 0,
                losses_b=4 if action_index == 11 else 0,
                winner=ArmyId.A if action_index == 11 else None,
                winner_reason="synthetic-result" if action_index == 11 else None,
            )
        )

    class FakeBattleReportStore:
        def __init__(self) -> None:
            self.index = 0

        def create_game(self, request):
            return SimpleNamespace(state=snapshots[0])

        def apply(self, game_id: str, action):
            self.index += 1
            return SimpleNamespace(state=snapshots[self.index])

        def drop_game(self, game_id: str) -> None:
            return None

    monkeypatch.setattr(battle_reports, "GameStore", FakeBattleReportStore)

    report_path = write_match_battle_report(
        match,
        output_dir=tmp_path,
        pairing_index=1,
        seed_pair_index=2,
    )

    assert report_path.name == "state-summary.json"
    payload = __import__("json").loads(report_path.read_text(encoding="utf-8"))
    assert payload["pairing_index"] == 1
    assert payload["seed_pair_index"] == 2
    assert payload["commanders"]["A"]["label"] == "Alpha"
    assert payload["bound10_action_index"] == 10
    assert payload["final_action_index"] == 11
    assert payload["bound10"]["bound_number"] == 10
    assert payload["final"]["winner"] == "A"
    assert payload["score_events"][0]["logs"] == ["Action 1 resolved."]
    assert payload["score_events"][-1]["scores"] == {"A": 5, "B": 2}
    assert payload["decisive_events"] == [
        {
            "action_index": 11,
            "bound_number": 11,
            "current_player": "A",
            "scores": {"A": 5, "B": 2},
            "losses": {"A": 1, "B": 4},
            "score_delta": {"A": 5, "B": 2},
            "loss_delta": {"A": 1, "B": 4},
            "logs": [],
        }
    ]
    assert "battle-report-classic_battle-seed0007-pairing001-match003-alpha-vs-beta" in str(report_path.parent)


def test_write_tournament_battle_reports_attaches_paths(monkeypatch, tmp_path: Path) -> None:
    match_a = make_match(
        match_index=0,
        seed=7,
        commander_labels={ArmyId.A: "Alpha", ArmyId.B: "Beta"},
        commander_models={ArmyId.A: "alpha-model", ArmyId.B: "beta-model"},
        winner=ArmyId.A,
    )
    match_b = make_match(
        match_index=1,
        seed=7,
        commander_labels={ArmyId.A: "Beta", ArmyId.B: "Alpha"},
        commander_models={ArmyId.A: "beta-model", ArmyId.B: "alpha-model"},
        winner=ArmyId.B,
    )
    tournament = TournamentResult(
        scenario_id=TOURNAMENT_SCENARIO_ID,
        benchmark_profile="strict",
        include_rationale=False,
        max_actions=400,
        seed_start=7,
        seed_pairs=1,
        competitors=[],
        standings=[],
        pairings=[
            PairingResult(
                pairing_index=0,
                scenario_id=TOURNAMENT_SCENARIO_ID,
                competitor_labels=("Alpha", "Beta"),
                competitor_models={"Alpha": "alpha-model", "Beta": "beta-model"},
                competitor_providers={"Alpha": "openai", "Beta": "anthropic"},
                seed_pair_count=1,
                majority_threshold=1,
                winner="Alpha",
                summary_by_label={},
                seed_pairs=[
                    SeedPairResult(
                        seed_pair_index=0,
                        seed=7,
                        winner="Alpha",
                        summary_by_label={},
                        matches=[match_a, match_b],
                    )
                ],
            )
        ],
    )

    def fake_write_match_battle_report(match: MatchResult, *, output_dir: Path, pairing_index: int, seed_pair_index: int) -> Path:
        report_dir = output_dir / f"pairing-{pairing_index:03d}-match-{match.match_index:03d}"
        report_dir.mkdir(parents=True, exist_ok=True)
        report_path = report_dir / "state-summary.json"
        report_path.write_text("{}", encoding="utf-8")
        return report_path

    monkeypatch.setattr("backend.tournament.write_match_battle_report", fake_write_match_battle_report)

    written = write_tournament_battle_reports(tournament, output_dir=tmp_path)

    assert written == 2
    assert tournament.battle_reports_dir == str(tmp_path)
    assert match_a.battle_report_path == str(tmp_path / "pairing-000-match-000" / "state-summary.json")
    assert match_b.battle_report_path == str(tmp_path / "pairing-000-match-001" / "state-summary.json")


def test_run_tournament_emits_live_progress_events(monkeypatch) -> None:
    def fake_build_commander(spec: CommanderSpec):
        return f"commander:{spec.label}"

    def fake_resolve_provider(spec: CommanderSpec) -> str:
        return "openai"

    def fake_run_headless_match(
        *,
        scenario_id: str,
        seed: int,
        match_index: int,
        commanders_by_army,
        commander_labels,
        commander_models,
        include_rationale: bool = False,
        max_actions: int = 400,
        deployment_first_army: ArmyId = ArmyId.A,
        first_bound_army: ArmyId = ArmyId.A,
    ) -> MatchResult:
        winner = ArmyId.A if commander_labels[ArmyId.A] == "Alpha" else ArmyId.B
        return make_match(
            match_index=match_index,
            seed=seed,
            commander_labels=commander_labels,
            commander_models=commander_models,
            winner=winner,
            finished=True,
        )

    monkeypatch.setattr("backend.tournament.build_commander", fake_build_commander)
    monkeypatch.setattr("backend.tournament.resolve_provider", fake_resolve_provider)
    monkeypatch.setattr("backend.tournament.run_headless_match", fake_run_headless_match)

    events = []
    result = run_tournament(
        competitor_specs=[
            CommanderSpec(label="Alpha", model="alpha-model"),
            CommanderSpec(label="Beta", model="beta-model"),
        ],
        seed_start=7,
        seed_pair_count=1,
        progress_callback=events.append,
    )

    assert result.standings[0].label == "Alpha"
    assert [event.kind for event in events] == [
        "tournament_started",
        "pairing_started",
        "match_started",
        "match_finished",
        "match_started",
        "match_finished",
        "match_started",
        "match_finished",
        "match_started",
        "match_finished",
        "seed_pair_finished",
        "pairing_finished",
        "tournament_finished",
    ]
    assert events[0].total_matches == 4
    assert events[2].army_a_label == "Beta"
    assert events[2].army_b_label == "Alpha"
    assert events[2].deployment_first_army == ArmyId.A
    assert events[2].first_bound_army == ArmyId.A
    assert events[3].match_result is not None
    assert events[3].completed_matches == 1
    assert events[6].deployment_first_army == ArmyId.B
    assert events[6].first_bound_army == ArmyId.B
    assert events[10].seed_pair_result is not None
    assert events[11].pairing_result is not None
    assert events[11].standings is not None
    assert events[-1].completed_matches == 4


def test_pairing_winner_uses_game_points_when_seed_pair_record_has_no_majority(monkeypatch) -> None:
    def fake_build_commander(spec: CommanderSpec):
        return f"commander:{spec.label}"

    def fake_resolve_provider(spec: CommanderSpec) -> str:
        return "openai"

    winners_by_match_index = {
        0: "Alpha",
        1: "Beta",
        2: "Alpha",
        3: "Beta",
        4: "Beta",
        5: "Beta",
        6: "Beta",
        7: "Beta",
    }

    def fake_run_headless_match(
        *,
        scenario_id: str,
        seed: int,
        match_index: int,
        commanders_by_army,
        commander_labels,
        commander_models,
        include_rationale: bool = False,
        max_actions: int = 400,
        deployment_first_army: ArmyId = ArmyId.A,
        first_bound_army: ArmyId = ArmyId.A,
    ) -> MatchResult:
        winner_label = winners_by_match_index[match_index]
        winner = ArmyId.A if commander_labels[ArmyId.A] == winner_label else ArmyId.B
        return make_match(
            match_index=match_index,
            seed=seed,
            commander_labels=commander_labels,
            commander_models=commander_models,
            winner=winner,
            finished=True,
        )

    monkeypatch.setattr("backend.tournament.build_commander", fake_build_commander)
    monkeypatch.setattr("backend.tournament.resolve_provider", fake_resolve_provider)
    monkeypatch.setattr("backend.tournament.run_headless_match", fake_run_headless_match)

    events = []
    result = run_tournament(
        competitor_specs=[
            CommanderSpec(label="Alpha", model="alpha-model"),
            CommanderSpec(label="Beta", model="beta-model"),
        ],
        seed_start=7,
        seed_pair_count=2,
        progress_callback=events.append,
    )

    pairing = result.pairings[0]
    assert pairing.seed_pairs[0].winner is None
    assert pairing.seed_pairs[1].winner == "Beta"
    assert pairing.summary_by_label["Alpha"]["game_points"] == 2.0
    assert pairing.summary_by_label["Beta"]["game_points"] == 6.0
    assert pairing.winner == "Beta"
    assert result.standings[0].label == "Beta"

    stream = StringIO()
    for event in events:
        log_tournament_progress(event, stream=stream)
    assert "[pairing 1/1 complete] Beta" in stream.getvalue()
    assert "[pairing 1/1 complete] tie" not in stream.getvalue()


def test_split_seed_pair_ties_ignore_battle_score_differential(monkeypatch) -> None:
    def fake_build_commander(spec: CommanderSpec):
        return f"commander:{spec.label}"

    def fake_resolve_provider(spec: CommanderSpec) -> str:
        return "openai"

    def fake_run_headless_match(
        *,
        scenario_id: str,
        seed: int,
        match_index: int,
        commanders_by_army,
        commander_labels,
        commander_models,
        include_rationale: bool = False,
        max_actions: int = 400,
        deployment_first_army: ArmyId = ArmyId.A,
        first_bound_army: ArmyId = ArmyId.A,
    ) -> MatchResult:
        alpha_is_a = commander_labels[ArmyId.A] == "Alpha"
        return make_match(
            match_index=match_index,
            seed=seed,
            commander_labels=commander_labels,
            commander_models=commander_models,
            winner=ArmyId.B,
            finished=True,
            battle_score_a=4 if alpha_is_a else 1,
            battle_score_b=5 if alpha_is_a else 8,
        )

    monkeypatch.setattr("backend.tournament.build_commander", fake_build_commander)
    monkeypatch.setattr("backend.tournament.resolve_provider", fake_resolve_provider)
    monkeypatch.setattr("backend.tournament.run_headless_match", fake_run_headless_match)

    result = run_tournament(
        competitor_specs=[
            CommanderSpec(label="Alpha", model="alpha-model"),
            CommanderSpec(label="Beta", model="beta-model"),
        ],
        seed_start=7,
        seed_pair_count=1,
    )

    pairing = result.pairings[0]
    assert pairing.summary_by_label["Alpha"]["game_points"] == 2.0
    assert pairing.summary_by_label["Beta"]["game_points"] == 2.0
    assert pairing.summary_by_label["Alpha"]["battle_score_differential"] == 12
    assert pairing.summary_by_label["Beta"]["battle_score_differential"] == -12
    assert pairing.seed_pairs[0].winner is None
    assert pairing.winner is None
    assert pairing.summary_by_label["Alpha"]["seed_pair_ties"] == 1
    assert pairing.summary_by_label["Beta"]["seed_pair_ties"] == 1


def test_log_tournament_progress_writes_human_readable_updates(monkeypatch) -> None:
    def fake_build_commander(spec: CommanderSpec):
        return f"commander:{spec.label}"

    def fake_resolve_provider(spec: CommanderSpec) -> str:
        return "openai"

    def fake_run_headless_match(
        *,
        scenario_id: str,
        seed: int,
        match_index: int,
        commanders_by_army,
        commander_labels,
        commander_models,
        include_rationale: bool = False,
        max_actions: int = 400,
        deployment_first_army: ArmyId = ArmyId.A,
        first_bound_army: ArmyId = ArmyId.A,
    ) -> MatchResult:
        winner = ArmyId.A if commander_labels[ArmyId.A] == "Alpha" else ArmyId.B
        return make_match(
            match_index=match_index,
            seed=seed,
            commander_labels=commander_labels,
            commander_models=commander_models,
            winner=winner,
            finished=True,
        )

    monkeypatch.setattr("backend.tournament.build_commander", fake_build_commander)
    monkeypatch.setattr("backend.tournament.resolve_provider", fake_resolve_provider)
    monkeypatch.setattr("backend.tournament.run_headless_match", fake_run_headless_match)

    events = []
    run_tournament(
        competitor_specs=[
            CommanderSpec(label="Alpha", model="alpha-model"),
            CommanderSpec(label="Beta", model="beta-model"),
        ],
        seed_start=7,
        seed_pair_count=1,
        progress_callback=events.append,
    )

    stream = StringIO()
    for event in events:
        log_tournament_progress(event, stream=stream)

    output = stream.getvalue()
    assert "Starting tournament: 2 competitors" in output
    assert "[pairing 1/1] Alpha vs Beta" in output
    assert "[match 1/4 | seed 7 | role 2/4 | deploy A | first A] Beta (Army A) vs Alpha (Army B)" in output
    assert "[match 1/4 complete] winner Alpha" in output
    assert "[pairing 1/1 complete] Alpha" in output
    assert "Final standings: 1. Alpha" in output
