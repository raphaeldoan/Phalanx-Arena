import {
  type BrowserAiProviderName,
  isGemini25Model,
  isGemini3Model,
  providerDisplayName,
  resolveBrowserReasoningText,
  resolveBrowserVisualObservationsText,
} from './aiProviders'
import type { Action, AiUsage, Direction, GameSnapshot, LegalAction } from './types'
import { materializeAction } from './battlefieldShared'
import {
  REPAIR_PROMPT,
  GEMINI_3_STRICT_MAX_OUTPUT_TOKENS,
  STRICT_BENCHMARK_DEPLOYMENT_MAX_OUTPUT_TOKENS,
  STRICT_BENCHMARK_MAX_OUTPUT_TOKENS,
  STRICT_PROMPT_PROFILE,
  strictSystemPromptForTurn,
} from './aiSystemPrompt'
import {
  buildWasmActionCatalog,
  buildWasmUserPrompt,
  describeWasmLegalAction,
  materializeWasmLegalAction,
} from './wasmPrompting'

export interface BrowserAiSelection {
  actionIndex: number
  actionIndices: number[]
  placements: DeploymentPlacement[]
  actionSummary: string
  reasoning: string
  visualObservations: string
  confidence: number
  intentUpdate: string | null
  promptText: string
  rawText: string
  model: string
  usage: AiUsage | null
}

export interface BrowserAiTurnInput {
  actionHistory: Action[]
  apiKey: string
  baseUrl: string
  canUpdateIntent: boolean
  currentIntent: string
  deploymentBatch: boolean
  battleBatch: boolean
  legalActions: LegalAction[]
  model: string
  provider: BrowserAiProviderName
  snapshot: GameSnapshot
}

const ACTION_CHOICE_SCHEMA_NAME = 'phalanx_ai_action_choice'
const ACTION_CHOICE_TOOL_NAME = 'submit_action_choice'
const ACTION_CHOICE_REASONING_DESCRIPTION =
  'A one or two sentence rationale for the chosen legal action, grounded in the rules and current state.'
const BATTLE_EXACT_ACTION_FALLBACK_PROMPT =
  'Fallback exact-action mode: the previous semantic battle orders did not map to shown legal actions. Return selected_action_indices as an ordered array of shown original idx values from GROUPED_ACTIONS/ACTIONS. Exclude END. Prefer useful non-duplicate orders within the available PIPs; use [] only when no non-END order is useful.'
const DEFAULT_MISTRAL_MIN_REQUEST_INTERVAL_MS = 20_000
const MISTRAL_THROTTLE_STORAGE_KEY = 'phalanx.mistralThrottleSeconds'

let lastMistralRequestStartedAt = 0

type BrowserAiPayload = {
  selected_action_index: number | null
  selected_action_indices: number[]
  placements: DeploymentPlacement[]
  orders: BattleOrder[]
  reasoning: string
  intent_update: string
}

export interface DeploymentPlacement {
  unit_id: string
  x: number
  y: number
}

export interface BattleOrderStep {
  unit_id: string | null
  target_id: string | null
  x: number | null
  y: number | null
  facing: string | null
}

export interface BattleOrder {
  type: string
  unit_id: string | null
  unit_ids: string[]
  target_id: string | null
  x: number | null
  y: number | null
  facing: string | null
  steps: BattleOrderStep[]
}

type BrowserAiDecisionResponse = {
  model: string
  rawPayload: unknown
  rawText: string
  usage: AiUsage | null
}

type JsonRecord = Record<string, unknown>

export async function requestBrowserAiSelection({
  actionHistory,
  apiKey,
  baseUrl,
  canUpdateIntent,
  currentIntent,
  deploymentBatch,
  battleBatch,
  legalActions,
  model,
  provider,
  snapshot,
}: BrowserAiTurnInput): Promise<BrowserAiSelection> {
  const actionCatalog = await buildWasmActionCatalog(legalActions)
  const promptText = await buildWasmUserPrompt(
    snapshot,
    {
      army: snapshot.state.current_player,
      input_mode: 'text_only',
      current_intent: currentIntent,
      can_update_intent: canUpdateIntent,
      deployment_batch: deploymentBatch,
      battle_batch: battleBatch,
    },
    actionCatalog,
    actionHistory,
    STRICT_PROMPT_PROFILE,
  )

  const usageRecords: Array<AiUsage | null> = []
  let response = await requestProviderDecision({
    apiKey,
    baseUrl,
    maximumActionIndex: actionCatalog.length - 1,
    model,
    promptText,
    provider,
    repaired: false,
    deploymentBatch,
    battleBatch,
  })
  usageRecords.push(response.usage)

  let rawText = response.rawText.trim()
  let parsedPayload = parseBrowserAiPayload(response.rawPayload, battleBatch)
  if (parsedPayload === null) {
    response = await requestProviderDecision({
      apiKey,
      baseUrl,
      maximumActionIndex: actionCatalog.length - 1,
      model,
      promptText,
      provider,
      repaired: true,
      deploymentBatch,
      battleBatch,
    })
    usageRecords.push(response.usage)
    rawText = response.rawText.trim()
    parsedPayload = parseBrowserAiPayload(response.rawPayload, battleBatch)
  }

  if (parsedPayload === null) {
    throw new Error(`${providerDisplayName(provider)} returned an empty or invalid decision payload.`)
  }

  const selectedActionIndices = normalizeSelectedActionIndices(parsedPayload, deploymentBatch, battleBatch, legalActions, snapshot)
  if (!battleBatch && !selectedActionIndices.length && !parsedPayload.placements.length) {
    throw new Error(`${providerDisplayName(provider)} did not return any action choice fields.`)
  }
  const actionIndex = selectedActionIndices[0] ?? 0
  const chosenLegalAction = legalActions[actionIndex] ?? legalActions[0]
  if (!chosenLegalAction) {
    throw new Error(`${providerDisplayName(provider)} selected invalid action index ${actionIndex}.`)
  }

  const actionSummary = await resolveActionSummary(chosenLegalAction)
  return {
    actionIndex,
    actionIndices: selectedActionIndices,
    placements: parsedPayload.placements,
    actionSummary,
    reasoning: resolveBrowserReasoningText(parsedPayload.reasoning, provider, actionSummary),
    visualObservations: resolveBrowserVisualObservationsText('', provider),
    confidence: 0.5,
    intentUpdate: canUpdateIntent ? normalizeIntentUpdate(parsedPayload.intent_update) : null,
    promptText,
    rawText,
    model: response.model || model,
    usage: mergeUsages(usageRecords),
  }
}

