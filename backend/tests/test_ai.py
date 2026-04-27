import io
import json
import re
from pathlib import Path
from urllib import error as urllib_error
from urllib import request as urllib_request

import pytest

import backend.ai_common as ai_module
from backend.ai_common import (
    AiConfigurationError,
    AiDecisionError,
    GEMINI_3_STRICT_MAX_OUTPUT_TOKENS,
    STRICT_BENCHMARK_REPAIR_PROMPT,
    extract_anthropic_tool_input,
    extract_anthropic_usage_metrics,
    extract_chat_completion_tool_input,
    extract_chat_completion_usage_metrics,
    extract_usage_metrics,
    load_model_pricing_overrides,
    post_json_request,
    price_usage,
    resolve_reasoning_text,
    resolve_visual_observations_text,
)
from backend.ai_providers.anthropic import AnthropicAiCommander
from backend.ai_providers.openai import OpenAIAiCommander
from backend.ai_providers.openai_compatible import OpenAICompatibleChatCommander
from backend.ai_system_prompt import (
    AI_CANONICAL_RULES,
    AI_SYSTEM_PROMPT_TEMPLATE,
    AI_SYSTEM_PROMPT_TEMPLATE_PATH,
    GAME_RULES_PATH,
    SYSTEM_PROMPT,
    system_prompt_for_turn,
)
from backend.models import (
    AiInputMode,
    AiTurnRequest,
    ArmyId,
    AttritionStatus,
    BattleScore,
    ChargeAction,
    ChargeActionOption,
    CombatResolution,
    Coord,
    DeployActionOption,
    DeploymentZone,
    EndBoundAction,
    EndBoundActionOption,
    FinalizeDeploymentActionOption,
    FormationClass,
    GamePhase,
    GameSnapshot,
    GameState,
    LogEntry,
    MoveAction,
    RallyActionOption,
    ShootAction,
    TerrainTile,
    TerrainType,
    Unit,
    UnitClass,
    UnitKind,
    UnitQuality,
)
from backend.prompting_adapter import build_user_prompt
from backend.provider_factory import build_commander, resolve_provider_name

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_AI_SYSTEM_PROMPT_PATH = REPO_ROOT / "frontend" / "src" / "aiSystemPrompt.ts"
BACKEND_AI_SYSTEM_PROMPT_PATH = REPO_ROOT / "backend" / "src" / "backend" / "ai_system_prompt.py"
FRONTEND_BROWSER_AI_PATH = REPO_ROOT / "frontend" / "src" / "browserAi.ts"
FRONTEND_AI_PROVIDERS_PATH = REPO_ROOT / "frontend" / "src" / "aiProviders.ts"
FRONTEND_AI_ORCHESTRATOR_PATH = REPO_ROOT / "frontend" / "src" / "aiOrchestrator.ts"
BACKEND_HEADLESS_PATH = REPO_ROOT / "backend" / "src" / "backend" / "headless.py"
SHARED_AI_SYSTEM_PROMPT_TEMPLATE_PATH = REPO_ROOT / "shared" / "aiSystemPrompt.txt"
SHARED_AI_PROVIDER_CATALOG_PATH = REPO_ROOT / "shared" / "aiProviderCatalog.json"


def _build_choice_snapshot() -> GameSnapshot:
    state = GameState(
        game_id="ai-choice",
        engine_name="Phalanx Arena",
        engine_version="0.21",
        design_basis="test",
        scenario_id="choice_case",
        scenario_name="Choice Case",
        board_width=6,
        board_height=6,
        phase=GamePhase.BATTLE,
        bound_number=3,
        current_player=ArmyId.A,
        pips_remaining=2,
        last_pip_roll=5,
        seed=11,
        roll_index=4,
        terrain=[TerrainTile(position=Coord(x=2, y=2), terrain=TerrainType.FOREST)],
        deployment_zones=[DeploymentZone(army=ArmyId.A, min_x=0, max_x=2, min_y=4, max_y=5)],
        deployment_ready=[],
        attrition_status=[
            AttritionStatus(army=ArmyId.A, starting_units=2, losses=0, target_losses=2),
            AttritionStatus(army=ArmyId.B, starting_units=2, losses=1, target_losses=2),
        ],
        battle_scores=[
            BattleScore(army=ArmyId.A, enemy_losses=1, total=1),
            BattleScore(army=ArmyId.B, enemy_losses=0, total=0),
        ],
        victory_target=5,
        units=[
            Unit(
                id="A-GEN",
                army=ArmyId.A,
                name="General",
                kind=UnitKind.KNIGHTS,
                leader=True,
                quality=UnitQuality.SUPERIOR,
                position=Coord(x=2, y=4),
                facing="N",
                in_command=True,
                disordered=False,
                activated_this_bound=False,
                eliminated=False,
            ),
            Unit(
                id="B-PS",
                army=ArmyId.B,
                name="Psiloi",
                kind=UnitKind.PSILOI,
                formation_class=FormationClass.OPEN_ORDER,
                can_evade=True,
                unit_class=UnitClass.LIGHT,
                position=Coord(x=2, y=3),
                facing="S",
                in_command=False,
                disordered=True,
                activated_this_bound=True,
                eliminated=False,
            ),
        ],
        log=[LogEntry(step=1, message="A General charged from (2, 5) to (2, 4).")],
        recent_resolutions=[],
        winner_reason=None,
    )
    return GameSnapshot(
        state=state,
        legal_actions=[EndBoundActionOption(type="end_bound")],
        can_undo=False,
    )


def test_build_user_prompt_includes_compact_exact_state_and_history() -> None:
    state = GameState(
        game_id="ai-prompt",
        engine_name="Phalanx Arena",
        engine_version="0.21",
        design_basis="test",
        scenario_id="prompt_case",
        scenario_name="Prompt Case",
        board_width=6,
        board_height=6,
        phase=GamePhase.BATTLE,
        bound_number=3,
        current_player=ArmyId.A,
        pips_remaining=2,
        last_pip_roll=5,
        seed=11,
        roll_index=4,
        terrain=[TerrainTile(position=Coord(x=2, y=2), terrain=TerrainType.FOREST)],
        deployment_zones=[DeploymentZone(army=ArmyId.A, min_x=0, max_x=2, min_y=4, max_y=5)],
        deployment_ready=[],
        attrition_status=[
            AttritionStatus(army=ArmyId.A, starting_units=2, losses=0, target_losses=2),
            AttritionStatus(army=ArmyId.B, starting_units=2, losses=1, target_losses=2),
        ],
        battle_scores=[
            BattleScore(army=ArmyId.A, enemy_losses=1, total=1),
            BattleScore(army=ArmyId.B, enemy_losses=0, total=0),
        ],
        victory_target=5,
        units=[
            Unit(
                id="A-GEN",
                army=ArmyId.A,
                name="General",
                kind=UnitKind.KNIGHTS,
                leader=True,
                quality=UnitQuality.SUPERIOR,
                position=Coord(x=2, y=4),
                facing="N",
                in_command=True,
                disordered=False,
                activated_this_bound=False,
                eliminated=False,
            ),
            Unit(
                id="B-PS",
                army=ArmyId.B,
                name="Psiloi",
                kind=UnitKind.PSILOI,
                formation_class=FormationClass.OPEN_ORDER,
                can_evade=True,
                unit_class=UnitClass.LIGHT,
                position=Coord(x=2, y=3),
                facing="S",
                in_command=False,
                disordered=True,
                activated_this_bound=True,
                eliminated=False,
            ),
        ],
        log=[
            LogEntry(step=1, message="A General charged from (2, 5) to (2, 4)."),
            LogEntry(step=2, message="B Psiloi became disordered."),
        ],
        recent_resolutions=[
            CombatResolution(
                kind="close_combat",
                attacker_id="A-GEN",
                attacker_name="General",
                attacker_position=Coord(x=2, y=4),
                defender_id="B-PS",
                defender_name="Psiloi",
                defender_position=Coord(x=2, y=3),
                attacker_score=5,
                attacker_roll=2,
                attacker_total=7,
                defender_score=2,
                defender_roll=1,
                defender_total=3,
                aspect="front",
                differential=4,
                outcome="destroy",
                winner_id="A-GEN",
                loser_id="B-PS",
            )
        ],
        winner_reason=None,
    )
    snapshot = GameSnapshot(state=state, legal_actions=[EndBoundActionOption(type="end_bound")], can_undo=True)
    action_catalog = [{"index": 0, "summary": "end bound", "action": {"type": "end_bound"}}]
    action_history = [
        MoveAction(
            type="move",
            unit_id="A-GEN",
            destination=Coord(x=2, y=4),
            path=[Coord(x=2, y=4)],
            facing="N",
        ),
        EndBoundAction(type="end_bound"),
    ]

    prompt = build_user_prompt(
        snapshot,
        AiTurnRequest(army=ArmyId.A, input_mode=AiInputMode.TEXT_ONLY),
        action_catalog,
        action_history,
    )

    assert "Unit profiles by kind:" in prompt
    assert "PROFILE knights mv=3 march=+2 close=4/4 msl=- mdef=4 sup=0 pur=2 mounted=1 scr=3 pass=-" in prompt
    assert "PROFILE psiloi mv=3 march=+1 close=2/3 msl=2/2 mdef=2 sup=0 pur=0 mounted=0 scr=1 pass=spear,pike,blade,warband,auxilia,horde,bow,psiloi" in prompt
    assert "META scenario=prompt_case phase=battle bound=3 board=6x6 side=A pips=2/5 winner=- target=5 cmd=A:8,B:8" in prompt
    assert "SCORE A enemy=1 total=1 attr=0/2" in prompt
    assert "ZONE A x=0-2 y=4-5" in prompt
    assert "TERRAIN 2,2=forest" in prompt
    assert "U A-GEN A knights @2,4 N L1 Fc Qs C1 D0 V0 A0 CH0 X0" in prompt
    assert "U B-PS B psiloi @2,3 S L0 Fo Qo C0 D1 V1 A1 CH0 X0" in prompt
    assert "ACT 1 move A-GEN->2,4 fN p[2,4]" in prompt
    assert "ACT 2 end_bound" in prompt
    assert "Source of truth: compact exact current state + exact action history + last action result + immediate action effects + legal actions JSON." in prompt
    assert "Last action result:" in prompt
    assert "- close combat A-GEN->B-PS: B-PS was destroyed." in prompt
    assert "Immediate action effects by index:" in prompt
    assert "EFF 0 current close combats resolving now:" in prompt
    assert "A-GEN vs B-PS" in prompt
    assert "RES CC A-GEN>B-PS 7:3 destroy asp=front" in prompt
    assert "EVT 2 B Psiloi became disordered." in prompt
    assert '"action":{"type":"end_bound"}' in prompt
    assert "Deployment reminder:" not in prompt


