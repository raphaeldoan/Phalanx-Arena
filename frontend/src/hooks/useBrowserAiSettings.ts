import { useMemo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import {
  BROWSER_AI_ACCESS_MODE_STORAGE_KEY,
  BROWSER_AI_BASE_URL_STORAGE_KEY,
  BROWSER_AI_KEY_STORAGE_KEY,
  BROWSER_AI_MODEL_STORAGE_KEY,
  BROWSER_AI_PROVIDER_STORAGE_KEY,
  DEFAULT_BROWSER_AI_MODEL,
  DEFAULT_BROWSER_AI_ACCESS_MODE,
  isLocalAiAccessMode,
  type BrowserAiAccessMode,
  readStoredBrowserAiAccessMode,
  readStoredBrowserAiBaseUrl,
  readStoredBrowserAiKey,
  readStoredBrowserAiModel,
  readStoredBrowserAiProvider,
} from '../aiSession'
import {
  resolveBrowserAiBaseUrl,
  resolveBrowserAiProviderName,
  type BrowserAiProviderName,
} from '../aiProviders'
import { useSessionStorageState } from './useSessionStorageState'

type BrowserAiSettings = {
  browserAiAccessMode: BrowserAiAccessMode
  setBrowserAiAccessMode: Dispatch<SetStateAction<BrowserAiAccessMode>>
  browserAiApiKey: string
  setBrowserAiApiKey: Dispatch<SetStateAction<string>>
  browserAiProvider: string
  setBrowserAiProvider: Dispatch<SetStateAction<string>>
  browserAiBaseUrl: string
  setBrowserAiBaseUrl: Dispatch<SetStateAction<string>>
  browserAiModel: string
  setBrowserAiModel: Dispatch<SetStateAction<string>>
  activeBrowserAiProvider: BrowserAiProviderName
  activeBrowserAiModel: string
  activeBrowserAiBaseUrl: string
  browserAiReady: boolean
}

export function useBrowserAiSettings(): BrowserAiSettings {
  const [browserAiAccessMode, setBrowserAiAccessMode] = useSessionStorageState(
    BROWSER_AI_ACCESS_MODE_STORAGE_KEY,
    readStoredBrowserAiAccessMode,
    resolveBrowserAiAccessMode,
  )
  const [browserAiApiKey, setBrowserAiApiKey] = useSessionStorageState(
    BROWSER_AI_KEY_STORAGE_KEY,
    readStoredBrowserAiKey,
  )
  const [browserAiBaseUrl, setBrowserAiBaseUrl] = useSessionStorageState(
    BROWSER_AI_BASE_URL_STORAGE_KEY,
    readStoredBrowserAiBaseUrl,
  )
  const [browserAiModel, setBrowserAiModel] = useSessionStorageState(
    BROWSER_AI_MODEL_STORAGE_KEY,
    readStoredBrowserAiModel,
  )
  const [browserAiProvider, setBrowserAiProvider] = useSessionStorageState(
    BROWSER_AI_PROVIDER_STORAGE_KEY,
    readStoredBrowserAiProvider,
    (provider) => resolveStoredBrowserAiProvider(provider, browserAiModel),
  )
  const activeBrowserAiProvider = useMemo(
    () =>
      isLocalAiAccessMode(browserAiAccessMode)
        ? 'openrouter'
        : resolveStoredBrowserAiProvider(browserAiProvider, browserAiModel),
    [browserAiAccessMode, browserAiModel, browserAiProvider],
  )
  const activeBrowserAiModel = useMemo(
    () =>
      isLocalAiAccessMode(browserAiAccessMode)
        ? browserAiAccessMode
        : browserAiModel.trim() || (activeBrowserAiProvider === 'openai' ? DEFAULT_BROWSER_AI_MODEL : ''),
    [activeBrowserAiProvider, browserAiAccessMode, browserAiModel],
  )
  const activeBrowserAiBaseUrl = useMemo(
    () => resolveBrowserAiBaseUrl(activeBrowserAiProvider, browserAiBaseUrl),
    [activeBrowserAiProvider, browserAiBaseUrl],
  )
  const browserAiReady =
    isLocalAiAccessMode(browserAiAccessMode) ||
    (browserAiApiKey.trim().length > 0 && activeBrowserAiModel.length > 0)

  return {
    browserAiAccessMode,
    setBrowserAiAccessMode,
    browserAiApiKey,
    setBrowserAiApiKey,
    browserAiProvider,
    setBrowserAiProvider,
    browserAiBaseUrl,
    setBrowserAiBaseUrl,
    browserAiModel,
    setBrowserAiModel,
    activeBrowserAiProvider,
    activeBrowserAiModel,
    activeBrowserAiBaseUrl,
    browserAiReady,
  }
}

function resolveBrowserAiAccessMode(value: string): BrowserAiAccessMode {
  if (value === 'bring_your_own_key' || isLocalAiAccessMode(value)) {
    return value
  }
  if (value === 'local_simple_ai' || value === 'hosted_gpt_oss') {
    return DEFAULT_BROWSER_AI_ACCESS_MODE
  }
  return DEFAULT_BROWSER_AI_ACCESS_MODE
}

function resolveStoredBrowserAiProvider(provider: string, model: string): BrowserAiProviderName {
  try {
    return resolveBrowserAiProviderName(provider, model)
  } catch {
    return 'openai'
  }
}