async function requestProviderDecision({
  apiKey,
  baseUrl,
  deploymentBatch,
  battleBatch,
  maximumActionIndex,
  model,
  promptText,
  provider,
  repaired,
  exactActionFallback = false,
}: {
  apiKey: string
  baseUrl: string
  deploymentBatch: boolean
  battleBatch: boolean
  maximumActionIndex: number
  model: string
  promptText: string
  provider: BrowserAiProviderName
  repaired: boolean
  exactActionFallback?: boolean
}): Promise<BrowserAiDecisionResponse> {
  if (provider === 'openai') {
    return requestOpenAiDecision({
      apiKey,
      baseUrl,
      maximumActionIndex,
      model,
      promptText,
      repaired,
      deploymentBatch,
      battleBatch,
      exactActionFallback,
    })
  }
  if (provider === 'anthropic') {
    return requestAnthropicDecision({
      apiKey,
      baseUrl,
      maximumActionIndex,
      model,
      promptText,
      repaired,
      deploymentBatch,
      battleBatch,
      exactActionFallback,
    })
  }
  return requestOpenAiCompatibleDecision({
    apiKey,
    baseUrl,
    maximumActionIndex,
    model,
    promptText,
    provider,
    repaired,
    deploymentBatch,
    battleBatch,
    exactActionFallback,
  })
}

async function requestOpenAiDecision({
  apiKey,
  baseUrl,
  deploymentBatch,
  battleBatch,
  maximumActionIndex,
  model,
  promptText,
  repaired,
  exactActionFallback,
}: {
  apiKey: string
  baseUrl: string
  deploymentBatch: boolean
  battleBatch: boolean
  maximumActionIndex: number
  model: string
  promptText: string
  repaired: boolean
  exactActionFallback: boolean
}): Promise<BrowserAiDecisionResponse> {
  const response = await postJson(
    `${normalizeBaseUrl(baseUrl)}/responses`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        buildOpenAiRequest({
          model,
          promptText,
          repaired,
          maximumActionIndex,
          deploymentBatch,
          battleBatch,
          exactActionFallback,
        }),
      ),
    },
    'openai',
  )
  const rawPayload = extractOpenAiOutputText(response)
  return {
    model: readString(response.model) ?? model,
    rawPayload,
    rawText: typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload),
    usage: extractOpenAiUsage(response),
  }
}

async function requestAnthropicDecision({
  apiKey,
  baseUrl,
  deploymentBatch,
  battleBatch,
  maximumActionIndex,
  model,
  promptText,
  repaired,
  exactActionFallback,
}: {
  apiKey: string
  baseUrl: string
  deploymentBatch: boolean
  battleBatch: boolean
  maximumActionIndex: number
  model: string
  promptText: string
  repaired: boolean
  exactActionFallback: boolean
}): Promise<BrowserAiDecisionResponse> {
  const response = await postJson(
    `${normalizeBaseUrl(baseUrl)}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(
        buildAnthropicRequest({
          model,
          promptText,
          repaired,
          maximumActionIndex,
          deploymentBatch,
          battleBatch,
          exactActionFallback,
        }),
      ),
    },
    'anthropic',
  )
  const rawPayload = extractAnthropicToolInput(response, ACTION_CHOICE_TOOL_NAME) ?? extractAnthropicText(response)
  return {
    model: readString(response.model) ?? model,
    rawPayload,
    rawText: typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload),
    usage: extractAnthropicUsage(response),
  }
}

async function requestOpenAiCompatibleDecision({
  apiKey,
  baseUrl,
  deploymentBatch,
  battleBatch,
  maximumActionIndex,
  model,
  provider,
  promptText,
  repaired,
  exactActionFallback,
}: {
  apiKey: string
  baseUrl: string
  deploymentBatch: boolean
  battleBatch: boolean
  maximumActionIndex: number
  model: string
  provider: BrowserAiProviderName
  promptText: string
  repaired: boolean
  exactActionFallback: boolean
}): Promise<BrowserAiDecisionResponse> {
  const response = await postJson(
    `${normalizeBaseUrl(baseUrl)}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        buildOpenAiCompatibleRequest({
          model,
          promptText,
          provider,
          repaired,
          maximumActionIndex,
          deploymentBatch,
          battleBatch,
          exactActionFallback,
        }),
      ),
    },
    provider,
  )
  const rawPayload =
    extractChatCompletionToolInput(response, ACTION_CHOICE_TOOL_NAME) ?? extractChatCompletionText(response)
  return {
    model: readString(response.model) ?? model,
    rawPayload,
    rawText: typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload),
    usage: extractChatCompletionUsage(response),
  }
}