def test_build_user_prompt_includes_deployment_reminder() -> None:
    state = GameState(
        game_id="ai-deploy",
        engine_name="Phalanx Arena",
        engine_version="0.21",
        design_basis="test",
        scenario_id="deploy_case",
        scenario_name="Deploy Case",
        board_width=6,
        board_height=6,
        phase=GamePhase.DEPLOYMENT,
        bound_number=1,
        current_player=ArmyId.A,
        pips_remaining=0,
        last_pip_roll=0,
        seed=23,
        roll_index=0,
        terrain=[],
        deployment_zones=[DeploymentZone(army=ArmyId.A, min_x=0, max_x=2, min_y=4, max_y=5)],
        deployment_ready=[],
        attrition_status=[
            AttritionStatus(army=ArmyId.A, starting_units=1, losses=0, target_losses=1),
            AttritionStatus(army=ArmyId.B, starting_units=1, losses=0, target_losses=1),
        ],
        battle_scores=[
            BattleScore(army=ArmyId.A, enemy_losses=0, total=0),
            BattleScore(army=ArmyId.B, enemy_losses=0, total=0),
        ],
        victory_target=5,
        units=[
            Unit(
                id="A-GEN",
                army=ArmyId.A,
                name="General",
                kind=UnitKind.KNIGHTS,
                leader=True,
                position=Coord(x=1, y=4),
                facing="N",
                in_command=True,
                disordered=False,
                activated_this_bound=False,
                eliminated=False,
            ),
            Unit(
                id="B-PS",
                army=ArmyId.B,
                name="Psiloi",
                kind=UnitKind.PSILOI,
                position=Coord(x=3, y=1),
                facing="S",
                in_command=True,
                disordered=False,
                activated_this_bound=False,
                eliminated=False,
            ),
        ],
        log=[LogEntry(step=1, message="A deployment phase begins.")],
        recent_resolutions=[],
        winner_reason=None,
    )
    snapshot = GameSnapshot(
        state=state,
        legal_actions=[
            DeployActionOption(unit_id="A-GEN", destination=Coord(x=2, y=5)),
            FinalizeDeploymentActionOption(),
        ],
        can_undo=True,
    )
    action_catalog = [
        {"index": 0, "summary": "deploy A-GEN to (2, 5)", "action": {"type": "deploy", "unit_id": "A-GEN", "destination": {"x": 2, "y": 5}}},
        {"index": 1, "summary": "finalize deployment", "action": {"type": "finalize_deployment"}},
    ]

    prompt = build_user_prompt(
        snapshot,
        AiTurnRequest(army=ArmyId.A, input_mode=AiInputMode.TEXT_ONLY),
        action_catalog,
        [],
    )

    assert (
        "Deployment reminder: every unit must receive a legal `deploy` action inside its deployment zone "
        "before `finalize_deployment` becomes legal; displayed PIPs do not restrict deployment."
    ) in prompt
    assert '"action":{"type":"deploy","unit_id":"A-GEN","destination":{"x":2,"y":5}}' in prompt
    assert '"action":{"type":"finalize_deployment"}' in prompt


def test_system_prompt_uses_rules_overview_without_strategy_priorities() -> None:
    packaged_rules_text = GAME_RULES_PATH.read_text(encoding="utf-8").strip()
    shared_system_prompt_template = AI_SYSTEM_PROMPT_TEMPLATE_PATH.read_text(encoding="utf-8").strip()
    backend_prompt_module = BACKEND_AI_SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")
    frontend_prompt_module = FRONTEND_AI_SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")
    frontend_browser_ai_module = FRONTEND_BROWSER_AI_PATH.read_text(encoding="utf-8")
    frontend_ai_providers_module = FRONTEND_AI_PROVIDERS_PATH.read_text(encoding="utf-8")
    frontend_ai_orchestrator_module = FRONTEND_AI_ORCHESTRATOR_PATH.read_text(encoding="utf-8")
    backend_headless_module = BACKEND_HEADLESS_PATH.read_text(encoding="utf-8")
    shared_provider_catalog = json.loads(SHARED_AI_PROVIDER_CATALOG_PATH.read_text(encoding="utf-8"))

    assert packaged_rules_text == AI_CANONICAL_RULES
    assert AI_SYSTEM_PROMPT_TEMPLATE_PATH == SHARED_AI_SYSTEM_PROMPT_TEMPLATE_PATH
    assert shared_system_prompt_template == AI_SYSTEM_PROMPT_TEMPLATE
    assert "SYSTEM_PROMPT = f\"\"\"" not in backend_prompt_module
    assert "import aiCanonicalRules from '../../game_rules.md?raw'" in frontend_prompt_module
    assert "import aiSystemPromptTemplate from '../../shared/aiSystemPrompt.txt?raw'" in frontend_prompt_module
    assert "AI_SYSTEM_PROMPT_TEMPLATE.replace(RULES_PLACEHOLDER, AI_CANONICAL_RULES)" in frontend_prompt_module
    assert "export const STRICT_PROMPT_PROFILE = 'strict'" in frontend_prompt_module
    assert "export const STRICT_BENCHMARK_MAX_OUTPUT_TOKENS = 2048" in frontend_prompt_module
    repair_prompt_match = re.search(r"export const REPAIR_PROMPT =\n\s+'([^']+)'", frontend_prompt_module)
    assert repair_prompt_match is not None
    assert repair_prompt_match.group(1) == STRICT_BENCHMARK_REPAIR_PROMPT
    assert "max_output_tokens: deploymentBatch" in frontend_browser_ai_module
    assert "STRICT_BENCHMARK_DEPLOYMENT_MAX_OUTPUT_TOKENS" in frontend_browser_ai_module
    assert "STRICT_BENCHMARK_MAX_OUTPUT_TOKENS" in frontend_browser_ai_module
    assert "input_mode: 'text_only'" in frontend_browser_ai_module
    assert "requestAnthropicDecision" in frontend_browser_ai_module
    assert "requestOpenAiCompatibleDecision" in frontend_browser_ai_module
    assert "SUPPORTED_BROWSER_AI_PROVIDERS" in frontend_ai_providers_module
    assert "input_mode_used: 'text_only'" in frontend_ai_orchestrator_module
    assert "HEADLESS_BENCHMARK_PROFILE = STRICT_BENCHMARK_PROFILE" in backend_headless_module
    assert "input_mode=AiInputMode.TEXT_ONLY" in backend_headless_module
    assert "include_rationale=include_rationale" in backend_headless_module
    assert "resolveBrowserVisualObservationsText('', provider)" in frontend_browser_ai_module
    assert "import providerCatalog from '../../shared/aiProviderCatalog.json'" in frontend_ai_providers_module
    assert "return providerEntry(provider).label" in frontend_ai_providers_module
    assert all(rule.get("contains") != "/" for rule in shared_provider_catalog["modelProviderRules"])
    assert "did not return separate visual observations for this text-only turn." in frontend_ai_providers_module
    assert "so end_bound was the only legal battle action." in frontend_ai_orchestrator_module
    assert "Priorities:" not in SYSTEM_PROMPT
    assert "Rules overview:" in SYSTEM_PROMPT
    assert AI_CANONICAL_RULES in SYSTEM_PROMPT
    assert "Command radius is `8 + floor((army_size - 1) / 8)`" in SYSTEM_PROMPT
    assert "Close combat resolves only during `end_bound`" in SYSTEM_PROMPT
    assert "Elimination => Rout/disordered/no command" in SYSTEM_PROMPT
    assert "Immediate action effects are immediate deterministic movement/status/PIP/warnings only" in SYSTEM_PROMPT
    assert "Follow the required response schema exactly." in SYSTEM_PROMPT
    assert "Return concise reasoning grounded in the rules and the provided state." not in SYSTEM_PROMPT


