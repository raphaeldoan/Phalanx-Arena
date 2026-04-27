from types import SimpleNamespace

from backend.ai_common import AiDecision
from backend.ai_providers.anthropic import AnthropicAiCommander
from backend.ai_providers.openai import OpenAIAiCommander
from backend.ai_providers.openai_compatible import OpenAICompatibleChatCommander
from backend.headless import (
    CommanderSpec,
    HEADLESS_BENCHMARK_PROFILE,
    build_commander,
    infer_provider,
    resolve_api_key_env,
    resolve_base_url,
    resolve_provider,
    run_headless_benchmark,
    run_headless_match,
)
from backend.models import (
    ArmyId,
    Coord,
    DeployActionOption,
    EndBoundActionOption,
    FinalizeDeploymentActionOption,
    GamePhase,
    RallyActionOption,
    ReplayData,
)
from backend.prompting_adapter import legal_action_to_action


class FirstActionCommander:
    def __init__(
        self,
        label: str,
        *,
        expected_include_rationale: bool = False,
        intent_update: str | None = None,
    ) -> None:
        self.label = label
        self.expected_include_rationale = expected_include_rationale
        self.intent_update = intent_update

    def choose_action(self, snapshot, request, action_history=None):
        assert request.input_mode == "text_only"
        assert request.include_rationale is self.expected_include_rationale
        if self.intent_update:
            assert request.can_update_intent is True
        chosen_action = snapshot.legal_actions[0]
        return AiDecision(
            action=legal_action_to_action(chosen_action),
            action_index=0,
            action_summary=f"{self.label} chose the first legal action.",
            reasoning=f"{self.label} is a deterministic test commander.",
            visual_observations="The exact textual board description was available.",
            confidence=1.0,
            model=f"{self.label}-model",
            usage=None,
            intent_update=self.intent_update,
        )


class FakePromptedHeadlessStore:
    def __init__(self) -> None:
        self._actions = []
        self._snapshot = SimpleNamespace(
            state=SimpleNamespace(
                game_id="fake-game",
                winner=None,
                winner_reason=None,
                phase=GamePhase.DEPLOYMENT,
                bound_number=1,
                current_player=ArmyId.A,
                pips_remaining=0,
                battle_scores=[],
                attrition_status=[],
            ),
            legal_actions=[FinalizeDeploymentActionOption(type="finalize_deployment")],
        )

    def create_game(self, request):
        return self._snapshot

    def replay(self, game_id: str) -> ReplayData:
        return ReplayData(scenario_id="line_clash", seed=7, actions=list(self._actions))

    def apply(self, game_id: str, action):
        self._actions.append(action)
        return self._snapshot

    def drop_game(self, game_id: str) -> None:
        return None


class FakeForcedEndBoundHeadlessStore:
    def __init__(self) -> None:
        self._actions = []
        self._snapshot = SimpleNamespace(
            state=SimpleNamespace(
                game_id="fake-game",
                winner=None,
                winner_reason=None,
                phase=GamePhase.BATTLE,
                bound_number=1,
                current_player=ArmyId.A,
                pips_remaining=0,
                battle_scores=[],
                attrition_status=[],
            ),
            legal_actions=[EndBoundActionOption(type="end_bound")],
        )

    def create_game(self, request):
        return self._snapshot

    def replay(self, game_id: str) -> ReplayData:
        return ReplayData(scenario_id="line_clash", seed=7, actions=list(self._actions))

    def apply(self, game_id: str, action):
        self._actions.append(action)
        return self._snapshot

    def drop_game(self, game_id: str) -> None:
        return None


class BoundPlanCommander:
    def __init__(self) -> None:
        self.calls = 0

    def choose_action(self, snapshot, request, action_history=None):
        self.calls += 1
        assert request.deployment_batch is False
        assert request.battle_batch is True
        selected = [action for action in snapshot.legal_actions if action.type != "end_bound"][:2]
        return AiDecision(
            action=legal_action_to_action(selected[0]),
            action_index=0,
            action_summary="bound plan",
            reasoning="Order the whole bound in one response.",
            visual_observations="",
            confidence=1.0,
            model="bound-plan-model",
            usage=None,
            actions=[legal_action_to_action(action) for action in selected],
            action_indices=[0, 1],
        )