function buildOpenAiRequest({
  model,
  promptText,
  repaired,
  maximumActionIndex,
  deploymentBatch,
  battleBatch,
  exactActionFallback,
}: {
  model: string
  promptText: string
  repaired: boolean
  maximumActionIndex: number
  deploymentBatch: boolean
  battleBatch: boolean
  exactActionFallback: boolean
}): Record<string, unknown> {
  return {
    model,
    instructions: buildSystemPromptForDecision(deploymentBatch, battleBatch, exactActionFallback),
    max_output_tokens: deploymentBatch || battleBatch
      ? STRICT_BENCHMARK_DEPLOYMENT_MAX_OUTPUT_TOKENS
      : STRICT_BENCHMARK_MAX_OUTPUT_TOKENS,
    text: {
      format: {
        type: 'json_schema',
        name: ACTION_CHOICE_SCHEMA_NAME,
        strict: true,
        schema: buildActionChoiceSchema(maximumActionIndex, deploymentBatch, battleBatch, exactActionFallback),
      },
    },
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: buildPromptTextForDecision(promptText, repaired, exactActionFallback),
          },
        ],
      },
    ],
  }
}

function buildAnthropicRequest({
  model,
  promptText,
  repaired,
  maximumActionIndex,
  deploymentBatch,
  battleBatch,
  exactActionFallback,
}: {
  model: string
  promptText: string
  repaired: boolean
  maximumActionIndex: number
  deploymentBatch: boolean
  battleBatch: boolean
  exactActionFallback: boolean
}): Record<string, unknown> {
  return {
    model,
    system: `${buildSystemPromptForDecision(
      deploymentBatch,
      battleBatch,
      exactActionFallback,
    )}\nReturn the final answer by calling the ${ACTION_CHOICE_TOOL_NAME} tool exactly once.`,
    max_tokens:
      deploymentBatch || battleBatch ? STRICT_BENCHMARK_DEPLOYMENT_MAX_OUTPUT_TOKENS : STRICT_BENCHMARK_MAX_OUTPUT_TOKENS,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildPromptTextForDecision(promptText, repaired, exactActionFallback),
          },
        ],
      },
    ],
    tools: [
      {
        name: ACTION_CHOICE_TOOL_NAME,
        description:
          'Return the required action choice field(s), optional intent update, and a one or two sentence rationale.',
        input_schema: buildActionChoiceSchema(maximumActionIndex, deploymentBatch, battleBatch, exactActionFallback),
      },
    ],
    tool_choice: {
      type: 'tool',
      name: ACTION_CHOICE_TOOL_NAME,
    },
  }
}

function buildOpenAiCompatibleRequest({
  model,
  promptText,
  provider,
  repaired,
  maximumActionIndex,
  deploymentBatch,
  battleBatch,
  exactActionFallback,
}: {
  model: string
  promptText: string
  provider: BrowserAiProviderName
  repaired: boolean
  maximumActionIndex: number
  deploymentBatch: boolean
  battleBatch: boolean
  exactActionFallback: boolean
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model,
    max_tokens:
      deploymentBatch || battleBatch
        ? STRICT_BENCHMARK_DEPLOYMENT_MAX_OUTPUT_TOKENS
        : provider === 'gemini' && isGemini3Model(model)
        ? GEMINI_3_STRICT_MAX_OUTPUT_TOKENS
        : STRICT_BENCHMARK_MAX_OUTPUT_TOKENS,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: buildSystemPromptForDecision(deploymentBatch, battleBatch, exactActionFallback),
      },
      {
        role: 'user',
        content: buildPromptTextForDecision(promptText, repaired, exactActionFallback),
      },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: ACTION_CHOICE_TOOL_NAME,
          description:
            'Return the required action choice field(s), optional intent update, and a one or two sentence rationale.',
          parameters: buildActionChoiceSchema(maximumActionIndex, deploymentBatch, battleBatch, exactActionFallback),
        },
      },
    ],
    tool_choice: provider === 'mistral' ? 'any' : 'required',
  }
  if (provider === 'gemini' && isGemini25Model(model)) {
    payload.reasoning_effort = 'none'
  } else if (provider === 'gemini' && isGemini3Model(model)) {
    payload.reasoning_effort = 'low'
  }
  return payload
}

function buildActionChoiceSchema(
  maximumActionIndex: number,
  deploymentBatch: boolean,
  battleBatch: boolean,
  exactActionFallback = false,
): Record<string, unknown> {
  const selectionProperties: Record<string, unknown> = deploymentBatch
    ? {
        placements: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unit_id: {
                type: 'string',
                description: 'The unit id to deploy.',
              },
              x: {
                type: 'integer',
                minimum: 0,
              },
              y: {
                type: 'integer',
                minimum: 0,
              },
            },
            required: ['unit_id', 'x', 'y'],
            additionalProperties: false,
          },
          minItems: 1,
          description: "Deployment coordinates for this army's reserve units.",
        },
      }
    : battleBatch && exactActionFallback
      ? {
          selected_action_indices: {
            type: 'array',
            items: {
              type: 'integer',
              minimum: 0,
              maximum: maximumActionIndex,
            },
            maxItems: 8,
            description:
              'Ordered shown original legal action indices for this army bound. Exclude end_bound/END; the harness ends the bound after attempting the plan.',
          },
        }
    : battleBatch
      ? {
          orders: buildBattleOrderSchema(),
        }
    : {
        selected_action_index: {
          type: 'integer',
          minimum: 0,
          maximum: maximumActionIndex,
          description: 'The index of the chosen legal action.',
        },
      }
  const requiredSelection = deploymentBatch
    ? 'placements'
    : battleBatch && exactActionFallback
      ? 'selected_action_indices'
      : battleBatch
        ? 'orders'
        : 'selected_action_index'
  return {
    type: 'object',
    properties: {
      ...selectionProperties,
      intent_update: {
        type: 'string',
        maxLength: 220,
        description: 'Replacement for the current intent when updates are allowed; use an empty string to keep it.',
      },
      reasoning: {
        type: 'string',
        description: ACTION_CHOICE_REASONING_DESCRIPTION,
      },
    },
    required: [requiredSelection, 'intent_update', 'reasoning'],
    additionalProperties: false,
  }
}