def test_strict_system_prompt_is_phase_specific() -> None:
    battle_prompt = system_prompt_for_turn(
        AiTurnRequest(army=ArmyId.A, input_mode=AiInputMode.TEXT_ONLY),
        benchmark_profile="strict",
    )
    deployment_prompt = system_prompt_for_turn(
        AiTurnRequest(army=ArmyId.A, input_mode=AiInputMode.TEXT_ONLY, deployment_batch=True),
        benchmark_profile="strict",
    )
    bound_plan_prompt = system_prompt_for_turn(
        AiTurnRequest(army=ArmyId.A, input_mode=AiInputMode.TEXT_ONLY, battle_batch=True),
        benchmark_profile="strict",
    )

    assert battle_prompt != SYSTEM_PROMPT
    assert deployment_prompt != SYSTEM_PROMPT
    assert bound_plan_prompt != battle_prompt
    assert "Rules capsule:" in battle_prompt
    assert "ordered list" in bound_plan_prompt
    assert "Deployment turn." in deployment_prompt
    assert "Close outcomes:" not in deployment_prompt


def test_build_user_prompt_strict_profile_trims_redundant_sections_and_history() -> None:
    snapshot = _build_choice_snapshot()
    action_catalog = [{"index": 0, "summary": "end bound", "action": {"type": "end_bound"}}]
    action_history = [EndBoundAction(type="end_bound") for _ in range(15)]

    prompt = build_user_prompt(
        snapshot,
        AiTurnRequest(army=ArmyId.A, input_mode=AiInputMode.TEXT_ONLY),
        action_catalog,
        action_history,
        prompt_profile="strict",
    )

    assert "CMD army=SELF mode=action view=local" in prompt
    assert "LEG local view: SELF always advances toward lower y" in prompt
    assert "U=id kind xyF flags" in prompt
    assert "Choose one shown original idx only." in prompt
    assert "STATE" in prompt
    assert "ACTTRUNC earlier=12 showing=3" in prompt
    assert "ACT 13 end_bound" in prompt
    assert "LAST" in prompt
    assert "- end_bound: no close combats were in contact." in prompt
    assert "ACTIONS" in prompt
    assert "N shown=1/1 END=1" in prompt
    assert "END 0" in prompt
    assert "Source of truth:" not in prompt
    assert "Legal actions JSON:" not in prompt
    assert "Immediate action effects by index:" not in prompt
    assert "Recent resolution tail:" not in prompt
    assert "Recent event tail:" not in prompt
    assert "PROFILE knights" not in prompt
    assert "SCORE " not in prompt


def test_build_user_prompt_strict_profile_can_request_bound_plan() -> None:
    snapshot = _build_choice_snapshot()
    action_catalog = [{"index": 0, "summary": "end bound", "action": {"type": "end_bound"}}]

    prompt = build_user_prompt(
        snapshot,
        AiTurnRequest(army=ArmyId.A, input_mode=AiInputMode.TEXT_ONLY, battle_batch=True),
        action_catalog,
        [],
        prompt_profile="strict",
    )

    assert "CMD army=SELF mode=bound_plan view=local" in prompt
    assert "Return ordered semantic order objects for this army's whole bound" in prompt
    assert "GROUPED_ACTIONS" in prompt
    assert "Do not include END" in prompt


def test_build_user_prompt_strict_profile_normalizes_b_side_perspective() -> None:
    snapshot = _build_choice_snapshot()
    action_catalog = [{"index": 0, "summary": "end bound", "action": {"type": "end_bound"}}]

    prompt = build_user_prompt(
        snapshot,
        AiTurnRequest(army=ArmyId.B, input_mode=AiInputMode.TEXT_ONLY),
        action_catalog,
        [],
        prompt_profile="strict",
    )

    assert "CMD army=SELF mode=action view=local" in prompt
    assert "S choice_case battle b3 SELF pip2/5 6x6 win- ready- depENEMY firstENEMY" in prompt
    assert "T 3,3=F" in prompt
    assert "U SELF-PS Ps 3,2N ooc,dis,act" in prompt
    assert "U ENEMY-GEN Kn 3,1S ldr,qs" in prompt
    assert "A-GEN" not in prompt
    assert "B-PS" not in prompt


def test_build_user_prompt_carries_intent_without_action_warnings() -> None:
    snapshot = _build_choice_snapshot()
    action_catalog = [
        {
            "index": 0,
            "summary": "charge A-CV into B-PK warning=Charging an OrderedPike front.",
            "action": {
                "type": "charge",
                "unit_id": "A-CV",
                "target_id": "B-PK",
                "destination": {"x": 2, "y": 2},
                "path": [{"x": 2, "y": 2}],
                "facing": "N",
                "aspect": "front",
                "pip_cost": 1,
                "warning": "Charging an OrderedPike front.",
            },
        }
    ]

    prompt = build_user_prompt(
        snapshot,
        AiTurnRequest(
            army=ArmyId.A,
            input_mode=AiInputMode.TEXT_ONLY,
            current_intent="Hold center; test left.",
            can_update_intent=True,
        ),
        action_catalog,
        [],
        prompt_profile="strict",
    )

    assert "I cur=Hold center; test left. upd=1" in prompt
    assert "Charging an OrderedPike front" not in prompt
    assert '"warning"' not in prompt


def test_build_user_prompt_reports_immediate_charge_evade_effects() -> None:
    state = GameState(
        game_id="ai-evade",
        engine_name="Phalanx Arena",
        engine_version="0.21",
        design_basis="test",
        scenario_id="evade_case",
        scenario_name="Evade Case",
        board_width=6,
        board_height=6,
        phase=GamePhase.BATTLE,
        bound_number=2,
        current_player=ArmyId.A,
        pips_remaining=3,
        last_pip_roll=4,
        seed=13,
        roll_index=2,
        terrain=[],
        deployment_zones=[],
        deployment_ready=[],
        attrition_status=[
            AttritionStatus(army=ArmyId.A, starting_units=1, losses=0, target_losses=1),
            AttritionStatus(army=ArmyId.B, starting_units=1, losses=0, target_losses=1),
        ],
        battle_scores=[
            BattleScore(army=ArmyId.A, enemy_losses=0, total=0),
            BattleScore(army=ArmyId.B, enemy_losses=0, total=0),
        ],
        victory_target=5,
        units=[
            Unit(
                id="A-KN",
                army=ArmyId.A,
                name="Knights",
                kind=UnitKind.KNIGHTS,
                position=Coord(x=2, y=5),
                facing="N",
                leader=True,
                in_command=True,
                disordered=False,
                activated_this_bound=False,
                eliminated=False,
            ),
            Unit(
                id="B-BW",
                army=ArmyId.B,
                name="Bow",
                kind=UnitKind.BOW,
                position=Coord(x=2, y=3),
                facing="S",
                in_command=True,
                disordered=False,
                can_evade=True,
                activated_this_bound=False,
                eliminated=False,
            ),
        ],
        log=[],
        recent_resolutions=[],
        winner_reason=None,
    )
    legal_action = ChargeActionOption(
        unit_id="A-KN",
        target_id="B-BW",
        destination=Coord(x=2, y=4),
        path=[Coord(x=2, y=4)],
        facing="N",
        aspect="front",
        pip_cost=2,
    )
    snapshot = GameSnapshot(state=state, legal_actions=[legal_action], can_undo=True)
    action_catalog = [{"index": 0, "summary": "charge", "action": legal_action.model_dump(mode="json")}]

    prompt = build_user_prompt(
        snapshot,
        AiTurnRequest(army=ArmyId.A, input_mode=AiInputMode.TEXT_ONLY),
        action_catalog,
        [],
        prompt_profile="strict",
    )

    assert "CH 0 c2 SELF-KN>ENEMY-BW@2,4N front e=evade" in prompt
    assert "Immediate action effects by index:" not in prompt