class FakeBattleBatchStore:
    def __init__(self) -> None:
        self._actions = []
        self._pips = 8
        self._units = [
            SimpleNamespace(id="A-1", army=ArmyId.A, eliminated=False, activated_this_bound=False),
            SimpleNamespace(id="A-2", army=ArmyId.A, eliminated=False, activated_this_bound=False),
        ]
        self._snapshot = self._build_snapshot()

    def _build_snapshot(self):
        legal_actions = [
            RallyActionOption(unit_id=unit.id, pip_cost=1)
            for unit in self._units
            if not unit.activated_this_bound
        ]
        legal_actions.append(EndBoundActionOption(type="end_bound"))
        return SimpleNamespace(
            state=SimpleNamespace(
                game_id="fake-game",
                winner=None,
                winner_reason=None,
                phase=GamePhase.BATTLE,
                bound_number=1,
                current_player=ArmyId.A,
                pips_remaining=self._pips,
                last_pip_roll=8,
                battle_scores=[],
                attrition_status=[],
                units=self._units,
            ),
            legal_actions=legal_actions,
        )

    def create_game(self, request):
        return self._snapshot

    def replay(self, game_id: str) -> ReplayData:
        return ReplayData(scenario_id="line_clash", seed=7, actions=list(self._actions))

    def apply(self, game_id: str, action):
        self._actions.append(action)
        if action.type == "rally":
            for unit in self._units:
                if unit.id == action.unit_id:
                    unit.activated_this_bound = True
            self._pips -= 1
            self._snapshot = self._build_snapshot()
        elif action.type == "end_bound":
            self._snapshot.state.winner = ArmyId.A
            self._snapshot.state.winner_reason = "synthetic bound complete"
            self._snapshot.legal_actions = []
        return self._snapshot

    def drop_game(self, game_id: str) -> None:
        return None


class DuplicateDeploymentCommander:
    def __init__(self) -> None:
        self.calls = 0

    def choose_action(self, snapshot, request, action_history=None):
        self.calls += 1
        assert request.deployment_batch is True
        selected = [snapshot.legal_actions[index] for index in (0, 1, 2)]
        return AiDecision(
            action=legal_action_to_action(selected[0]),
            action_index=0,
            action_summary="duplicate deployment batch",
            reasoning="Place the deployment in one batch.",
            visual_observations="",
            confidence=1.0,
            model="batch-model",
            usage=None,
            actions=[legal_action_to_action(action) for action in selected],
            action_indices=[0, 1, 2],
        )


class FakeDeploymentBatchStore:
    def __init__(self) -> None:
        self._actions = []
        self._units = [
            SimpleNamespace(
                id="A-1",
                army=ArmyId.A,
                eliminated=False,
                deployed=False,
                leader=False,
                in_command=True,
                off_map=False,
                unit_class="Formed",
                formation_state="Normal",
                position=Coord(x=0, y=0),
            ),
            SimpleNamespace(
                id="A-2",
                army=ArmyId.A,
                eliminated=False,
                deployed=False,
                leader=False,
                in_command=True,
                off_map=False,
                unit_class="Formed",
                formation_state="Normal",
                position=Coord(x=1, y=0),
            ),
        ]
        self._occupied: set[tuple[int, int]] = set()
        self._snapshot = self._build_snapshot()

    def _build_snapshot(self):
        legal_actions = []
        for unit in self._units:
            if unit.deployed:
                continue
            for x in (0, 1):
                destination_key = (x, 0)
                if destination_key not in self._occupied:
                    legal_actions.append(DeployActionOption(unit_id=unit.id, destination=Coord(x=x, y=0)))
        if all(unit.deployed for unit in self._units):
            legal_actions.append(FinalizeDeploymentActionOption(type="finalize_deployment"))
        return SimpleNamespace(
            state=SimpleNamespace(
                game_id="fake-game",
                winner=None,
                winner_reason=None,
                phase=GamePhase.DEPLOYMENT,
                bound_number=1,
                current_player=ArmyId.A,
                pips_remaining=0,
                battle_scores=[],
                attrition_status=[],
                units=self._units,
            ),
            legal_actions=legal_actions,
        )

    def create_game(self, request):
        return self._snapshot

    def replay(self, game_id: str) -> ReplayData:
        return ReplayData(scenario_id="line_clash", seed=7, actions=list(self._actions))

    def apply(self, game_id: str, action):
        self._actions.append(action)
        if action.type == "deploy":
            for unit in self._units:
                if unit.id == action.unit_id:
                    unit.deployed = True
                    unit.position = action.destination
                    break
            self._occupied.add((action.destination.x, action.destination.y))
            self._snapshot = self._build_snapshot()
        elif action.type == "finalize_deployment":
            self._snapshot.state.phase = GamePhase.BATTLE
            self._snapshot.state.winner = ArmyId.A
            self._snapshot.legal_actions = []
        return self._snapshot

    def drop_game(self, game_id: str) -> None:
        return None