function buildSystemPromptForDecision(
  deploymentBatch: boolean,
  battleBatch: boolean,
  exactActionFallback: boolean,
): string {
  const prompt = strictSystemPromptForTurn(deploymentBatch, battleBatch)
  return exactActionFallback ? `${prompt}\n${BATTLE_EXACT_ACTION_FALLBACK_PROMPT}` : prompt
}

function buildPromptTextForDecision(promptText: string, repaired: boolean, exactActionFallback: boolean): string {
  let text = exactActionFallback ? `${promptText}\n\n${BATTLE_EXACT_ACTION_FALLBACK_PROMPT}` : promptText
  if (repaired) {
    text = `${text}\n\n${REPAIR_PROMPT}`
  }
  return text
}

function buildBattleOrderSchema(): Record<string, unknown> {
  const nullableString = { type: ['string', 'null'] }
  const nullableInteger = { type: ['integer', 'null'] }
  const nullableFacing = { type: ['string', 'null'], enum: ['N', 'E', 'S', 'W', null] }
  const stepSchema = {
    type: 'object',
    properties: {
      unit_id: nullableString,
      target_id: nullableString,
      x: nullableInteger,
      y: nullableInteger,
      facing: nullableFacing,
    },
    required: ['unit_id', 'target_id', 'x', 'y', 'facing'],
    additionalProperties: false,
  }
  return {
    type: 'array',
    maxItems: 8,
    items: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: [
            'move',
            'march_move',
            'charge',
            'group_move',
            'group_march_move',
            'group_charge',
            'rotate',
            'shoot',
            'rally',
            'reform_pike',
          ],
        },
        unit_id: nullableString,
        unit_ids: {
          type: 'array',
          items: { type: 'string' },
        },
        target_id: nullableString,
        x: nullableInteger,
        y: nullableInteger,
        facing: nullableFacing,
        steps: {
          type: 'array',
          items: stepSchema,
        },
      },
      required: ['type', 'unit_id', 'unit_ids', 'target_id', 'x', 'y', 'facing', 'steps'],
      additionalProperties: false,
    },
    description:
      'Ordered semantic orders to attempt for this army bound. Use SELF/ENEMY ids and local coordinates/facing exactly as shown. Use null or [] for fields that do not apply.',
  }
}

async function postJson(
  url: string,
  init: RequestInit,
  provider: BrowserAiProviderName,
): Promise<JsonRecord> {
  const headers = (init.headers ?? {}) as Record<string, string>
  let response: Response
  try {
    await throttleBrowserAiProvider(provider)
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...headers,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'request failed'
    throw new Error(`${providerDisplayName(provider)} request failed: ${message}`)
  }

  const rawBody = await response.text()
  let payload: unknown = null
  if (rawBody.trim()) {
    try {
      payload = JSON.parse(rawBody) as unknown
    } catch {
      payload = rawBody
    }
  }

  if (!response.ok) {
    const apiError = extractApiErrorMessage(payload)
    throw new Error(apiError || `${providerDisplayName(provider)} request failed with status ${response.status}.`)
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`${providerDisplayName(provider)} returned a non-object JSON payload.`)
  }
  return payload as JsonRecord
}

async function throttleBrowserAiProvider(provider: BrowserAiProviderName): Promise<void> {
  if (provider !== 'mistral') {
    return
  }
  const intervalMs = resolveBrowserMistralThrottleMs()
  if (intervalMs <= 0) {
    return
  }
  const now = Date.now()
  const delayMs = intervalMs - (now - lastMistralRequestStartedAt)
  if (delayMs > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, delayMs))
  }
  lastMistralRequestStartedAt = Date.now()
}

function resolveBrowserMistralThrottleMs(): number {
  try {
    const raw = window.localStorage.getItem(MISTRAL_THROTTLE_STORAGE_KEY)
    if (raw !== null) {
      const parsedSeconds = Number.parseFloat(raw)
      if (Number.isFinite(parsedSeconds)) {
        return Math.max(0, parsedSeconds * 1000)
      }
    }
  } catch {
    // Ignore localStorage failures and use the built-in conservative default.
  }
  return DEFAULT_MISTRAL_MIN_REQUEST_INTERVAL_MS
}

function extractApiErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  const apiError = (payload as JsonRecord).error
  if (apiError && typeof apiError === 'object' && !Array.isArray(apiError)) {
    const message = readString((apiError as JsonRecord).message)
    if (message) {
      return message
    }
  }
  return readString((payload as JsonRecord).message)
}