def test_build_user_prompt_reports_last_shot_result_explicitly() -> None:
    state = GameState(
        game_id="ai-shot-result",
        engine_name="Phalanx Arena",
        engine_version="0.21",
        design_basis="test",
        scenario_id="shot_case",
        scenario_name="Shot Case",
        board_width=6,
        board_height=6,
        phase=GamePhase.BATTLE,
        bound_number=2,
        current_player=ArmyId.A,
        pips_remaining=1,
        last_pip_roll=4,
        seed=17,
        roll_index=2,
        terrain=[],
        deployment_zones=[],
        deployment_ready=[],
        attrition_status=[
            AttritionStatus(army=ArmyId.A, starting_units=1, losses=0, target_losses=1),
            AttritionStatus(army=ArmyId.B, starting_units=1, losses=0, target_losses=1),
        ],
        battle_scores=[
            BattleScore(army=ArmyId.A, enemy_losses=0, total=0),
            BattleScore(army=ArmyId.B, enemy_losses=0, total=0),
        ],
        victory_target=5,
        units=[
            Unit(
                id="A-BW1",
                army=ArmyId.A,
                name="Bow",
                kind=UnitKind.BOW,
                position=Coord(x=2, y=4),
                facing="N",
                in_command=True,
                disordered=False,
                activated_this_bound=True,
                eliminated=False,
            ),
            Unit(
                id="B-PS1",
                army=ArmyId.B,
                name="Psiloi",
                kind=UnitKind.PSILOI,
                position=Coord(x=2, y=1),
                facing="S",
                in_command=True,
                disordered=False,
                activated_this_bound=False,
                eliminated=False,
            ),
        ],
        log=[
            LogEntry(step=1, message="A Bow shot at B Psiloi (6 vs 3)."),
            LogEntry(step=2, message="B Psiloi recoiled from (2, 3) to (2, 1)."),
        ],
        recent_resolutions=[
            CombatResolution(
                kind="missile",
                attacker_id="A-BW1",
                attacker_name="Bow",
                attacker_position=Coord(x=2, y=4),
                defender_id="B-PS1",
                defender_name="Psiloi",
                defender_position=Coord(x=2, y=3),
                attacker_score=4,
                attacker_roll=2,
                attacker_total=6,
                defender_score=2,
                defender_roll=1,
                defender_total=3,
                differential=3,
                outcome="recoil",
                winner_id="A-BW1",
                loser_id="B-PS1",
                range=2,
            )
        ],
        winner_reason=None,
    )
    snapshot = GameSnapshot(
        state=state,
        legal_actions=[EndBoundActionOption(type="end_bound")],
        can_undo=True,
    )
    action_catalog = [{"index": 0, "summary": "end bound", "action": {"type": "end_bound"}}]

    prompt = build_user_prompt(
        snapshot,
        AiTurnRequest(army=ArmyId.A, input_mode=AiInputMode.TEXT_ONLY),
        action_catalog,
        [ShootAction(type="shoot", unit_id="A-BW1", target_id="B-PS1")],
        prompt_profile="strict",
    )

    assert "LAST" in prompt
    assert "- shoot SELF-BW1->ENEMY-PS1: ENEMY-PS1 recoiled 2,3 -> 2,1." in prompt


def test_build_user_prompt_reports_last_charge_evade_result_explicitly() -> None:
    state = GameState(
        game_id="ai-charge-result",
        engine_name="Phalanx Arena",
        engine_version="0.21",
        design_basis="test",
        scenario_id="charge_case",
        scenario_name="Charge Case",
        board_width=6,
        board_height=6,
        phase=GamePhase.BATTLE,
        bound_number=2,
        current_player=ArmyId.A,
        pips_remaining=1,
        last_pip_roll=4,
        seed=19,
        roll_index=2,
        terrain=[],
        deployment_zones=[],
        deployment_ready=[],
        attrition_status=[
            AttritionStatus(army=ArmyId.A, starting_units=1, losses=0, target_losses=1),
            AttritionStatus(army=ArmyId.B, starting_units=1, losses=0, target_losses=1),
        ],
        battle_scores=[
            BattleScore(army=ArmyId.A, enemy_losses=0, total=0),
            BattleScore(army=ArmyId.B, enemy_losses=0, total=0),
        ],
        victory_target=5,
        units=[
            Unit(
                id="A-KN",
                army=ArmyId.A,
                name="Knights",
                kind=UnitKind.KNIGHTS,
                position=Coord(x=2, y=4),
                facing="N",
                leader=True,
                in_command=True,
                disordered=False,
                activated_this_bound=True,
                eliminated=False,
            ),
            Unit(
                id="B-BW",
                army=ArmyId.B,
                name="Bow",
                kind=UnitKind.BOW,
                position=Coord(x=2, y=1),
                facing="S",
                in_command=True,
                disordered=True,
                can_evade=True,
                activated_this_bound=False,
                eliminated=False,
            ),
        ],
        log=[
            LogEntry(step=1, message="A Knights charged from (2, 5) to (2, 4) against B-BW (front) via (2, 4)."),
            LogEntry(step=2, message="B Bow evaded from (2, 3) to (2, 1) via (2, 2) -> (2, 1) and became disordered."),
        ],
        recent_resolutions=[],
        winner_reason=None,
    )
    snapshot = GameSnapshot(
        state=state,
        legal_actions=[EndBoundActionOption(type="end_bound")],
        can_undo=True,
    )
    action_catalog = [{"index": 0, "summary": "end bound", "action": {"type": "end_bound"}}]

    prompt = build_user_prompt(
        snapshot,
        AiTurnRequest(army=ArmyId.A, input_mode=AiInputMode.TEXT_ONLY),
        action_catalog,
        [
            ChargeAction(
                type="charge",
                unit_id="A-KN",
                target_id="B-BW",
                destination=Coord(x=2, y=4),
                path=[Coord(x=2, y=4)],
                facing="N",
            )
        ],
        prompt_profile="strict",
    )

    assert "LAST" in prompt
    assert "- charge SELF-KN->ENEMY-BW: ENEMY Bow evaded from (2, 3) to (2, 1) via (2, 2) -> (2, 1) and became disordered." in prompt


def test_extract_usage_metrics_builds_token_and_cost_summary() -> None:
    usage = extract_usage_metrics(
        {
            "usage": {
                "input_tokens": 1200,
                "output_tokens": 300,
                "total_tokens": 1500,
                "input_tokens_details": {"cached_tokens": 200},
                "output_tokens_details": {"reasoning_tokens": 50},
            }
        },
        model="gpt-5.4-mini-2026-04-14",
    )

    assert usage is not None
    assert usage.input_tokens == 1200
    assert usage.output_tokens == 300
    assert usage.total_tokens == 1500
    assert usage.cached_input_tokens == 200
    assert usage.reasoning_tokens == 50
    assert usage.pricing_model == "gpt-5.4-mini"
    assert usage.input_cost_usd == pytest.approx(0.000765)
    assert usage.output_cost_usd == pytest.approx(0.00135)
    assert usage.total_cost_usd == pytest.approx(0.002115)


def test_unknown_model_usage_keeps_tokens_without_cost() -> None:
    usage = extract_usage_metrics(
        {
            "usage": {
                "input_tokens": 1200,
                "output_tokens": 300,
            }
        },
        model="gpt-5.4-preview",
    )

    assert usage is not None
    assert usage.input_tokens == 1200
    assert usage.output_tokens == 300
    assert usage.total_tokens == 1500
    assert usage.pricing_model is None
    assert usage.input_cost_usd is None
    assert usage.output_cost_usd is None
    assert usage.total_cost_usd is None


def test_price_usage_uses_config_overrides_and_leaves_unknown_models_unpriced() -> None:
    overrides = load_model_pricing_overrides(
        json.dumps(
            {
                "gpt-5.4-mini": {
                    "input_usd_per_1m": 1.0,
                    "cached_input_usd_per_1m": 0.5,
                    "output_usd_per_1m": 3.0,
                },
                "custom/model": {
                    "input_usd_per_1m": 2.0,
                    "output_usd_per_1m": 4.0,
                },
            }
        )
    )

    overridden = price_usage(1000, 500, 100, "gpt-5.4-mini", pricing_overrides=overrides)
    custom = price_usage(1000, 500, None, "custom/model", pricing_overrides=overrides)
    unknown = price_usage(1000, 500, None, "gpt-5.4-preview", pricing_overrides=overrides)

    assert overridden.pricing_model == "gpt-5.4-mini"
    assert overridden.input_cost_usd == pytest.approx(0.00095)
    assert overridden.output_cost_usd == pytest.approx(0.0015)
    assert overridden.total_cost_usd == pytest.approx(0.00245)
    assert custom.pricing_model == "custom/model"
    assert custom.total_cost_usd == pytest.approx(0.004)
    assert unknown.pricing_model is None
    assert unknown.total_cost_usd is None


def test_extract_anthropic_tool_input_reads_forced_tool_result() -> None:
    payload = {
        "content": [
            {"type": "text", "text": "Considering the position."},
            {
                "type": "tool_use",
                "name": "submit_action_choice",
                "input": {
                    "selected_action_index": 4,
                    "reasoning": "It wins the center.",
                    "visual_observations": "The center lane is open.",
                    "confidence": 0.72,
                },
            },
        ]
    }

    choice = extract_anthropic_tool_input(payload, tool_name="submit_action_choice")

    assert choice == {
        "selected_action_index": 4,
        "reasoning": "It wins the center.",
        "visual_observations": "The center lane is open.",
        "confidence": 0.72,
    }


