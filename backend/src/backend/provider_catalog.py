from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


ProviderCatalog = dict[str, Any]
ProviderEntry = dict[str, Any]


def _catalog_candidates() -> list[Path]:
    package_catalog = Path(__file__).with_name("aiProviderCatalog.json")
    repo_catalog = Path(__file__).resolve().parents[3] / "shared" / "aiProviderCatalog.json"
    return [package_catalog, repo_catalog]


@lru_cache(maxsize=1)
def load_provider_catalog() -> ProviderCatalog:
    for candidate in _catalog_candidates():
        if not candidate.is_file():
            continue
        with candidate.open(encoding="utf-8") as handle:
            payload = json.load(handle)
        if isinstance(payload, dict):
            return payload
    searched = ", ".join(str(candidate) for candidate in _catalog_candidates())
    raise FileNotFoundError(f"Unable to find AI provider catalog. Searched: {searched}")


def provider_entries() -> list[ProviderEntry]:
    providers = load_provider_catalog().get("providers", [])
    if not isinstance(providers, list):
        return []
    return [provider for provider in providers if isinstance(provider, dict)]


def provider_entry(provider_name: str) -> ProviderEntry:
    for provider in provider_entries():
        if provider.get("name") == provider_name:
            return provider
    raise KeyError(provider_name)


SUPPORTED_PROVIDER_NAMES = frozenset(
    provider["name"] for provider in provider_entries() if isinstance(provider.get("name"), str)
)


def provider_display_name(provider_name: str) -> str:
    try:
        label = provider_entry(provider_name).get("label")
    except KeyError:
        return provider_name
    return label if isinstance(label, str) and label else provider_name


def infer_provider(model: str) -> str:
    normalized_model = model.strip().lower()
    rules = load_provider_catalog().get("modelProviderRules", [])
    if not isinstance(rules, list):
        return "openai"

    for rule in rules:
        if not isinstance(rule, dict):
            continue
        provider = rule.get("provider")
        if not isinstance(provider, str):
            continue

        prefixes = rule.get("prefixes")
        if isinstance(prefixes, list):
            for prefix in prefixes:
                if isinstance(prefix, str) and normalized_model.startswith(prefix):
                    return provider

        contains = rule.get("contains")
        if isinstance(contains, str) and contains and contains in normalized_model:
            return provider

    return "openai"


def resolve_provider_api_key_env(provider_name: str, override: str | None = None) -> str:
    if override:
        return override
    api_key_env = provider_entry(provider_name).get("apiKeyEnv")
    if not isinstance(api_key_env, str) or not api_key_env:
        raise KeyError(provider_name)
    return api_key_env


def resolve_provider_base_url(provider_name: str, override: str | None = None) -> str | None:
    if override:
        return override
    base_url = provider_entry(provider_name).get("serverBaseUrl")
    return base_url if isinstance(base_url, str) and base_url else None