class HiddenDeploymentCommander:
    def __init__(self, army: ArmyId, events: list[str]) -> None:
        self.army = army
        self.events = events
        self.calls = 0

    def choose_action(self, snapshot, request, action_history=None):
        self.calls += 1
        assert request.army == self.army
        assert request.deployment_batch is True
        assert action_history == []
        assert not any(event.startswith("apply:") for event in self.events)
        self.events.append(f"choose:{self.army}")
        selected = next(action for action in snapshot.legal_actions if action.type == "deploy")
        return AiDecision(
            action=legal_action_to_action(selected),
            action_index=0,
            action_summary=f"{self.army} hidden deployment",
            reasoning="Place reserve without seeing the other deployment.",
            visual_observations="",
            confidence=1.0,
            model="hidden-deploy-model",
            usage=None,
            actions=[legal_action_to_action(selected)],
            action_indices=[0],
        )


class FakeHiddenDeploymentStore:
    events: list[str] = []

    def __init__(self) -> None:
        self._next_id = 0
        self._games = {}

    def create_game(self, request):
        self._next_id += 1
        game_id = f"hidden-{self._next_id}"
        units = [
            SimpleNamespace(
                id="A-1",
                army=ArmyId.A,
                eliminated=False,
                deployed=False,
                leader=False,
                in_command=True,
                off_map=False,
                unit_class="Formed",
                formation_state="Normal",
                position=Coord(x=0, y=0),
            ),
            SimpleNamespace(
                id="B-1",
                army=ArmyId.B,
                eliminated=False,
                deployed=False,
                leader=False,
                in_command=True,
                off_map=False,
                unit_class="Formed",
                formation_state="Normal",
                position=Coord(x=1, y=1),
            ),
        ]
        game = SimpleNamespace(
            game_id=game_id,
            scenario_id=request.scenario_id,
            seed=request.seed,
            deployment_first_army=request.deployment_first_army,
            first_bound_army=request.first_bound_army,
            phase=GamePhase.DEPLOYMENT,
            current_player=request.deployment_first_army,
            bound_number=1,
            pips_remaining=0,
            last_pip_roll=0,
            winner=None,
            winner_reason=None,
            battle_scores=[],
            attrition_status=[],
            deployment_ready=[],
            units=units,
            actions=[],
        )
        self._games[game_id] = game
        return self._build_snapshot(game)

    def _build_snapshot(self, game):
        legal_actions = []
        if game.phase == GamePhase.DEPLOYMENT:
            reserve_units = [
                unit
                for unit in game.units
                if unit.army == game.current_player and not unit.eliminated and not unit.deployed
            ]
            for unit in reserve_units:
                y = 0 if unit.army == ArmyId.A else 1
                legal_actions.append(DeployActionOption(unit_id=unit.id, destination=Coord(x=0, y=y)))
            if not reserve_units and game.current_player not in game.deployment_ready:
                legal_actions.append(FinalizeDeploymentActionOption(type="finalize_deployment"))
        return SimpleNamespace(state=game, legal_actions=legal_actions)

    def replay(self, game_id: str) -> ReplayData:
        game = self._games[game_id]
        return ReplayData(
            scenario_id=game.scenario_id,
            seed=game.seed,
            deployment_first_army=game.deployment_first_army,
            first_bound_army=game.first_bound_army,
            actions=list(game.actions),
        )

    def apply(self, game_id: str, action):
        game = self._games[game_id]
        game.actions.append(action)
        self.events.append(f"apply:{game_id}:{action.type}:{getattr(action, 'unit_id', '-')}")
        if action.type == "deploy":
            for unit in game.units:
                if unit.id == action.unit_id:
                    unit.deployed = True
                    unit.position = action.destination
                    break
        elif action.type == "finalize_deployment":
            if game.current_player not in game.deployment_ready:
                game.deployment_ready.append(game.current_player)
            if ArmyId.A in game.deployment_ready and ArmyId.B in game.deployment_ready:
                game.phase = GamePhase.BATTLE
                game.current_player = game.first_bound_army
                game.winner = ArmyId.A
                game.winner_reason = "synthetic hidden deployment complete"
            else:
                game.current_player = ArmyId.B if game.current_player == ArmyId.A else ArmyId.A
        return self._build_snapshot(game)

    def drop_game(self, game_id: str) -> None:
        self._games.pop(game_id, None)