function parseBrowserAiPayload(rawPayload: unknown, allowEmptySelection = false): BrowserAiPayload | null {
  if (!rawPayload) {
    return null
  }

  let payload: Partial<Record<string, unknown>>
  if (typeof rawPayload === 'string') {
    if (!rawPayload.trim()) {
      return null
    }
    try {
      payload = JSON.parse(rawPayload) as Partial<Record<string, unknown>>
    } catch {
      return null
    }
  } else if (typeof rawPayload === 'object' && !Array.isArray(rawPayload)) {
    payload = rawPayload as Partial<Record<string, unknown>>
  } else {
    return null
  }

  const selectedActionIndex = toInteger(payload.selected_action_index)
  const rawSelectedActionIndices = payload.selected_action_indices
  const hasSelectedActionIndicesField = Array.isArray(rawSelectedActionIndices)
  const selectedActionIndices = hasSelectedActionIndicesField
    ? rawSelectedActionIndices.map((value: unknown) => toInteger(value)).filter((value): value is number => value !== null)
    : []
  const placements = parseDeploymentPlacements(payload.placements ?? payload.deployment_placements)
  const rawOrders = payload.orders
  const hasOrdersField = Array.isArray(rawOrders)
  const orders = parseBattleOrders(rawOrders)
  const reasoning = typeof payload.reasoning === 'string' ? payload.reasoning.trim() : ''
  const intentUpdate =
    typeof payload.intent_update === 'string'
      ? payload.intent_update
      : typeof payload.plan_update === 'string'
        ? payload.plan_update
        : ''
  if (
    selectedActionIndex === null &&
    selectedActionIndices.length === 0 &&
    placements.length === 0 &&
    orders.length === 0 &&
    !(allowEmptySelection && (hasSelectedActionIndicesField || hasOrdersField))
  ) {
    return null
  }
  if (!reasoning) {
    return null
  }
  return {
    selected_action_index: selectedActionIndex,
    selected_action_indices: selectedActionIndices,
    placements,
    orders,
    reasoning,
    intent_update: intentUpdate,
  }
}

function parseDeploymentPlacements(rawPlacements: unknown): DeploymentPlacement[] {
  if (!Array.isArray(rawPlacements)) {
    return []
  }
  const placements: DeploymentPlacement[] = []
  for (const rawPlacement of rawPlacements) {
    if (!rawPlacement || typeof rawPlacement !== 'object' || Array.isArray(rawPlacement)) {
      continue
    }
    const record = rawPlacement as JsonRecord
    const unitId = readString(record.unit_id)
    const x = toInteger(record.x)
    const y = toInteger(record.y)
    if (!unitId || x === null || y === null) {
      continue
    }
    placements.push({ unit_id: unitId, x, y })
  }
  return placements
}

function parseBattleOrders(rawOrders: unknown): BattleOrder[] {
  if (!Array.isArray(rawOrders)) {
    return []
  }
  const orders: BattleOrder[] = []
  for (const rawOrder of rawOrders) {
    if (!rawOrder || typeof rawOrder !== 'object' || Array.isArray(rawOrder)) {
      continue
    }
    const record = rawOrder as JsonRecord
    const type = readString(record.type) || readString(record.action_type)
    if (!type) {
      continue
    }
    const unitIds = Array.isArray(record.unit_ids)
      ? record.unit_ids.map((value) => readString(value)).filter((value): value is string => Boolean(value))
      : []
    orders.push({
      type,
      unit_id: readString(record.unit_id),
      unit_ids: unitIds,
      target_id: readString(record.target_id),
      x: toInteger(record.x),
      y: toInteger(record.y),
      facing: readString(record.facing),
      steps: parseBattleOrderSteps(record.steps),
    })
  }
  return orders
}

function parseBattleOrderSteps(rawSteps: unknown): BattleOrderStep[] {
  if (!Array.isArray(rawSteps)) {
    return []
  }
  const steps: BattleOrderStep[] = []
  for (const rawStep of rawSteps) {
    if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) {
      continue
    }
    const record = rawStep as JsonRecord
    steps.push({
      unit_id: readString(record.unit_id),
      target_id: readString(record.target_id),
      x: toInteger(record.x),
      y: toInteger(record.y),
      facing: readString(record.facing),
    })
  }
  return steps
}

function normalizeSelectedActionIndices(
  payload: BrowserAiPayload,
  deploymentBatch: boolean,
  battleBatch: boolean,
  legalActions: LegalAction[],
  snapshot: GameSnapshot,
): number[] {
  if (battleBatch && payload.orders.length) {
    return battleOrderIndices(payload.orders, legalActions, snapshot)
  }
  const rawIndices = deploymentBatch || battleBatch
    ? payload.selected_action_indices.length
      ? payload.selected_action_indices
      : payload.selected_action_index === null
        ? []
        : [payload.selected_action_index]
    : payload.selected_action_index === null
      ? []
      : [payload.selected_action_index]
  const selected: number[] = []
  const seen = new Set<number>()
  for (const index of rawIndices) {
    if (index < 0 || seen.has(index)) {
      continue
    }
    seen.add(index)
    selected.push(index)
  }
  return selected
}

function battleOrderIndices(orders: BattleOrder[], legalActions: LegalAction[], snapshot: GameSnapshot): number[] {
  const selected: number[] = []
  const usedIndices = new Set<number>()
  const usedUnits = new Set<string>()
  for (const order of orders) {
    const index = matchBattleOrderToLegalAction(order, legalActions, snapshot, usedIndices, usedUnits)
    if (index === null) {
      continue
    }
    selected.push(index)
    usedIndices.add(index)
    for (const unitId of orderedUnitIds(legalActions[index])) {
      usedUnits.add(unitId)
    }
  }
  return selected
}

function matchBattleOrderToLegalAction(
  order: BattleOrder,
  legalActions: LegalAction[],
  snapshot: GameSnapshot,
  usedIndices: Set<number>,
  usedUnits: Set<string>,
): number | null {
  const orderType = normalizeBattleOrderType(order.type)
  if (!orderType) {
    return null
  }
  const orderUnits = battleOrderUnitIds(order, snapshot)
  if (orderUnits.some((unitId) => usedUnits.has(unitId))) {
    return null
  }
  const matches: number[] = []
  legalActions.forEach((legalAction, index) => {
    if (usedIndices.has(index) || legalAction.type !== orderType || legalAction.type === 'end_bound') {
      return
    }
    if (battleOrderMatchesAction(order, legalAction, snapshot)) {
      matches.push(index)
    }
  })
  return matches.length === 1 ? matches[0] : null
}

