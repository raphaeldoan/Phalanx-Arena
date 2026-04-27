from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
GAME_RULES_PATH = REPO_ROOT / "game_rules.md"
PACKAGED_GAME_RULES_PATH = Path(__file__).with_name("game_rules.md")
AI_SYSTEM_PROMPT_TEMPLATE_PATH = REPO_ROOT / "shared" / "aiSystemPrompt.txt"
PACKAGED_AI_SYSTEM_PROMPT_TEMPLATE_PATH = Path(__file__).with_name("aiSystemPrompt.txt")
RULES_PLACEHOLDER = "{{AI_CANONICAL_RULES}}"


def load_text_file(primary_path: Path, packaged_path: Path, label: str) -> str:
    text_path = primary_path if primary_path.exists() else packaged_path
    try:
        text = text_path.read_text(encoding="utf-8").strip()
    except OSError as error:  # pragma: no cover - exercised through import failures
        raise RuntimeError(f"Unable to read {label} from {text_path}.") from error

    if not text:
        raise RuntimeError(f"{text_path} is empty.")
    return text


def load_ai_canonical_rules() -> str:
    return load_text_file(GAME_RULES_PATH, PACKAGED_GAME_RULES_PATH, "AI rules")


def load_ai_system_prompt_template() -> str:
    return load_text_file(
        AI_SYSTEM_PROMPT_TEMPLATE_PATH,
        PACKAGED_AI_SYSTEM_PROMPT_TEMPLATE_PATH,
        "AI system prompt template",
    )


def render_system_prompt(template: str, rules_text: str) -> str:
    if RULES_PLACEHOLDER not in template:
        raise RuntimeError(f"AI system prompt template is missing {RULES_PLACEHOLDER}.")
    return template.replace(RULES_PLACEHOLDER, rules_text)


AI_CANONICAL_RULES = load_ai_canonical_rules()
AI_SYSTEM_PROMPT_TEMPLATE = load_ai_system_prompt_template()

SYSTEM_PROMPT = render_system_prompt(AI_SYSTEM_PROMPT_TEMPLATE, AI_CANONICAL_RULES)


STRICT_DEPLOYMENT_SYSTEM_PROMPT = """You command one side in a deterministic ancient battle game.

Deployment turn. The prompt is a local SELF/ENEMY view: SELF always advances toward lower y, and unit ids are aliases. Return placements for the listed SELF reserve units only. The prompt lists each unit and the legal local cells; choose unique legal cells in your deployment zone. Keep same facing. If a finalize action is shown and no reserves remain, finalize. Use only provided state/options and follow the response schema exactly."""


STRICT_BATTLE_SYSTEM_PROMPT = """You command one side in a deterministic ancient battle game.

The prompt is a local SELF/ENEMY view: SELF always advances toward lower y, and unit ids are aliases. Choose exactly one shown original legal action index. The state and shown action list are authoritative; do not invent actions.

Rules capsule: A bound is one army turn; end_bound resolves queued shooting, close combats, morale/victory, then passes play with fresh PIPs. PIPs buy orders; units activate once per bound. Units in enemy contact are in close combat and cannot take ordinary orders; no-effect combat keeps both units in combat, while fresh light troops may break off with shown move actions and become disordered. Command comes from active leaders in radius; out-of-command and difficult/artillery/elephant orders cost more. Terrain: F forest, H hill, W water, R road, unlisted open. Movement/charges are immediate; shooting is queued now and resolves at end_bound before close combat; close combat dice happen only at end_bound.

Combat reminders: Ordered pikes are strong frontally, especially against mounted/elephants/chariots. Flank/rear contacts, overlaps, terrain, quality, disorder, leader aura, support, charge impact, and pressure affect close combat. Missile fire and lost combat can disorder, recoil, flee, destroy, or panic elephants/chariots. Destroyed units add morale loss; armies shaken/broken at threshold. Immediate action effects are deterministic movement/status/PIP effects only; future dice are unknown.

Use the current intent if useful. Return only the required response schema."""


STRICT_BOUND_PLAN_SYSTEM_PROMPT = """You command one side in a deterministic ancient battle game.

The prompt is a local SELF/ENEMY view: SELF always advances toward lower y, and unit ids are aliases. Return an ordered list of semantic order objects for this army's whole bound, using only shown grouped legal actions. Do not include end_bound; the harness will end the bound after attempting the plan. Use SELF/ENEMY ids and local x,y/facing exactly as shown. Use null or [] for order fields that do not apply. Prefer at most one order per unit. The state and shown action list are authoritative; do not invent actions.

Rules capsule: A bound is one army turn; end_bound resolves queued shooting, close combats, morale/victory, then passes play with fresh PIPs. PIPs buy orders; units activate once per bound. Units in enemy contact are in close combat and cannot take ordinary orders; no-effect combat keeps both units in combat, while fresh light troops may break off with shown move actions and become disordered. Command comes from active leaders in radius; out-of-command and difficult/artillery/elephant orders cost more. Terrain: F forest, H hill, W water, R road, unlisted open. Movement/charges are immediate; shooting is queued now and resolves at end_bound before close combat; close combat dice happen only at end_bound.

Combat reminders: Later planned orders can be skipped if earlier orders spend PIPs, activate a unit, move a unit, or otherwise make them illegal. Ordered pikes are strong frontally, especially against mounted/elephants/chariots. Flank/rear contacts, overlaps, terrain, quality, disorder, leader aura, support, charge impact, and pressure affect close combat. Missile fire and lost combat can disorder, recoil, flee, destroy, or panic elephants/chariots. Destroyed units add morale loss; armies shaken/broken at threshold.

Use the current intent if useful. Return only the required response schema."""


def system_prompt_for_turn(request, *, benchmark_profile: str | None = None) -> str:
    if benchmark_profile == "strict":
        if request.deployment_batch:
            return STRICT_DEPLOYMENT_SYSTEM_PROMPT
        if request.battle_batch:
            return STRICT_BOUND_PLAN_SYSTEM_PROMPT
        return STRICT_BATTLE_SYSTEM_PROMPT
    return SYSTEM_PROMPT