def test_extract_anthropic_usage_metrics_builds_token_and_cost_summary() -> None:
    usage = extract_anthropic_usage_metrics(
        {
            "usage": {
                "input_tokens": 1200,
                "output_tokens": 300,
            }
        },
        model="claude-opus-4-6",
    )

    assert usage is not None
    assert usage.input_tokens == 1200
    assert usage.output_tokens == 300
    assert usage.total_tokens == 1500
    assert usage.cached_input_tokens is None
    assert usage.reasoning_tokens is None
    assert usage.pricing_model == "claude-opus-4-6"
    assert usage.input_cost_usd == pytest.approx(0.006)
    assert usage.output_cost_usd == pytest.approx(0.0075)
    assert usage.total_cost_usd == pytest.approx(0.0135)


def test_extract_chat_completion_tool_input_reads_function_arguments() -> None:
    payload = {
        "choices": [
            {
                "message": {
                    "tool_calls": [
                        {
                            "type": "function",
                            "function": {
                                "name": "submit_action_choice",
                                "arguments": (
                                    '{"selected_action_index":2,"reasoning":"Take the lane.",'
                                    '"visual_observations":"The flank is open.","confidence":0.61}'
                                ),
                            },
                        }
                    ]
                }
            }
        ]
    }

    choice = extract_chat_completion_tool_input(payload, tool_name="submit_action_choice")

    assert choice == {
        "selected_action_index": 2,
        "reasoning": "Take the lane.",
        "visual_observations": "The flank is open.",
        "confidence": 0.61,
    }


def test_extract_chat_completion_usage_metrics_builds_token_and_cost_summary() -> None:
    usage = extract_chat_completion_usage_metrics(
        {
            "usage": {
                "prompt_tokens": 1400,
                "completion_tokens": 250,
                "total_tokens": 1650,
            }
        },
        model="gpt-5.4",
    )

    assert usage is not None
    assert usage.input_tokens == 1400
    assert usage.output_tokens == 250
    assert usage.total_tokens == 1650
    assert usage.pricing_model == "gpt-5.4"
    assert usage.input_cost_usd == pytest.approx(0.0035)
    assert usage.output_cost_usd == pytest.approx(0.00375)
    assert usage.total_cost_usd == pytest.approx(0.00725)


def test_missing_commentary_fields_resolve_to_explicit_fallback_text() -> None:
    reasoning = resolve_reasoning_text("", provider_name="anthropic", action_summary="deploy A-BD1 to (6, 6)")
    visual = resolve_visual_observations_text("", provider_name="anthropic")

    assert "Anthropic selected deploy A-BD1 to (6, 6)" in reasoning
    assert "did not supply reasoning" in reasoning
    assert "did not return separate visual observations" in visual


def test_provider_resolution_and_commander_factory_share_inference_rules() -> None:
    assert resolve_provider_name(model="claude-opus-4-6") == "anthropic"
    assert resolve_provider_name(model="grok-4") == "xai"
    assert resolve_provider_name(model="gemini-2.5-pro") == "gemini"
    assert resolve_provider_name(model="mistral-large-latest") == "mistral"
    assert resolve_provider_name(model="meta-llama/llama-4-maverick") == "together"
    assert resolve_provider_name(model="gpt-5.4-mini") == "openai"
    assert resolve_provider_name(model="openai/gpt-5.5") == "openrouter"
    assert resolve_provider_name(model="anthropic/claude-opus-4.7") == "openrouter"
    assert resolve_provider_name(model="deepseek/deepseek-v4-pro") == "openrouter"
    assert resolve_provider_name(model="x-ai/grok-4.20") == "openrouter"
    assert resolve_provider_name(model="google/gemini-3.1-pro-preview") == "openrouter"
    assert resolve_provider_name(model="mistralai/mistral-large-2512") == "openrouter"
    assert resolve_provider_name(model="moonshotai/kimi-k2.6") == "openrouter"
    assert resolve_provider_name(model="meta-llama/llama-4-maverick", provider="together") == "together"
    assert resolve_provider_name(model="claude-opus-4-6", provider="openrouter") == "openrouter"

    assert isinstance(build_commander(model="claude-opus-4-6"), AnthropicAiCommander)
    assert isinstance(build_commander(model="grok-4"), OpenAICompatibleChatCommander)
    assert isinstance(build_commander(model="gemini-2.5-pro"), OpenAICompatibleChatCommander)
    assert isinstance(build_commander(model="gpt-5.4-mini"), OpenAIAiCommander)
    assert isinstance(build_commander(model="openai/gpt-5.5"), OpenAICompatibleChatCommander)


def test_provider_resolution_rejects_unknown_provider() -> None:
    with pytest.raises(AiConfigurationError):
        resolve_provider_name(model="gpt-5.4-mini", provider="not-a-provider")


def test_openai_strict_benchmark_profile_uses_shared_output_cap() -> None:
    snapshot = _build_choice_snapshot()
    commander = OpenAIAiCommander(
        api_key="test-key",
        model="gpt-5.4-mini",
        benchmark_profile="strict",
    )
    captured: dict[str, object] = {}

    def fake_post_response(payload: dict[str, object]) -> dict[str, object]:
        captured["payload"] = payload
        return {
            "model": "gpt-5.4-mini",
            "output_text": (
                '{"selected_action_index":0,"reasoning":"Advance the line.",'
                '"visual_observations":"No blocking terrain ahead.","confidence":0.5}'
            ),
            "usage": {
                "input_tokens": 10,
                "output_tokens": 6,
                "total_tokens": 16,
            },
        }

    commander._post_response = fake_post_response  # type: ignore[method-assign]

    decision = commander.choose_action(
        snapshot,
        AiTurnRequest(army=snapshot.state.current_player, input_mode=AiInputMode.TEXT_ONLY),
        [],
    )

    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["max_output_tokens"] == 2048
    assert payload["reasoning"] == {"effort": "low"}
    assert payload["text"]["format"]["schema"]["required"] == ["selected_action_index", "intent_update"]
    assert set(payload["text"]["format"]["schema"]["properties"]) == {"selected_action_index", "intent_update"}
    assert decision.action_index == 0


def test_openai_strict_benchmark_profile_can_request_rationale() -> None:
    snapshot = _build_choice_snapshot()
    commander = OpenAIAiCommander(
        api_key="test-key",
        model="gpt-5.4-mini",
        benchmark_profile="strict",
    )
    captured: dict[str, object] = {}

    def fake_post_response(payload: dict[str, object]) -> dict[str, object]:
        captured["payload"] = payload
        return {
            "model": "gpt-5.4-mini",
            "output_text": '{"selected_action_index":0,"reasoning":"Advance to keep pressure on the center."}',
            "usage": {
                "input_tokens": 10,
                "output_tokens": 8,
                "total_tokens": 18,
            },
        }

    commander._post_response = fake_post_response  # type: ignore[method-assign]

    decision = commander.choose_action(
        snapshot,
        AiTurnRequest(
            army=snapshot.state.current_player,
            input_mode=AiInputMode.TEXT_ONLY,
            include_rationale=True,
        ),
        [],
    )

    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["text"]["format"]["schema"]["required"] == ["selected_action_index", "intent_update", "reasoning"]
    assert set(payload["text"]["format"]["schema"]["properties"]) == {"selected_action_index", "intent_update", "reasoning"}
    assert decision.reasoning == "Advance to keep pressure on the center."


def test_openai_strict_deployment_batch_uses_placement_schema() -> None:
    snapshot = _build_choice_snapshot()
    commander = OpenAIAiCommander(
        api_key="test-key",
        model="gpt-5.4-mini",
        benchmark_profile="strict",
    )
    captured: dict[str, object] = {}

    def fake_post_response(payload: dict[str, object]) -> dict[str, object]:
        captured["payload"] = payload
        return {
            "model": "gpt-5.4-mini",
            "output_text": '{"placements":[{"unit_id":"A-KN","x":2,"y":2}],"reasoning":"Deploy in one batch."}',
            "usage": {
                "input_tokens": 10,
                "output_tokens": 8,
                "total_tokens": 18,
            },
        }

    commander._post_response = fake_post_response  # type: ignore[method-assign]

    decision = commander.choose_action(
        snapshot,
        AiTurnRequest(
            army=snapshot.state.current_player,
            input_mode=AiInputMode.TEXT_ONLY,
            deployment_batch=True,
        ),
        [],
    )

    payload = captured["payload"]
    assert isinstance(payload, dict)
    schema = payload["text"]["format"]["schema"]
    assert schema["required"] == ["placements", "intent_update"]
    assert set(schema["properties"]) == {"placements", "intent_update"}
    placement_schema = schema["properties"]["placements"]["items"]
    assert placement_schema["required"] == ["unit_id", "x", "y"]
    assert "mode=deployment_batch" in payload["input"][0]["content"][0]["text"]
    assert "Return placements for this army in one response." in payload["input"][0]["content"][0]["text"]
    assert decision.deployment_placements[0].unit_id == "A-KN"
    assert decision.action_index == 0


