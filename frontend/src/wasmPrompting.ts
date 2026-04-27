import initEngineWasm, {
  build_action_catalog_json,
  build_user_prompt_json,
  describe_legal_action_json,
  legal_action_to_action_json,
} from './generated/engine-wasm/engine_wasm'
import type { Action, AiTurnRequest, GameSnapshot, LegalAction } from './types'

let wasmReady: Promise<unknown> | null = null

async function ensureWasmReady(): Promise<void> {
  if (!wasmReady) {
    wasmReady = initEngineWasm()
  }
  await wasmReady
}

export interface ActionCatalogEntry {
  index: number
  summary: string
  action: LegalAction
}

export async function buildWasmActionCatalog(legalActions: LegalAction[]): Promise<ActionCatalogEntry[]> {
  await ensureWasmReady()
  return JSON.parse(build_action_catalog_json(JSON.stringify(legalActions))) as ActionCatalogEntry[]
}

export async function buildWasmUserPrompt(
  snapshot: GameSnapshot,
  request: AiTurnRequest,
  actionCatalog: ActionCatalogEntry[],
  actionHistory: Action[],
  promptProfile = '',
): Promise<string> {
  await ensureWasmReady()
  return normalizeLegacyUserPrompt(
    build_user_prompt_json(
      JSON.stringify(snapshot),
      JSON.stringify(request),
      JSON.stringify(actionCatalog),
      JSON.stringify(actionHistory),
      promptProfile,
    ),
  )
}

function normalizeLegacyUserPrompt(promptText: string): string {
  return promptText
    .replace(/^Board input mode: .*\r?\n?/m, '')
    .replace(/^Rendered image attached: .*\r?\n?/m, '')
}

export async function describeWasmLegalAction(action: LegalAction): Promise<string> {
  await ensureWasmReady()
  return describe_legal_action_json(JSON.stringify(action))
}

export async function materializeWasmLegalAction(action: LegalAction): Promise<Action> {
  await ensureWasmReady()
  return JSON.parse(legal_action_to_action_json(JSON.stringify(action))) as Action
}
