import type { AiTurnResponse, AiUsage, ArmyId } from './types'

export const BROWSER_AI_KEY_STORAGE_KEY = 'phalanx.browser-ai-api-key'
export const BROWSER_AI_MODEL_STORAGE_KEY = 'phalanx.browser-ai-model'
export const BROWSER_AI_PROVIDER_STORAGE_KEY = 'phalanx.browser-ai-provider'
export const BROWSER_AI_BASE_URL_STORAGE_KEY = 'phalanx.browser-ai-base-url'
export const BROWSER_AI_ACCESS_MODE_STORAGE_KEY = 'phalanx.browser-ai-access-mode'
export const DEFAULT_BROWSER_AI_MODEL = 'gpt-5.4-mini'
export const DEFAULT_BROWSER_AI_PROVIDER = 'openai'
export const STRATEGOS_1_MODEL_ID = 'strategos-1'
export const STRATEGOS_2_MODEL_ID = 'strategos-2'
export const DEFAULT_BROWSER_AI_ACCESS_MODE: BrowserAiAccessMode = STRATEGOS_1_MODEL_ID
export const LOCAL_AI_MODEL_ID = STRATEGOS_1_MODEL_ID

export type LocalAiModelId = typeof STRATEGOS_1_MODEL_ID | typeof STRATEGOS_2_MODEL_ID
export type BrowserAiAccessMode = 'bring_your_own_key' | LocalAiModelId

export type AiTurnUsageTotals = {
  turnCount: number
  trackedTurns: number
  pricedTurns: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
  reasoningTokens: number
  totalCostUsd: number | null
}

export type AiTurnRecord = AiTurnResponse & {
  actingArmy: ArmyId
  messageId: string
}

export type AiLiveDecision = {
  actingArmy: ArmyId
  actionSummary: string
  confidence: number
  intent_update: string | null
  messageId: string
  model: string
  reasoning: string
}

export function readStoredBrowserAiModel(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  return window.sessionStorage.getItem(BROWSER_AI_MODEL_STORAGE_KEY) ?? ''
}

export function readStoredBrowserAiKey(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  return window.sessionStorage.getItem(BROWSER_AI_KEY_STORAGE_KEY) ?? ''
}

export function readStoredBrowserAiProvider(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_BROWSER_AI_PROVIDER
  }

  return window.sessionStorage.getItem(BROWSER_AI_PROVIDER_STORAGE_KEY) ?? DEFAULT_BROWSER_AI_PROVIDER
}

export function readStoredBrowserAiBaseUrl(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  return window.sessionStorage.getItem(BROWSER_AI_BASE_URL_STORAGE_KEY) ?? ''
}

export function readStoredBrowserAiAccessMode(): BrowserAiAccessMode {
  if (typeof window === 'undefined') {
    return DEFAULT_BROWSER_AI_ACCESS_MODE
  }

  const stored = window.sessionStorage.getItem(BROWSER_AI_ACCESS_MODE_STORAGE_KEY)
  if (isLocalAiAccessMode(stored)) {
    return stored
  }
  if (stored === 'local_simple_ai') {
    return DEFAULT_BROWSER_AI_ACCESS_MODE
  }
  if (stored === 'hosted_gpt_oss') {
    return DEFAULT_BROWSER_AI_ACCESS_MODE
  }
  if (stored === 'bring_your_own_key') {
    const hasBringYourOwnKeySetup =
      Boolean(window.sessionStorage.getItem(BROWSER_AI_KEY_STORAGE_KEY)?.trim()) ||
      Boolean(window.sessionStorage.getItem(BROWSER_AI_MODEL_STORAGE_KEY)?.trim()) ||
      Boolean(window.sessionStorage.getItem(BROWSER_AI_BASE_URL_STORAGE_KEY)?.trim())

    return hasBringYourOwnKeySetup ? 'bring_your_own_key' : DEFAULT_BROWSER_AI_ACCESS_MODE
  }
  return DEFAULT_BROWSER_AI_ACCESS_MODE
}

export function isLocalAiAccessMode(value: string | null | undefined): value is LocalAiModelId {
  return value === STRATEGOS_1_MODEL_ID || value === STRATEGOS_2_MODEL_ID
}

export function getUsageTotalTokens(usage: AiUsage | null | undefined): number | null {
  if (!usage) {
    return null
  }
  if (typeof usage.total_tokens === 'number') {
    return usage.total_tokens
  }
  if (typeof usage.input_tokens === 'number' || typeof usage.output_tokens === 'number') {
    return (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
  }
  return null
}

export function summarizeAiTurnHistory(turns: AiTurnResponse[]): AiTurnUsageTotals {
  let trackedTurns = 0
  let pricedTurns = 0
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let cachedInputTokens = 0
  let reasoningTokens = 0
  let totalCostUsd = 0

  for (const turn of turns) {
    const usage = turn.usage
    if (!usage) {
      continue
    }

    const totalTurnTokens = getUsageTotalTokens(usage)
    const hasTrackedUsage =
      totalTurnTokens !== null ||
      typeof usage.cached_input_tokens === 'number' ||
      typeof usage.reasoning_tokens === 'number'

    if (hasTrackedUsage) {
      trackedTurns += 1
    }
    if (typeof usage.input_tokens === 'number') {
      inputTokens += usage.input_tokens
    }
    if (typeof usage.output_tokens === 'number') {
      outputTokens += usage.output_tokens
    }
    if (typeof totalTurnTokens === 'number') {
      totalTokens += totalTurnTokens
    }
    if (typeof usage.cached_input_tokens === 'number') {
      cachedInputTokens += usage.cached_input_tokens
    }
    if (typeof usage.reasoning_tokens === 'number') {
      reasoningTokens += usage.reasoning_tokens
    }
    if (typeof usage.total_cost_usd === 'number') {
      pricedTurns += 1
      totalCostUsd += usage.total_cost_usd
    }
  }

  return {
    turnCount: turns.length,
    trackedTurns,
    pricedTurns,
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    reasoningTokens,
    totalCostUsd: pricedTurns ? totalCostUsd : null,
  }
}
