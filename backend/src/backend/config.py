from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ModelPricing:
    input_usd_per_1m: float
    cached_input_usd_per_1m: float | None
    output_usd_per_1m: float


MODEL_PRICING_OVERRIDES_ENV = "PHALANX_AI_MODEL_PRICING_JSON"

# Fallback estimates only. Runtime overrides from MODEL_PRICING_OVERRIDES_ENV
# replace these entries by normalized model name. Unknown models remain unpriced
# so usage reports can distinguish known token usage from unknown cost.
DEFAULT_MODEL_PRICING: dict[str, ModelPricing] = {
    "gpt-5.4": ModelPricing(input_usd_per_1m=2.5, cached_input_usd_per_1m=0.25, output_usd_per_1m=15.0),
    "gpt-5.4-mini": ModelPricing(input_usd_per_1m=0.75, cached_input_usd_per_1m=0.075, output_usd_per_1m=4.5),
    "gpt-5.4-nano": ModelPricing(input_usd_per_1m=0.2, cached_input_usd_per_1m=0.02, output_usd_per_1m=1.25),
    "anthropic/claude-opus-4.7": ModelPricing(
        input_usd_per_1m=5.0,
        cached_input_usd_per_1m=0.5,
        output_usd_per_1m=25.0,
    ),
    "deepseek/deepseek-v4-pro": ModelPricing(
        input_usd_per_1m=0.435,
        cached_input_usd_per_1m=0.003625,
        output_usd_per_1m=0.87,
    ),
    "google/gemini-3.1-pro-preview": ModelPricing(
        input_usd_per_1m=2.0,
        cached_input_usd_per_1m=0.2,
        output_usd_per_1m=12.0,
    ),
    "moonshotai/kimi-k2.6": ModelPricing(
        input_usd_per_1m=0.7448,
        cached_input_usd_per_1m=0.1463,
        output_usd_per_1m=4.655,
    ),
    "mistralai/mistral-large-2512": ModelPricing(
        input_usd_per_1m=0.5,
        cached_input_usd_per_1m=0.05,
        output_usd_per_1m=1.5,
    ),
    "mistralai/mistral-small-2603": ModelPricing(
        input_usd_per_1m=0.15,
        cached_input_usd_per_1m=0.015,
        output_usd_per_1m=0.6,
    ),
    "openai/gpt-5.4-mini": ModelPricing(
        input_usd_per_1m=0.75,
        cached_input_usd_per_1m=0.075,
        output_usd_per_1m=4.5,
    ),
    "openai/gpt-5.5": ModelPricing(input_usd_per_1m=5.0, cached_input_usd_per_1m=0.5, output_usd_per_1m=30.0),
    "x-ai/grok-4.20": ModelPricing(input_usd_per_1m=2.0, cached_input_usd_per_1m=0.2, output_usd_per_1m=6.0),
    "gpt-5": ModelPricing(input_usd_per_1m=1.25, cached_input_usd_per_1m=0.125, output_usd_per_1m=10.0),
    "gpt-5.1": ModelPricing(input_usd_per_1m=1.25, cached_input_usd_per_1m=0.125, output_usd_per_1m=10.0),
    "gpt-5-mini": ModelPricing(input_usd_per_1m=0.25, cached_input_usd_per_1m=0.025, output_usd_per_1m=2.0),
    "gpt-5-nano": ModelPricing(input_usd_per_1m=0.05, cached_input_usd_per_1m=0.005, output_usd_per_1m=0.4),
    "gpt-5.1-codex-mini": ModelPricing(input_usd_per_1m=0.25, cached_input_usd_per_1m=0.025, output_usd_per_1m=2.0),
    "claude-opus-4-6": ModelPricing(input_usd_per_1m=5.0, cached_input_usd_per_1m=None, output_usd_per_1m=25.0),
    "claude-opus-4-1": ModelPricing(input_usd_per_1m=15.0, cached_input_usd_per_1m=None, output_usd_per_1m=75.0),
    "claude-opus-4-1-20250805": ModelPricing(
        input_usd_per_1m=15.0,
        cached_input_usd_per_1m=None,
        output_usd_per_1m=75.0,
    ),
    "claude-opus-4-20250514": ModelPricing(input_usd_per_1m=15.0, cached_input_usd_per_1m=None, output_usd_per_1m=75.0),
}