function normalizeBattleOrderType(rawType: string): LegalAction['type'] | null {
  const normalized = rawType.trim().toLowerCase().replace(/[-\s]+/g, '_')
  const aliases: Record<string, LegalAction['type']> = {
    march: 'march_move',
    group_march: 'group_march_move',
    reform: 'reform_pike',
    reform_pikes: 'reform_pike',
  }
  const actionType = aliases[normalized] ?? normalized
  return [
    'move',
    'march_move',
    'charge',
    'group_move',
    'group_march_move',
    'group_charge',
    'rotate',
    'shoot',
    'rally',
    'reform_pike',
  ].includes(actionType)
    ? (actionType as LegalAction['type'])
    : null
}

function battleOrderMatchesAction(order: BattleOrder, legalAction: LegalAction, snapshot: GameSnapshot): boolean {
  switch (legalAction.type) {
    case 'move':
    case 'march_move':
      return (
        singleUnitMatches(order, legalAction.unit_id, snapshot) &&
        destinationMatches(order, legalAction.destination, snapshot) &&
        facingMatches(order, legalAction.facing, snapshot)
      )
    case 'charge':
      return (
        singleUnitMatches(order, legalAction.unit_id, snapshot) &&
        targetMatches(order, legalAction.target_id, snapshot) &&
        destinationMatches(order, legalAction.destination, snapshot) &&
        facingMatches(order, legalAction.facing, snapshot)
      )
    case 'group_move':
    case 'group_march_move':
      return groupUnitsMatch(order, legalAction.unit_ids, snapshot) && groupMoveStepsMatch(order.steps, legalAction.steps, snapshot)
    case 'group_charge':
      return groupUnitsMatch(order, legalAction.unit_ids, snapshot) && groupChargeStepsMatch(order.steps, legalAction.steps, snapshot)
    case 'rotate':
      return singleUnitMatches(order, legalAction.unit_id, snapshot) && facingMatches(order, legalAction.facing, snapshot)
    case 'shoot':
      return singleUnitMatches(order, legalAction.unit_id, snapshot) && targetMatches(order, legalAction.target_id, snapshot)
    case 'rally':
    case 'reform_pike':
      return singleUnitMatches(order, legalAction.unit_id, snapshot)
    default:
      return false
  }
}

function battleOrderUnitIds(order: BattleOrder, snapshot: GameSnapshot): string[] {
  if (order.unit_ids.length) {
    return order.unit_ids.map((unitId) => resolveBattleUnitId(unitId, snapshot)).filter((unitId): unitId is string => Boolean(unitId))
  }
  const unitId = resolveBattleUnitId(order.unit_id, snapshot)
  return unitId ? [unitId] : []
}

function singleUnitMatches(order: BattleOrder, legalUnitId: string, snapshot: GameSnapshot): boolean {
  return resolveBattleUnitId(order.unit_id, snapshot) === legalUnitId
}

function targetMatches(order: BattleOrder, legalTargetId: string, snapshot: GameSnapshot): boolean {
  return resolveBattleUnitId(order.target_id, snapshot) === legalTargetId
}

function groupUnitsMatch(order: BattleOrder, legalUnitIds: string[], snapshot: GameSnapshot): boolean {
  const unitIds = battleOrderUnitIds(order, snapshot)
  return unitIds.length > 0 && unitIds.length === legalUnitIds.length && unitIds.every((unitId, index) => unitId === legalUnitIds[index])
}

function groupMoveStepsMatch(orderSteps: BattleOrderStep[], legalSteps: Array<{ unit_id: string; destination: { x: number; y: number }; facing: Direction }>, snapshot: GameSnapshot): boolean {
  if (!orderSteps.length) {
    return true
  }
  return (
    orderSteps.length === legalSteps.length &&
    orderSteps.every((step, index) => {
      const legalStep = legalSteps[index]
      return (
        resolveBattleUnitId(step.unit_id, snapshot) === legalStep.unit_id &&
        stepDestinationMatches(step, legalStep.destination, snapshot) &&
        stepFacingMatches(step, legalStep.facing, snapshot)
      )
    })
  )
}

function groupChargeStepsMatch(orderSteps: BattleOrderStep[], legalSteps: Array<{ unit_id: string; target_id: string; destination: { x: number; y: number }; facing: Direction }>, snapshot: GameSnapshot): boolean {
  if (!orderSteps.length) {
    return true
  }
  return (
    orderSteps.length === legalSteps.length &&
    orderSteps.every((step, index) => {
      const legalStep = legalSteps[index]
      return (
        resolveBattleUnitId(step.unit_id, snapshot) === legalStep.unit_id &&
        resolveBattleUnitId(step.target_id, snapshot) === legalStep.target_id &&
        stepDestinationMatches(step, legalStep.destination, snapshot) &&
        stepFacingMatches(step, legalStep.facing, snapshot)
      )
    })
  )
}

function destinationMatches(order: BattleOrder, destination: { x: number; y: number }, snapshot: GameSnapshot): boolean {
  const coord = resolveBattleCoord(order.x, order.y, snapshot)
  return Boolean(coord && coord.x === destination.x && coord.y === destination.y)
}

function facingMatches(order: BattleOrder, facing: Direction, snapshot: GameSnapshot): boolean {
  return resolveBattleDirection(order.facing, snapshot) === facing
}

function stepDestinationMatches(step: BattleOrderStep, destination: { x: number; y: number }, snapshot: GameSnapshot): boolean {
  const coord = resolveBattleCoord(step.x, step.y, snapshot)
  return Boolean(coord && coord.x === destination.x && coord.y === destination.y)
}

function stepFacingMatches(step: BattleOrderStep, facing: Direction, snapshot: GameSnapshot): boolean {
  return resolveBattleDirection(step.facing, snapshot) === facing
}