def test_run_headless_match_executes_without_frontend() -> None:
    from backend import headless

    original_store = headless.GameStore
    headless.GameStore = FakePromptedHeadlessStore
    try:
        result = run_headless_match(
            scenario_id="line_clash",
            seed=7,
            match_index=0,
            commanders_by_army={
                ArmyId.A: FirstActionCommander("alpha", intent_update="Hold center, feel out the left."),
                ArmyId.B: FirstActionCommander("beta"),
            },
            commander_labels={ArmyId.A: "alpha", ArmyId.B: "beta"},
            commander_models={ArmyId.A: "alpha-model", ArmyId.B: "beta-model"},
            max_actions=1,
        )
    finally:
        headless.GameStore = original_store

    payload = result.to_dict()
    assert payload["scenario_id"] == "line_clash"
    assert payload["seed"] == 7
    assert payload["input_mode"] == "text_only"
    assert payload["action_count"] == 1
    assert payload["finished"] is False
    assert payload["max_actions_reached"] is True
    assert len(payload["replay"]["actions"]) == 1
    assert payload["replay"]["intent_updates"] == [
        {
            "army": "A",
            "bound_number": 1,
            "action_number": 1,
            "intent": "Hold center, feel out the left.",
        }
    ]


def test_run_headless_match_emits_decision_log_events() -> None:
    from backend import headless

    decision_events = []
    original_store = headless.GameStore
    headless.GameStore = FakePromptedHeadlessStore
    try:
        run_headless_match(
            scenario_id="line_clash",
            seed=7,
            match_index=3,
            commanders_by_army={
                ArmyId.A: FirstActionCommander("alpha"),
                ArmyId.B: FirstActionCommander("beta"),
            },
            commander_labels={ArmyId.A: "alpha", ArmyId.B: "beta"},
            commander_models={ArmyId.A: "alpha-model", ArmyId.B: "beta-model"},
            max_actions=1,
            decision_logger=decision_events.append,
        )
    finally:
        headless.GameStore = original_store

    assert [event["kind"] for event in decision_events] == ["decision_request", "decision"]
    assert decision_events[0]["match_index"] == 3
    assert decision_events[0]["phase"] == "deployment"
    assert decision_events[0]["label"] == "alpha"
    assert decision_events[0]["legal_action_count"] == 1
    assert decision_events[1]["selected_action_index"] == 0
    assert decision_events[1]["selected_action_indices"] == [0]
    assert decision_events[1]["action_summary"] == "alpha chose the first legal action."
    assert decision_events[1]["elapsed_seconds"] >= 0


def test_run_headless_match_deploys_ai_army_in_one_model_call_and_skips_duplicates() -> None:
    from backend import headless

    commander = DuplicateDeploymentCommander()
    original_store = headless.GameStore
    headless.GameStore = FakeDeploymentBatchStore
    try:
        result = run_headless_match(
            scenario_id="line_clash",
            seed=7,
            match_index=0,
            commanders_by_army={ArmyId.A: commander, ArmyId.B: FirstActionCommander("beta")},
            commander_labels={ArmyId.A: "alpha", ArmyId.B: "beta"},
            commander_models={ArmyId.A: "batch-model", ArmyId.B: "beta-model"},
            max_actions=10,
        )
    finally:
        headless.GameStore = original_store

    payload = result.to_dict()
    assert commander.calls == 1
    assert payload["usage_by_army"]["A"]["turns"] == 1
    assert payload["action_count"] == 3
    assert payload["replay"]["actions"] == [
        {"type": "deploy", "unit_id": "A-1", "destination": {"x": 0, "y": 0}},
        {"type": "deploy", "unit_id": "A-2", "destination": {"x": 1, "y": 0}},
        {"type": "finalize_deployment"},
    ]
    assert payload["deployment_analysis"]["A"]["units"] == 2
    assert payload["deployment_analysis"]["A"]["frontage"] == 2