def test_openai_strict_battle_batch_uses_grouped_order_schema() -> None:
    snapshot = _build_choice_snapshot()
    commander = OpenAIAiCommander(
        api_key="test-key",
        model="gpt-5.4-mini",
        benchmark_profile="strict",
    )
    captured: dict[str, object] = {}

    def fake_post_response(payload: dict[str, object]) -> dict[str, object]:
        captured["payload"] = payload
        return {
            "model": "gpt-5.4-mini",
            "output_text": '{"orders":[],"intent_update":""}',
            "usage": {
                "input_tokens": 10,
                "output_tokens": 4,
                "total_tokens": 14,
            },
        }

    commander._post_response = fake_post_response  # type: ignore[method-assign]

    decision = commander.choose_action(
        snapshot,
        AiTurnRequest(
            army=snapshot.state.current_player,
            input_mode=AiInputMode.TEXT_ONLY,
            battle_batch=True,
        ),
        [],
    )

    payload = captured["payload"]
    assert isinstance(payload, dict)
    schema = payload["text"]["format"]["schema"]
    assert schema["required"] == ["orders", "intent_update"]
    assert set(schema["properties"]) == {"orders", "intent_update"}
    assert schema["properties"]["orders"]["maxItems"] == 2
    order_schema = schema["properties"]["orders"]["items"]
    assert order_schema["required"] == ["type", "unit_id", "unit_ids", "target_id", "x", "y", "facing", "steps"]
    assert "mode=bound_plan" in payload["input"][0]["content"][0]["text"]
    assert "Do not include END" in payload["input"][0]["content"][0]["text"]
    assert "GROUPED_ACTIONS" in payload["input"][0]["content"][0]["text"]
    assert decision.action_indices == []
    assert decision.action_summary == "bound plan: 0 orders"


def test_openai_strict_battle_batch_maps_grouped_orders_to_legal_actions() -> None:
    snapshot = _build_choice_snapshot().model_copy(
        update={
            "legal_actions": [
                RallyActionOption(unit_id="A-GEN", pip_cost=1),
                EndBoundActionOption(type="end_bound"),
            ]
        }
    )
    commander = OpenAIAiCommander(
        api_key="test-key",
        model="gpt-5.4-mini",
        benchmark_profile="strict",
    )

    def fake_post_response(payload: dict[str, object]) -> dict[str, object]:
        return {
            "model": "gpt-5.4-mini",
            "output_text": json.dumps(
                {
                    "orders": [
                        {
                            "type": "rally",
                            "unit_id": "SELF-GEN",
                            "unit_ids": [],
                            "target_id": None,
                            "x": None,
                            "y": None,
                            "facing": None,
                            "steps": [],
                        }
                    ],
                    "intent_update": "",
                }
            ),
            "usage": {
                "input_tokens": 10,
                "output_tokens": 4,
                "total_tokens": 14,
            },
        }

    commander._post_response = fake_post_response  # type: ignore[method-assign]

    decision = commander.choose_action(
        snapshot,
        AiTurnRequest(
            army=snapshot.state.current_player,
            input_mode=AiInputMode.TEXT_ONLY,
            battle_batch=True,
        ),
        [],
    )

    assert decision.action_indices == [0]
    assert decision.actions is not None
    assert decision.actions[0].type == "rally"
    assert decision.action_summary == "bound plan: 1/1 matched orders"
    assert decision.battle_orders is not None
    assert decision.battle_orders[0].unit_id == "SELF-GEN"


def test_anthropic_strict_benchmark_profile_uses_shared_cap_and_temperature_zero() -> None:
    snapshot = _build_choice_snapshot()
    commander = AnthropicAiCommander(
        api_key="test-key",
        model="claude-opus-4-6",
        benchmark_profile="strict",
    )
    captured: dict[str, object] = {}

    def fake_post_message(payload: dict[str, object]) -> dict[str, object]:
        captured["payload"] = payload
        return {
            "model": "claude-opus-4-6",
            "content": [
                {
                    "type": "tool_use",
                    "name": "submit_action_choice",
                    "input": {
                        "selected_action_index": 0,
                        "reasoning": "Hold the center.",
                        "visual_observations": "The center lane is open.",
                        "confidence": 0.5,
                    },
                }
            ],
            "usage": {
                "input_tokens": 12,
                "output_tokens": 8,
            },
        }

    commander._post_message = fake_post_message  # type: ignore[method-assign]

    decision = commander.choose_action(
        snapshot,
        AiTurnRequest(army=snapshot.state.current_player, input_mode=AiInputMode.TEXT_ONLY),
        [],
    )

    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["max_tokens"] == 2048
    assert payload["temperature"] == 0
    assert payload["tools"][0]["input_schema"]["required"] == ["selected_action_index", "intent_update"]
    assert set(payload["tools"][0]["input_schema"]["properties"]) == {"selected_action_index", "intent_update"}
    assert decision.action_index == 0


def test_anthropic_strict_benchmark_profile_can_request_rationale() -> None:
    snapshot = _build_choice_snapshot()
    commander = AnthropicAiCommander(
        api_key="test-key",
        model="claude-opus-4-6",
        benchmark_profile="strict",
    )
    captured: dict[str, object] = {}

    def fake_post_message(payload: dict[str, object]) -> dict[str, object]:
        captured["payload"] = payload
        return {
            "model": "claude-opus-4-6",
            "content": [
                {
                    "type": "tool_use",
                    "name": "submit_action_choice",
                    "input": {
                        "selected_action_index": 0,
                        "reasoning": "Advance to keep pressure on the center.",
                    },
                }
            ],
            "usage": {
                "input_tokens": 12,
                "output_tokens": 8,
            },
        }

    commander._post_message = fake_post_message  # type: ignore[method-assign]

    decision = commander.choose_action(
        snapshot,
        AiTurnRequest(
            army=snapshot.state.current_player,
            input_mode=AiInputMode.TEXT_ONLY,
            include_rationale=True,
        ),
        [],
    )

    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["tools"][0]["input_schema"]["required"] == ["selected_action_index", "intent_update", "reasoning"]
    assert set(payload["tools"][0]["input_schema"]["properties"]) == {"selected_action_index", "intent_update", "reasoning"}
    assert decision.reasoning == "Advance to keep pressure on the center."


def test_anthropic_opus_4_7_strict_profile_omits_temperature() -> None:
    snapshot = _build_choice_snapshot()
    commander = AnthropicAiCommander(
        api_key="test-key",
        model="claude-opus-4-7",
        benchmark_profile="strict",
    )
    captured: dict[str, object] = {}

    def fake_post_message(payload: dict[str, object]) -> dict[str, object]:
        captured["payload"] = payload
        return {
            "model": "claude-opus-4-7",
            "content": [
                {
                    "type": "tool_use",
                    "name": "submit_action_choice",
                    "input": {
                        "selected_action_index": 0,
                    },
                }
            ],
            "usage": {
                "input_tokens": 12,
                "output_tokens": 8,
            },
        }

    commander._post_message = fake_post_message  # type: ignore[method-assign]

    decision = commander.choose_action(
        snapshot,
        AiTurnRequest(army=snapshot.state.current_player, input_mode=AiInputMode.TEXT_ONLY),
        [],
    )

    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["max_tokens"] == 2048
    assert "temperature" not in payload
    assert decision.action_index == 0


def test_openai_compatible_strict_benchmark_profile_uses_shared_cap_and_temperature_zero() -> None:
    snapshot = _build_choice_snapshot()
    commander = OpenAICompatibleChatCommander(
        provider_name="together",
        api_key="test-key",
        model="meta-llama/Llama-3.3-70B-Instruct-Turbo",
        base_url="https://example.com/v1",
        benchmark_profile="strict",
    )
    captured: dict[str, object] = {}

    def fake_post_chat_completion(payload: dict[str, object]) -> dict[str, object]:
        captured["payload"] = payload
        return {
            "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
            "choices": [
                {
                    "message": {
                        "tool_calls": [
                            {
                                "type": "function",
                                "function": {
                                    "name": "submit_action_choice",
                                    "arguments": (
                                        '{"selected_action_index":0,"reasoning":"Advance the line.",'
                                        '"visual_observations":"No blocking terrain ahead.","confidence":0.5}'
                                    ),
                                },
                            }
                        ]
                    }
                }
            ],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 6,
                "total_tokens": 16,
            },
        }

    commander._post_chat_completion = fake_post_chat_completion  # type: ignore[method-assign]

    decision = commander.choose_action(
        snapshot,
        AiTurnRequest(army=snapshot.state.current_player, input_mode=AiInputMode.TEXT_ONLY),
        [],
    )

    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["max_tokens"] == 2048
    assert payload["temperature"] == 0
    assert payload["tools"][0]["function"]["parameters"]["required"] == ["selected_action_index", "intent_update"]
    assert set(payload["tools"][0]["function"]["parameters"]["properties"]) == {"selected_action_index", "intent_update"}
    assert decision.action_index == 0