function resolveBattleUnitId(unitId: string | null, snapshot: GameSnapshot): string | null {
  const normalized = unitId?.trim()
  if (!normalized) {
    return null
  }
  const army = snapshot.state.current_player
  const enemy = army === 'A' ? 'B' : 'A'
  if (normalized.startsWith('SELF-')) {
    return `${army}-${normalized.slice('SELF-'.length)}`
  }
  if (normalized.startsWith('ENEMY-')) {
    return `${enemy}-${normalized.slice('ENEMY-'.length)}`
  }
  return normalized
}

function resolveBattleCoord(x: number | null, y: number | null, snapshot: GameSnapshot): { x: number; y: number } | null {
  if (x === null || y === null) {
    return null
  }
  if (snapshot.state.current_player === 'B') {
    return {
      x: snapshot.state.board_width - 1 - x,
      y: snapshot.state.board_height - 1 - y,
    }
  }
  return { x, y }
}

function resolveBattleDirection(facing: string | null, snapshot: GameSnapshot): Direction | null {
  const normalized = facing?.trim().toUpperCase()
  if (normalized !== 'N' && normalized !== 'E' && normalized !== 'S' && normalized !== 'W') {
    return null
  }
  if (snapshot.state.current_player === 'A') {
    return normalized
  }
  return {
    N: 'S',
    S: 'N',
    E: 'W',
    W: 'E',
  }[normalized] as Direction
}

function orderedUnitIds(legalAction: LegalAction): string[] {
  switch (legalAction.type) {
    case 'group_move':
    case 'group_march_move':
    case 'group_charge':
      return legalAction.unit_ids
    case 'move':
    case 'march_move':
    case 'charge':
    case 'rotate':
    case 'shoot':
    case 'rally':
    case 'reform_pike':
    case 'deploy':
      return [legalAction.unit_id]
    default:
      return []
  }
}

function normalizeIntentUpdate(rawIntent: string): string | null {
  const normalized = rawIntent.split(/\s+/).join(' ').trim().slice(0, 220)
  return normalized || null
}

function extractOpenAiOutputText(response: JsonRecord): string {
  const outputText = readString(response.output_text)
  if (outputText) {
    return outputText
  }

  const output = response.output
  if (!Array.isArray(output)) {
    return ''
  }

  const fragments: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }
    const content = (item as JsonRecord).content
    if (!Array.isArray(content)) {
      continue
    }
    for (const part of content) {
      if (!part || typeof part !== 'object' || Array.isArray(part)) {
        continue
      }
      const type = readString((part as JsonRecord).type)
      if (type !== 'output_text' && type !== 'text') {
        continue
      }
      const text = readString((part as JsonRecord).text)
      if (text) {
        fragments.push(text)
      }
    }
  }
  return fragments.join('')
}

function extractAnthropicToolInput(response: JsonRecord, toolName: string): JsonRecord | null {
  const content = response.content
  if (!Array.isArray(content)) {
    return null
  }

  for (const part of content) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) {
      continue
    }
    const partRecord = part as JsonRecord
    if (readString(partRecord.type) !== 'tool_use') {
      continue
    }
    if (readString(partRecord.name) !== toolName) {
      continue
    }
    const input = partRecord.input
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      return input as JsonRecord
    }
  }
  return null
}

function extractAnthropicText(response: JsonRecord): string {
  const content = response.content
  if (!Array.isArray(content)) {
    return ''
  }

  const fragments: string[] = []
  for (const part of content) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) {
      continue
    }
    const partRecord = part as JsonRecord
    if (readString(partRecord.type) !== 'text') {
      continue
    }
    const text = readString(partRecord.text)
    if (text) {
      fragments.push(text)
    }
  }
  return fragments.join('')
}

function extractChatCompletionToolInput(response: JsonRecord, toolName: string): JsonRecord | null {
  const choices = response.choices
  if (!Array.isArray(choices) || !choices.length) {
    return null
  }
  const firstChoice = choices[0]
  if (!firstChoice || typeof firstChoice !== 'object' || Array.isArray(firstChoice)) {
    return null
  }
  const message = (firstChoice as JsonRecord).message
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return null
  }
  const toolCalls = (message as JsonRecord).tool_calls
  if (!Array.isArray(toolCalls)) {
    return null
  }
  for (const toolCall of toolCalls) {
    if (!toolCall || typeof toolCall !== 'object' || Array.isArray(toolCall)) {
      continue
    }
    const functionPayload = (toolCall as JsonRecord).function
    if (!functionPayload || typeof functionPayload !== 'object' || Array.isArray(functionPayload)) {
      continue
    }
    if (readString((functionPayload as JsonRecord).name) !== toolName) {
      continue
    }
    const argumentsPayload = (functionPayload as JsonRecord).arguments
    if (argumentsPayload && typeof argumentsPayload === 'object' && !Array.isArray(argumentsPayload)) {
      return argumentsPayload as JsonRecord
    }
    if (typeof argumentsPayload === 'string') {
      try {
        const parsed = JSON.parse(argumentsPayload) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as JsonRecord
        }
      } catch {
        return null
      }
    }
  }
  return null
}

function extractChatCompletionText(response: JsonRecord): string {
  const choices = response.choices
  if (!Array.isArray(choices) || !choices.length) {
    return ''
  }
  const firstChoice = choices[0]
  if (!firstChoice || typeof firstChoice !== 'object' || Array.isArray(firstChoice)) {
    return ''
  }
  const message = (firstChoice as JsonRecord).message
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return ''
  }
  const content = (message as JsonRecord).content
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  const fragments: string[] = []
  for (const part of content) {
    if (typeof part === 'string') {
      fragments.push(part)
      continue
    }
    if (!part || typeof part !== 'object' || Array.isArray(part)) {
      continue
    }
    const text = readString((part as JsonRecord).text)
    if (text) {
      fragments.push(text)
    }
  }
  return fragments.join('')
}