def test_run_headless_match_collects_hidden_deployment_before_applying_either_side() -> None:
    from backend import headless

    events: list[str] = []
    FakeHiddenDeploymentStore.events = events
    commander_a = HiddenDeploymentCommander(ArmyId.A, events)
    commander_b = HiddenDeploymentCommander(ArmyId.B, events)
    original_store = headless.GameStore
    headless.GameStore = FakeHiddenDeploymentStore
    try:
        result = run_headless_match(
            scenario_id="line_clash",
            seed=7,
            match_index=0,
            commanders_by_army={ArmyId.A: commander_a, ArmyId.B: commander_b},
            commander_labels={ArmyId.A: "alpha", ArmyId.B: "beta"},
            commander_models={ArmyId.A: "alpha-model", ArmyId.B: "beta-model"},
            max_actions=10,
            deployment_first_army=ArmyId.B,
            first_bound_army=ArmyId.B,
        )
    finally:
        headless.GameStore = original_store

    payload = result.to_dict()
    assert events[:2] == ["choose:B", "choose:A"]
    assert commander_a.calls == 1
    assert commander_b.calls == 1
    assert payload["usage_by_army"]["A"]["turns"] == 1
    assert payload["usage_by_army"]["B"]["turns"] == 1
    assert payload["action_count"] == 4
    assert payload["replay"]["deployment_first_army"] == "B"
    assert payload["replay"]["first_bound_army"] == "B"
    assert payload["replay"]["actions"] == [
        {"type": "deploy", "unit_id": "B-1", "destination": {"x": 0, "y": 1}},
        {"type": "finalize_deployment"},
        {"type": "deploy", "unit_id": "A-1", "destination": {"x": 0, "y": 0}},
        {"type": "finalize_deployment"},
    ]


def test_run_headless_match_can_request_rationale() -> None:
    from backend import headless

    original_store = headless.GameStore
    headless.GameStore = FakePromptedHeadlessStore
    try:
        result = run_headless_match(
            scenario_id="line_clash",
            seed=7,
            match_index=0,
            commanders_by_army={
                ArmyId.A: FirstActionCommander("alpha", expected_include_rationale=True),
                ArmyId.B: FirstActionCommander("beta", expected_include_rationale=True),
            },
            commander_labels={ArmyId.A: "alpha", ArmyId.B: "beta"},
            commander_models={ArmyId.A: "alpha-model", ArmyId.B: "beta-model"},
            include_rationale=True,
            max_actions=1,
        )
    finally:
        headless.GameStore = original_store

    payload = result.to_dict()
    assert payload["action_count"] == 1


def test_run_headless_match_auto_ends_bound_without_commander_call() -> None:
    from backend import headless

    class RaisingCommander:
        def choose_action(self, snapshot, request, action_history=None):
            raise AssertionError("The commander should not be called when end_bound is forced.")

    original_store = headless.GameStore
    headless.GameStore = FakeForcedEndBoundHeadlessStore
    try:
        result = run_headless_match(
            scenario_id="line_clash",
            seed=7,
            match_index=0,
            commanders_by_army={
                ArmyId.A: RaisingCommander(),
                ArmyId.B: RaisingCommander(),
            },
            commander_labels={ArmyId.A: "alpha", ArmyId.B: "beta"},
            commander_models={ArmyId.A: "alpha-model", ArmyId.B: "beta-model"},
            max_actions=1,
        )
    finally:
        headless.GameStore = original_store

    payload = result.to_dict()
    assert payload["action_count"] == 1
    assert payload["usage_by_army"]["A"]["turns"] == 0
    assert payload["replay"]["actions"] == [{"type": "end_bound"}]


def test_run_headless_match_applies_battle_bound_plan_in_one_model_call() -> None:
    from backend import headless

    commander = BoundPlanCommander()
    original_store = headless.GameStore
    headless.GameStore = FakeBattleBatchStore
    try:
        result = run_headless_match(
            scenario_id="line_clash",
            seed=7,
            match_index=0,
            commanders_by_army={ArmyId.A: commander, ArmyId.B: FirstActionCommander("beta")},
            commander_labels={ArmyId.A: "alpha", ArmyId.B: "beta"},
            commander_models={ArmyId.A: "bound-plan-model", ArmyId.B: "beta-model"},
            max_actions=10,
        )
    finally:
        headless.GameStore = original_store

    payload = result.to_dict()
    assert commander.calls == 1
    assert payload["usage_by_army"]["A"]["turns"] == 1
    assert payload["action_count"] == 3
    assert payload["replay"]["actions"] == [
        {"type": "rally", "unit_id": "A-1"},
        {"type": "rally", "unit_id": "A-2"},
        {"type": "end_bound"},
    ]