def test_openai_compatible_gpt_oss_battle_batch_falls_back_to_exact_indices() -> None:
    snapshot = _build_choice_snapshot().model_copy(
        update={
            "legal_actions": [
                RallyActionOption(unit_id="A-GEN", pip_cost=1),
                EndBoundActionOption(type="end_bound"),
            ]
        }
    )
    commander = OpenAICompatibleChatCommander(
        provider_name="openrouter",
        api_key="test-key",
        model="openai/gpt-oss-120b:free",
        base_url="https://example.com/v1",
        benchmark_profile="strict",
    )
    captured: list[dict[str, object]] = []

    def chat_response(arguments: dict[str, object], total_tokens: int) -> dict[str, object]:
        return {
            "model": "openai/gpt-oss-120b:free",
            "choices": [
                {
                    "message": {
                        "tool_calls": [
                            {
                                "type": "function",
                                "function": {
                                    "name": "submit_action_choice",
                                    "arguments": json.dumps(arguments),
                                },
                            }
                        ]
                    }
                }
            ],
            "usage": {
                "prompt_tokens": total_tokens - 2,
                "completion_tokens": 2,
                "total_tokens": total_tokens,
            },
        }

    def fake_post_chat_completion(payload: dict[str, object]) -> dict[str, object]:
        captured.append(payload)
        if len(captured) == 1:
            return chat_response(
                {
                    "orders": [
                        {
                            "type": "rally",
                            "unit_id": "SELF-BAD",
                            "unit_ids": [],
                            "target_id": None,
                            "x": None,
                            "y": None,
                            "facing": None,
                            "steps": [],
                        }
                    ],
                    "intent_update": "",
                },
                10,
            )
        return chat_response({"selected_action_indices": [0], "intent_update": ""}, 12)

    commander._post_chat_completion = fake_post_chat_completion  # type: ignore[method-assign]

    decision = commander.choose_action(
        snapshot,
        AiTurnRequest(
            army=snapshot.state.current_player,
            input_mode=AiInputMode.TEXT_ONLY,
            battle_batch=True,
        ),
        [],
    )

    assert len(captured) == 2
    first_schema = captured[0]["tools"][0]["function"]["parameters"]
    fallback_schema = captured[1]["tools"][0]["function"]["parameters"]
    assert first_schema["required"] == ["orders", "intent_update"]
    assert fallback_schema["required"] == ["selected_action_indices", "intent_update"]
    assert "Fallback exact-action mode" in captured[1]["messages"][0]["content"]
    assert "Fallback exact-action mode" in captured[1]["messages"][1]["content"]
    assert decision.action_indices == [0]
    assert decision.actions is not None
    assert decision.actions[0].type == "rally"
    assert decision.action_summary == "bound plan: 1 orders"
    assert decision.usage is not None
    assert decision.usage.total_tokens == 22


def test_openai_compatible_strict_benchmark_profile_can_request_rationale() -> None:
    snapshot = _build_choice_snapshot()
    commander = OpenAICompatibleChatCommander(
        provider_name="together",
        api_key="test-key",
        model="meta-llama/Llama-3.3-70B-Instruct-Turbo",
        base_url="https://example.com/v1",
        benchmark_profile="strict",
    )
    captured: dict[str, object] = {}

    def fake_post_chat_completion(payload: dict[str, object]) -> dict[str, object]:
        captured["payload"] = payload
        return {
            "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
            "choices": [
                {
                    "message": {
                        "tool_calls": [
                            {
                                "type": "function",
                                "function": {
                                    "name": "submit_action_choice",
                                    "arguments": (
                                        '{"selected_action_index":0,'
                                        '"reasoning":"Advance to keep pressure on the center."}'
                                    ),
                                },
                            }
                        ]
                    }
                }
            ],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 8,
                "total_tokens": 18,
            },
        }

    commander._post_chat_completion = fake_post_chat_completion  # type: ignore[method-assign]

    decision = commander.choose_action(
        snapshot,
        AiTurnRequest(
            army=snapshot.state.current_player,
            input_mode=AiInputMode.TEXT_ONLY,
            include_rationale=True,
        ),
        [],
    )

    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["tools"][0]["function"]["parameters"]["required"] == ["selected_action_index", "intent_update", "reasoning"]
    assert set(payload["tools"][0]["function"]["parameters"]["properties"]) == {"selected_action_index", "intent_update", "reasoning"}
    assert decision.reasoning == "Advance to keep pressure on the center."


def test_openai_compatible_post_chat_completion_retries_retryable_http_errors(monkeypatch) -> None:
    commander = OpenAICompatibleChatCommander(
        provider_name="mistral",
        api_key="test-key",
        model="mistral-small-latest",
        base_url="https://example.com/v1",
    )
    attempts = {"count": 0}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self) -> bytes:
            return json.dumps({"ok": True}).encode("utf-8")

    def fake_urlopen(request, timeout):
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise urllib_error.HTTPError(
                request.full_url,
                503,
                "Service Unavailable",
                hdrs={},
                fp=io.BytesIO(b'{"message":"Internal server error"}'),
            )
        return FakeResponse()

    monkeypatch.setenv("PHALANX_AI_RETRY_ATTEMPTS", "3")
    monkeypatch.setenv("PHALANX_AI_RETRY_BACKOFF_SECONDS", "0")
    monkeypatch.setenv("PHALANX_MISTRAL_THROTTLE_SECONDS", "0")
    monkeypatch.setattr("backend.ai_common.urllib_request.urlopen", fake_urlopen)

    payload = commander._post_chat_completion({"model": "mistral-small-latest", "messages": []})

    assert payload == {"ok": True}
    assert attempts["count"] == 3


def test_post_json_request_throttles_mistral_requests(monkeypatch) -> None:
    request = urllib_request.Request("https://example.com/v1/chat/completions")
    sleeps: list[float] = []
    monotonic_values = iter([0.0, 0.2, 1.0])

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self) -> bytes:
            return json.dumps({"ok": True}).encode("utf-8")

    def fake_urlopen(request, timeout):
        return FakeResponse()

    monkeypatch.setenv("PHALANX_MISTRAL_THROTTLE_SECONDS", "1")
    monkeypatch.setattr("backend.ai_common.urllib_request.urlopen", fake_urlopen)
    monkeypatch.setattr("backend.ai_common.time.monotonic", lambda: next(monotonic_values))
    monkeypatch.setattr("backend.ai_common.time.sleep", lambda seconds: sleeps.append(seconds))
    monkeypatch.setattr("backend.ai_common._PROVIDER_LAST_REQUEST_STARTED_AT", {})

    assert post_json_request(request=request, timeout_seconds=1, provider_name="mistral") == {"ok": True}
    assert post_json_request(request=request, timeout_seconds=1, provider_name="mistral") == {"ok": True}

    assert sleeps == [0.8]


def test_provider_throttle_sleeps_after_releasing_lock(monkeypatch) -> None:
    sleeps: list[float] = []
    sleep_saw_released_lock: list[bool] = []
    monotonic_values = iter([0.0, 0.2])

    def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        acquired = ai_module._PROVIDER_THROTTLE_LOCK.acquire(blocking=False)
        sleep_saw_released_lock.append(acquired)
        if acquired:
            ai_module._PROVIDER_THROTTLE_LOCK.release()

    monkeypatch.setenv("PHALANX_MISTRAL_THROTTLE_SECONDS", "1")
    monkeypatch.setattr("backend.ai_common.time.monotonic", lambda: next(monotonic_values))
    monkeypatch.setattr("backend.ai_common.time.sleep", fake_sleep)
    monkeypatch.setattr("backend.ai_common._PROVIDER_LAST_REQUEST_STARTED_AT", {})

    ai_module.throttle_provider_request("mistral")
    ai_module.throttle_provider_request("mistral")

    assert sleeps == [0.8]
    assert sleep_saw_released_lock == [True]


def test_openai_compatible_post_chat_completion_sends_explicit_user_agent(monkeypatch) -> None:
    commander = OpenAICompatibleChatCommander(
        provider_name="together",
        api_key="test-key",
        model="meta-llama/Llama-3.3-70B-Instruct-Turbo",
        base_url="https://example.com/v1",
    )
    captured: dict[str, object] = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self) -> bytes:
            return json.dumps({"ok": True}).encode("utf-8")

    def fake_urlopen(request, timeout):
        captured["headers"] = dict(request.header_items())
        return FakeResponse()

    monkeypatch.setenv("PHALANX_HTTP_USER_AGENT", "PhalanxArena-Test/1.0")
    monkeypatch.setattr("backend.ai_common.urllib_request.urlopen", fake_urlopen)

    payload = commander._post_chat_completion({"model": "meta-llama/Llama-3.3-70B-Instruct-Turbo", "messages": []})

    assert payload == {"ok": True}
    headers = captured["headers"]
    assert isinstance(headers, dict)
    assert headers["User-agent"] == "PhalanxArena-Test/1.0"
    assert headers["Accept"] == "application/json"