function extractOpenAiUsage(response: JsonRecord): AiUsage | null {
  const usage = response.usage
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    return null
  }
  const usageRecord = usage as JsonRecord
  const inputTokens = toInteger(usageRecord.input_tokens)
  const outputTokens = toInteger(usageRecord.output_tokens)
  const totalTokens =
    toInteger(usageRecord.total_tokens) ??
    (inputTokens !== null || outputTokens !== null ? (inputTokens ?? 0) + (outputTokens ?? 0) : null)
  const inputDetails = usageRecord.input_tokens_details
  const outputDetails = usageRecord.output_tokens_details
  const cachedInputTokens =
    inputDetails && typeof inputDetails === 'object' && !Array.isArray(inputDetails)
      ? toInteger((inputDetails as JsonRecord).cached_tokens)
      : null
  const reasoningTokens =
    outputDetails && typeof outputDetails === 'object' && !Array.isArray(outputDetails)
      ? toInteger((outputDetails as JsonRecord).reasoning_tokens)
      : null

  if (
    inputTokens === null &&
    outputTokens === null &&
    totalTokens === null &&
    cachedInputTokens === null &&
    reasoningTokens === null
  ) {
    return null
  }

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    cached_input_tokens: cachedInputTokens,
    reasoning_tokens: reasoningTokens,
    input_cost_usd: null,
    output_cost_usd: null,
    total_cost_usd: null,
    pricing_model: null,
    estimated: true,
  }
}

function extractAnthropicUsage(response: JsonRecord): AiUsage | null {
  const usage = response.usage
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    return null
  }
  const usageRecord = usage as JsonRecord
  const requestInputTokens = toInteger(usageRecord.input_tokens)
  const cacheCreationInputTokens = toInteger(usageRecord.cache_creation_input_tokens)
  const cacheReadInputTokens = toInteger(usageRecord.cache_read_input_tokens)
  const outputTokens = toInteger(usageRecord.output_tokens)

  const inputParts = [requestInputTokens, cacheCreationInputTokens, cacheReadInputTokens].filter(
    (value): value is number => value !== null,
  )
  const inputTokens = inputParts.length ? inputParts.reduce((total, value) => total + value, 0) : null
  const totalTokens =
    inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null

  if (inputTokens === null && outputTokens === null) {
    return null
  }

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    cached_input_tokens: cacheReadInputTokens,
    reasoning_tokens: null,
    input_cost_usd: null,
    output_cost_usd: null,
    total_cost_usd: null,
    pricing_model: null,
    estimated: true,
  }
}

function extractChatCompletionUsage(response: JsonRecord): AiUsage | null {
  const usage = response.usage
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    return null
  }
  const usageRecord = usage as JsonRecord
  const inputTokens = toInteger(usageRecord.prompt_tokens)
  const outputTokens = toInteger(usageRecord.completion_tokens)
  const totalTokens =
    toInteger(usageRecord.total_tokens) ??
    (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null)
  const promptDetails = usageRecord.prompt_tokens_details
  const cachedInputTokens =
    promptDetails && typeof promptDetails === 'object' && !Array.isArray(promptDetails)
      ? toInteger((promptDetails as JsonRecord).cached_tokens)
      : null

  if (
    inputTokens === null &&
    outputTokens === null &&
    totalTokens === null &&
    cachedInputTokens === null
  ) {
    return null
  }

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    cached_input_tokens: cachedInputTokens,
    reasoning_tokens: null,
    input_cost_usd: null,
    output_cost_usd: null,
    total_cost_usd: null,
    pricing_model: null,
    estimated: true,
  }
}

function toInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    return Number.isInteger(parsed) ? parsed : null
  }
  return null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

async function resolveActionSummary(action: LegalAction): Promise<string> {
  try {
    return await describeWasmLegalAction(action)
  } catch {
    return 'a legal action'
  }
}

function mergeUsages(usages: Array<AiUsage | null>): AiUsage | null {
  const present = usages.filter((usage): usage is AiUsage => usage !== null)
  if (!present.length) {
    return null
  }
  return {
    input_tokens: sumNumbers(present.map((usage) => usage.input_tokens)),
    output_tokens: sumNumbers(present.map((usage) => usage.output_tokens)),
    total_tokens: sumNumbers(present.map((usage) => usage.total_tokens)),
    cached_input_tokens: sumNumbers(present.map((usage) => usage.cached_input_tokens)),
    reasoning_tokens: sumNumbers(present.map((usage) => usage.reasoning_tokens)),
    input_cost_usd: sumNumbers(present.map((usage) => usage.input_cost_usd)),
    output_cost_usd: sumNumbers(present.map((usage) => usage.output_cost_usd)),
    total_cost_usd: sumNumbers(present.map((usage) => usage.total_cost_usd)),
    pricing_model: present[present.length - 1]?.pricing_model ?? null,
    estimated: present.every((usage) => usage.estimated),
  }
}

function sumNumbers(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => typeof value === 'number')
  return present.length ? present.reduce((total, value) => total + value, 0) : null
}

export async function resolveBrowserAiAction(
  legalActions: LegalAction[],
  selection: BrowserAiSelection,
): Promise<Action> {
  const action = legalActions[selection.actionIndex]
  if (!action) {
    throw new Error(`Browser AI selected invalid action index ${selection.actionIndex}.`)
  }
  try {
    return await materializeWasmLegalAction(action)
  } catch {
    return materializeAction(action)
  }
}
