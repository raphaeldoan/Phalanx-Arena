from __future__ import annotations

import os

from .ai_common import AiCommander, AiConfigurationError, normalize_benchmark_profile
from .ai_providers.anthropic import AnthropicAiCommander
from .ai_providers.openai import OpenAIAiCommander
from .ai_providers.openai_compatible import OpenAICompatibleChatCommander
from .provider_catalog import (
    SUPPORTED_PROVIDER_NAMES,
    infer_provider,
    resolve_provider_api_key_env,
    resolve_provider_base_url,
)


def resolve_provider_name(*, model: str | None = None, provider: str | None = None) -> str:
    normalized_provider = (provider or "auto").strip().lower()
    if normalized_provider == "auto":
        if model and model.strip():
            return infer_provider(model)
        return "openai"
    if normalized_provider in SUPPORTED_PROVIDER_NAMES:
        return normalized_provider
    raise AiConfigurationError(f"Unsupported AI provider {provider!r}.")


def build_commander(
    *,
    model: str | None = None,
    provider: str | None = None,
    api_key_env: str | None = None,
    base_url: str | None = None,
    timeout_seconds: float | None = None,
    benchmark_profile: str | None = None,
) -> AiCommander:
    provider_name = resolve_provider_name(model=model, provider=provider)
    normalized_benchmark_profile = normalize_benchmark_profile(benchmark_profile)

    if provider_name == "anthropic":
        api_key = os.environ.get(resolve_provider_api_key_env(provider_name, api_key_env))
        return AnthropicAiCommander(
            api_key=api_key,
            model=model,
            base_url=resolve_provider_base_url(provider_name, base_url),
            timeout_seconds=timeout_seconds,
            benchmark_profile=normalized_benchmark_profile,
        )

    if provider_name in {"xai", "mistral", "gemini", "together", "openrouter"}:
        api_key = os.environ.get(resolve_provider_api_key_env(provider_name, api_key_env))
        return OpenAICompatibleChatCommander(
            provider_name=provider_name,
            api_key=api_key,
            model=model,
            base_url=resolve_provider_base_url(provider_name, base_url) or "",
            timeout_seconds=timeout_seconds,
            benchmark_profile=normalized_benchmark_profile,
        )

    api_key = os.environ.get(resolve_provider_api_key_env(provider_name, api_key_env))
    return OpenAIAiCommander(
        api_key=api_key,
        model=model,
        base_url=resolve_provider_base_url(provider_name, base_url),
        timeout_seconds=timeout_seconds,
        benchmark_profile=normalized_benchmark_profile,
    )
