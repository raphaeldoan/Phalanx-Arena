import aiCanonicalRules from '../../game_rules.md?raw'
import aiSystemPromptTemplate from '../../shared/aiSystemPrompt.txt?raw'

export const STRICT_PROMPT_PROFILE = 'strict'
export const STRICT_BENCHMARK_MAX_OUTPUT_TOKENS = 2048
export const STRICT_BENCHMARK_DEPLOYMENT_MAX_OUTPUT_TOKENS = 4096
export const GEMINI_3_STRICT_MAX_OUTPUT_TOKENS = 1024
export const REPAIR_PROMPT =
  'Repair: the previous reply was empty or malformed. Return only the required response format with the required action choice field(s) and no extra commentary.'

export const AI_CANONICAL_RULES = aiCanonicalRules.trim()
export const AI_SYSTEM_PROMPT_TEMPLATE = aiSystemPromptTemplate.trim()

const RULES_PLACEHOLDER = '{{AI_CANONICAL_RULES}}'

export const SYSTEM_PROMPT = AI_SYSTEM_PROMPT_TEMPLATE.replace(RULES_PLACEHOLDER, AI_CANONICAL_RULES)

export const STRICT_DEPLOYMENT_SYSTEM_PROMPT = `You command one side in a deterministic ancient battle game.

Deployment turn. Return placements for the listed reserve units only. The prompt lists each unit and the legal cells; choose unique legal cells in your deployment zone. Keep same facing. If a finalize action is shown and no reserves remain, finalize. Use only provided state/options and follow the response schema exactly.`

export const STRICT_BATTLE_SYSTEM_PROMPT = `You command one side in a deterministic ancient battle game.

Choose exactly one shown original legal action index. The state and shown action list are authoritative; do not invent actions.

Rules capsule: A bound is one army turn; end_bound resolves queued shooting, close combats, morale/victory, then passes play with fresh PIPs. PIPs buy orders; units activate once per bound. Units in enemy contact are in close combat and cannot take ordinary orders; no-effect combat keeps both units in combat, while fresh light troops may break off with shown move actions and become disordered. Command comes from active leaders in radius; out-of-command and difficult/artillery/elephant orders cost more. Terrain: F forest, H hill, W water, R road, unlisted open. Movement/charges are immediate; shooting is queued now and resolves at end_bound before close combat; close combat dice happen only at end_bound.

Combat reminders: Ordered pikes are strong frontally, especially against mounted/elephants/chariots. Flank/rear contacts, overlaps, terrain, quality, disorder, leader aura, support, charge impact, and pressure affect close combat. Missile fire and lost combat can disorder, recoil, flee, destroy, or panic elephants/chariots. Destroyed units add morale loss; armies shaken/broken at threshold. Immediate action effects are deterministic movement/status/PIP effects only; future dice are unknown.

Use the current intent if useful. Return only the required response schema.`

export const STRICT_BOUND_PLAN_SYSTEM_PROMPT = `You command one side in a deterministic ancient battle game.

Return an ordered list of semantic order objects for this army's whole bound, using only shown grouped legal actions. Do not include end_bound; the harness will end the bound after attempting the plan. Use SELF/ENEMY ids and local x,y/facing exactly as shown. Use null or [] for order fields that do not apply. Prefer at most one order per unit. The state and shown action list are authoritative; do not invent actions.

Rules capsule: A bound is one army turn; end_bound resolves queued shooting, close combats, morale/victory, then passes play with fresh PIPs. PIPs buy orders; units activate once per bound. Units in enemy contact are in close combat and cannot take ordinary orders; no-effect combat keeps both units in combat, while fresh light troops may break off with shown move actions and become disordered. Command comes from active leaders in radius; out-of-command and difficult/artillery/elephant orders cost more. Terrain: F forest, H hill, W water, R road, unlisted open. Movement/charges are immediate; shooting is queued now and resolves at end_bound before close combat; close combat dice happen only at end_bound.

Combat reminders: Later planned orders can be skipped if earlier orders spend PIPs, activate a unit, move a unit, or otherwise make them illegal. Ordered pikes are strong frontally, especially against mounted/elephants/chariots. Flank/rear contacts, overlaps, terrain, quality, disorder, leader aura, support, charge impact, and pressure affect close combat. Missile fire and lost combat can disorder, recoil, flee, destroy, or panic elephants/chariots. Destroyed units add morale loss; armies shaken/broken at threshold.

Use the current intent if useful. Return only the required response schema.`

export function strictSystemPromptForTurn(deploymentBatch: boolean, battleBatch = false): string {
  if (deploymentBatch) {
    return STRICT_DEPLOYMENT_SYSTEM_PROMPT
  }
  return battleBatch ? STRICT_BOUND_PLAN_SYSTEM_PROMPT : STRICT_BATTLE_SYSTEM_PROMPT
}