def test_post_json_request_surfaces_plain_text_http_errors(monkeypatch) -> None:
    def fake_urlopen(request, timeout):
        raise urllib_error.HTTPError(
            request.full_url,
            403,
            "Forbidden",
            hdrs={},
            fp=io.BytesIO(b"error code: 1010"),
        )

    monkeypatch.setenv("PHALANX_AI_RETRY_ATTEMPTS", "1")
    monkeypatch.setattr("backend.ai_common.urllib_request.urlopen", fake_urlopen)

    request = urllib_request.Request(
        "https://example.com/v1/chat/completions",
        data=b"{}",
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with pytest.raises(AiDecisionError, match="Together request failed: error code: 1010"):
        post_json_request(request=request, timeout_seconds=1, provider_name="together")


def test_post_json_request_retries_timeout_errors(monkeypatch) -> None:
    attempts = {"count": 0}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> bool:
            return False

        def read(self) -> bytes:
            return json.dumps({"ok": True}).encode("utf-8")

    def fake_urlopen(request, timeout):
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise TimeoutError("timed out")
        return FakeResponse()

    monkeypatch.setenv("PHALANX_AI_RETRY_ATTEMPTS", "3")
    monkeypatch.setenv("PHALANX_AI_RETRY_BACKOFF_SECONDS", "0")
    monkeypatch.setenv("PHALANX_MISTRAL_THROTTLE_SECONDS", "0")
    monkeypatch.setattr("backend.ai_common.urllib_request.urlopen", fake_urlopen)

    request = urllib_request.Request(
        "https://example.com/v1/chat/completions",
        data=b"{}",
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    payload = post_json_request(request=request, timeout_seconds=1, provider_name="gemini")

    assert payload == {"ok": True}
    assert attempts["count"] == 3


def test_post_json_request_retries_connection_errors(monkeypatch) -> None:
    attempts = {"count": 0}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> bool:
            return False

        def read(self) -> bytes:
            return json.dumps({"ok": True}).encode("utf-8")

    def fake_urlopen(request, timeout):
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise ConnectionResetError("connection reset by peer")
        return FakeResponse()

    monkeypatch.setenv("PHALANX_AI_RETRY_ATTEMPTS", "3")
    monkeypatch.setenv("PHALANX_AI_RETRY_BACKOFF_SECONDS", "0")
    monkeypatch.setenv("PHALANX_MISTRAL_THROTTLE_SECONDS", "0")
    monkeypatch.setattr("backend.ai_common.urllib_request.urlopen", fake_urlopen)

    request = urllib_request.Request(
        "https://example.com/v1/chat/completions",
        data=b"{}",
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    payload = post_json_request(request=request, timeout_seconds=1, provider_name="mistral")

    assert payload == {"ok": True}
    assert attempts["count"] == 3


def test_post_json_request_surfaces_timeout_after_retries(monkeypatch) -> None:
    attempts = {"count": 0}

    def fake_urlopen(request, timeout):
        attempts["count"] += 1
        raise TimeoutError("timed out")

    monkeypatch.setenv("PHALANX_AI_RETRY_ATTEMPTS", "2")
    monkeypatch.setenv("PHALANX_AI_RETRY_BACKOFF_SECONDS", "0")
    monkeypatch.setattr("backend.ai_common.urllib_request.urlopen", fake_urlopen)

    request = urllib_request.Request(
        "https://example.com/v1/chat/completions",
        data=b"{}",
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with pytest.raises(AiDecisionError, match="Gemini request timed out."):
        post_json_request(request=request, timeout_seconds=1, provider_name="gemini")

    assert attempts["count"] == 2


def test_openai_compatible_gemini_25_strict_profile_disables_reasoning_budget() -> None:
    snapshot = _build_choice_snapshot()
    commander = OpenAICompatibleChatCommander(
        provider_name="gemini",
        api_key="test-key",
        model="gemini-2.5-flash",
        base_url="https://example.com/v1",
        benchmark_profile="strict",
    )
    captured: dict[str, object] = {}

    def fake_post_chat_completion(payload: dict[str, object]) -> dict[str, object]:
        captured["payload"] = payload
        return {
            "model": "gemini-2.5-flash",
            "choices": [
                {
                    "message": {
                        "tool_calls": [
                            {
                                "type": "function",
                                "function": {
                                    "name": "submit_action_choice",
                                    "arguments": (
                                        '{"selected_action_index":0,"reasoning":"Advance the line.",'
                                        '"visual_observations":"No blocking terrain ahead.","confidence":0.5}'
                                    ),
                                },
                            }
                        ]
                    }
                }
            ],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 6,
                "total_tokens": 16,
            },
        }

    commander._post_chat_completion = fake_post_chat_completion  # type: ignore[method-assign]

    decision = commander.choose_action(
        snapshot,
        AiTurnRequest(army=snapshot.state.current_player, input_mode=AiInputMode.TEXT_ONLY),
        [],
    )

    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["reasoning_effort"] == "none"
    assert decision.action_index == 0


def test_openai_compatible_gemini_3_strict_profile_uses_minimal_reasoning_and_auto_tool_choice() -> None:
    snapshot = _build_choice_snapshot()
    commander = OpenAICompatibleChatCommander(
        provider_name="gemini",
        api_key="test-key",
        model="gemini-3.1-pro-preview",
        base_url="https://example.com/v1",
        benchmark_profile="strict",
    )
    captured: dict[str, object] = {}

    def fake_post_chat_completion(payload: dict[str, object]) -> dict[str, object]:
        captured["payload"] = payload
        return {
            "model": "gemini-3.1-pro-preview",
            "choices": [
                {
                    "message": {
                        "content": '{"selected_action_index":0}',
                    }
                }
            ],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 6,
                "total_tokens": 16,
            },
        }

    commander._post_chat_completion = fake_post_chat_completion  # type: ignore[method-assign]

    decision = commander.choose_action(
        snapshot,
        AiTurnRequest(army=snapshot.state.current_player, input_mode=AiInputMode.TEXT_ONLY),
        [],
    )

    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["max_tokens"] == GEMINI_3_STRICT_MAX_OUTPUT_TOKENS
    assert payload["reasoning_effort"] == "low"
    assert payload["tool_choice"] == "auto"
    assert decision.action_index == 0


def test_openai_compatible_strict_benchmark_repairs_malformed_first_reply_and_sums_usage() -> None:
    snapshot = _build_choice_snapshot()
    commander = OpenAICompatibleChatCommander(
        provider_name="gemini",
        api_key="test-key",
        model="gemini-2.5-flash",
        base_url="https://example.com/v1",
        benchmark_profile="strict",
    )
    captured_payloads: list[dict[str, object]] = []

    def fake_post_chat_completion(payload: dict[str, object]) -> dict[str, object]:
        captured_payloads.append(payload)
        if len(captured_payloads) == 1:
            return {
                "model": "gemini-2.5-flash",
                "choices": [{"message": {"content": ""}}],
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 0,
                    "total_tokens": 10,
                },
            }
        return {
            "model": "gemini-2.5-flash",
            "choices": [
                {
                    "message": {
                        "tool_calls": [
                            {
                                "type": "function",
                                "function": {
                                    "name": "submit_action_choice",
                                    "arguments": '{"selected_action_index":0}',
                                },
                            }
                        ]
                    }
                }
            ],
            "usage": {
                "prompt_tokens": 12,
                "completion_tokens": 4,
                "total_tokens": 16,
            },
        }

    commander._post_chat_completion = fake_post_chat_completion  # type: ignore[method-assign]

    decision = commander.choose_action(
        snapshot,
        AiTurnRequest(army=snapshot.state.current_player, input_mode=AiInputMode.TEXT_ONLY),
        [],
    )

    assert len(captured_payloads) == 2
    assert captured_payloads[1]["messages"][1]["content"].endswith(STRICT_BENCHMARK_REPAIR_PROMPT)
    assert decision.action_index == 0
    assert decision.usage is not None
    assert decision.usage.input_tokens == 22
    assert decision.usage.output_tokens == 4
    assert decision.usage.total_tokens == 26


def test_openai_compatible_strict_benchmark_repairs_invalid_action_index() -> None:
    snapshot = _build_choice_snapshot()
    commander = OpenAICompatibleChatCommander(
        provider_name="mistral",
        api_key="test-key",
        model="mistral-large-latest",
        base_url="https://example.com/v1",
        benchmark_profile="strict",
    )
    captured_payloads: list[dict[str, object]] = []

    def fake_post_chat_completion(payload: dict[str, object]) -> dict[str, object]:
        captured_payloads.append(payload)
        selected_action_index = 59 if len(captured_payloads) == 1 else 0
        return {
            "model": "mistral-large-latest",
            "choices": [
                {
                    "message": {
                        "tool_calls": [
                            {
                                "type": "function",
                                "function": {
                                    "name": "submit_action_choice",
                                    "arguments": json.dumps({"selected_action_index": selected_action_index}),
                                },
                            }
                        ]
                    }
                }
            ],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 4,
                "total_tokens": 14,
            },
        }

    commander._post_chat_completion = fake_post_chat_completion  # type: ignore[method-assign]

    decision = commander.choose_action(
        snapshot,
        AiTurnRequest(army=snapshot.state.current_player, input_mode=AiInputMode.TEXT_ONLY),
        [],
    )

    assert len(captured_payloads) == 2
    assert captured_payloads[1]["messages"][1]["content"].endswith(STRICT_BENCHMARK_REPAIR_PROMPT)
    assert decision.action_index == 0
    assert decision.usage is not None
    assert decision.usage.input_tokens == 20
    assert decision.usage.output_tokens == 8
    assert decision.usage.total_tokens == 28