def test_infer_provider_from_model_prefix() -> None:
    assert infer_provider("claude-opus-4-6") == "anthropic"
    assert infer_provider("gpt-5.4") == "openai"
    assert infer_provider("grok-4") == "xai"
    assert infer_provider("gemini-3-flash-preview") == "gemini"
    assert infer_provider("mistral-medium-latest") == "mistral"
    assert infer_provider("openai/gpt-5.5") == "openrouter"
    assert infer_provider("anthropic/claude-opus-4.7") == "openrouter"
    assert infer_provider("deepseek/deepseek-v4-pro") == "openrouter"
    assert infer_provider("x-ai/grok-4.20") == "openrouter"
    assert infer_provider("google/gemini-3.1-pro-preview") == "openrouter"
    assert infer_provider("mistralai/mistral-large-2512") == "openrouter"
    assert infer_provider("moonshotai/kimi-k2.6") == "openrouter"
    assert infer_provider("meta-llama/Llama-4-Scout-17B-16E-Instruct") == "together"


def test_resolve_provider_honors_explicit_override() -> None:
    spec = CommanderSpec(label="Claude via override", model="gpt-5.4", provider="anthropic")

    assert resolve_provider(spec) == "anthropic"


def test_build_commander_creates_anthropic_commander(monkeypatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

    commander = build_commander(
        CommanderSpec(
            label="Claude",
            model="claude-opus-4-6",
            provider="auto",
            api_key_env="ANTHROPIC_API_KEY",
        )
    )

    assert isinstance(commander, AnthropicAiCommander)


def test_build_commander_creates_openai_commander(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    commander = build_commander(
        CommanderSpec(
            label="GPT",
            model="gpt-5.4",
            provider="auto",
            api_key_env="OPENAI_API_KEY",
        )
    )

    assert isinstance(commander, OpenAIAiCommander)


def test_build_commander_creates_openai_compatible_chat_commander(monkeypatch) -> None:
    monkeypatch.setenv("TOGETHER_API_KEY", "test-key")

    commander = build_commander(
        CommanderSpec(
            label="Open Model",
            model="meta-llama/Llama-3.3-70B-Instruct-Turbo",
            provider="together",
            api_key_env="TOGETHER_API_KEY",
        )
    )

    assert isinstance(commander, OpenAICompatibleChatCommander)


def test_provider_defaults_resolve_key_env_and_base_url() -> None:
    spec = CommanderSpec(label="Gemini", model="gemini-3-flash-preview", provider="gemini")

    assert resolve_api_key_env(spec, "gemini") == "GEMINI_API_KEY"
    assert resolve_base_url(spec, "gemini") == "https://generativelanguage.googleapis.com/v1beta/openai"
    assert resolve_api_key_env(spec, "openrouter") == "OPENROUTER_API_KEY"
    assert resolve_base_url(spec, "openrouter") == "https://openrouter.ai/api/v1"


def test_build_commander_passes_strict_benchmark_profile(monkeypatch) -> None:
    captured = {}

    def fake_build_ai_commander(**kwargs):
        captured.update(kwargs)
        return FirstActionCommander("strict")

    monkeypatch.setattr("backend.headless.build_ai_commander", fake_build_ai_commander)

    build_commander(
        CommanderSpec(
            label="Strict",
            model="gpt-5.4",
            provider="openai",
        )
    )

    assert captured["benchmark_profile"] == HEADLESS_BENCHMARK_PROFILE


def test_run_headless_benchmark_reports_strict_profile() -> None:
    from backend import headless

    original_store = headless.GameStore
    headless.GameStore = FakePromptedHeadlessStore
    try:
        result = run_headless_benchmark(
            scenario_id="line_clash",
            seeds=[7],
            commanders_by_army={
                ArmyId.A: FirstActionCommander("alpha"),
                ArmyId.B: FirstActionCommander("beta"),
            },
            commander_labels={ArmyId.A: "alpha", ArmyId.B: "beta"},
            commander_models={ArmyId.A: "alpha-model", ArmyId.B: "beta-model"},
            max_actions=1,
        )
    finally:
        headless.GameStore = original_store

    payload = result.to_dict()
    assert payload["benchmark_profile"] == HEADLESS_BENCHMARK_PROFILE
    assert payload["include_rationale"] is False
