import providerCatalog from '../../shared/aiProviderCatalog.json'

export type BrowserAiProviderName =
  | 'openai'
  | 'anthropic'
  | 'xai'
  | 'mistral'
  | 'gemini'
  | 'together'
  | 'openrouter'

type ProviderEntry = {
  apiKeyPlaceholder: string
  browserBaseUrl: string
  label: string
  modelPlaceholder: string
  name: BrowserAiProviderName
}

type ModelProviderRule = {
  contains?: string
  prefixes?: string[]
  provider: BrowserAiProviderName
}

type ProviderCatalog = {
  modelProviderRules: ModelProviderRule[]
  providers: ProviderEntry[]
}

const AI_PROVIDER_CATALOG = providerCatalog as ProviderCatalog
const PROVIDER_ENTRIES = AI_PROVIDER_CATALOG.providers
const PROVIDER_ENTRY_BY_NAME = new Map<BrowserAiProviderName, ProviderEntry>(
  PROVIDER_ENTRIES.map((provider) => [provider.name, provider]),
)

export const SUPPORTED_BROWSER_AI_PROVIDERS = PROVIDER_ENTRIES.map((provider) => provider.name)

function isBrowserAiProviderName(value: string): value is BrowserAiProviderName {
  return PROVIDER_ENTRY_BY_NAME.has(value as BrowserAiProviderName)
}

function providerEntry(provider: BrowserAiProviderName): ProviderEntry {
  const entry = PROVIDER_ENTRY_BY_NAME.get(provider)
  if (!entry) {
    throw new Error(`Unsupported browser AI provider ${provider}.`)
  }
  return entry
}

export function inferBrowserAiProvider(model: string): BrowserAiProviderName {
  const normalizedModel = model.trim().toLowerCase()
  for (const rule of AI_PROVIDER_CATALOG.modelProviderRules) {
    if (rule.prefixes?.some((prefix) => normalizedModel.startsWith(prefix))) {
      return rule.provider
    }
    if (rule.contains && normalizedModel.includes(rule.contains)) {
      return rule.provider
    }
  }
  return 'openai'
}

export function resolveBrowserAiProviderName(provider: string | null | undefined, model = ''): BrowserAiProviderName {
  const normalizedProvider = (provider || 'auto').trim().toLowerCase()
  if (normalizedProvider === 'auto') {
    return model.trim() ? inferBrowserAiProvider(model) : 'openai'
  }
  if (isBrowserAiProviderName(normalizedProvider)) {
    return normalizedProvider
  }
  throw new Error(`Unsupported browser AI provider ${provider ?? ''}.`)
}

export function providerDisplayName(provider: BrowserAiProviderName): string {
  return providerEntry(provider).label
}

export function resolveBrowserAiBaseUrl(provider: BrowserAiProviderName, override: string): string {
  const trimmedOverride = override.trim()
  return trimmedOverride || providerEntry(provider).browserBaseUrl
}

export function browserAiModelPlaceholder(provider: BrowserAiProviderName): string {
  return providerEntry(provider).modelPlaceholder
}

export function browserAiApiKeyPlaceholder(provider: BrowserAiProviderName): string {
  return providerEntry(provider).apiKeyPlaceholder
}

export function resolveBrowserReasoningText(
  rawReasoning: string,
  provider: BrowserAiProviderName,
  actionSummary: string,
): string {
  const reasoning = rawReasoning.trim()
  if (reasoning) {
    return reasoning
  }
  return `${providerDisplayName(provider)} selected ${actionSummary}; the provider did not supply reasoning.`
}

export function resolveBrowserVisualObservationsText(
  rawText: string,
  provider: BrowserAiProviderName,
): string {
  const visualObservations = rawText.trim()
  if (visualObservations) {
    return visualObservations
  }
  return `${providerDisplayName(provider)} did not return separate visual observations for this text-only turn.`
}

export function isGemini25Model(model: string): boolean {
  return model.trim().toLowerCase().startsWith('gemini-2.5')
}

export function isGemini3Model(model: string): boolean {
  return model.trim().toLowerCase().startsWith('gemini-3')
}
