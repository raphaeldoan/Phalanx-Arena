from __future__ import annotations

import copy
import json
import os
from urllib import request as urllib_request

from ..ai_system_prompt import system_prompt_for_turn
from ..models import Action, AiTurnRequest, GameSnapshot
from ..prompting_adapter import build_action_catalog, build_user_prompt
from ..ai_common import (
    ACTION_CHOICE_TOOL_NAME,
    AiConfigurationError,
    AiDecision,
    AiDecisionError,
    STRICT_BENCHMARK_MAX_DECISION_ATTEMPTS,
    append_repair_instruction_to_content,
    apply_deployment_batch_response_settings,
    apply_strict_benchmark_chat_settings,
    battle_order_max_items_for_snapshot,
    build_json_request_headers,
    build_action_choice_schema,
    build_action_choice_tool_description,
    build_return_tool_call_instruction,
    decision_from_model_choice,
    extract_anthropic_usage_metrics,
    is_strict_benchmark_profile,
    load_model_pricing_overrides,
    merge_usage_values,
    normalize_benchmark_profile,
    parse_anthropic_choice,
    post_json_request,
    resolve_action_choice_response_fields,
)


class AnthropicAiCommander:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
        timeout_seconds: float | None = None,
        api_version: str | None = None,
        benchmark_profile: str | None = None,
    ) -> None:
        self._api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        self._model = model or os.environ.get("PHALANX_AI_MODEL", "claude-opus-4-6")
        self._base_url = (base_url or os.environ.get("ANTHROPIC_BASE_URL") or "https://api.anthropic.com/v1").rstrip(
            "/"
        )
        self._timeout_seconds = timeout_seconds or float(os.environ.get("PHALANX_AI_TIMEOUT_SECONDS", "45"))
        self._api_version = api_version or os.environ.get("ANTHROPIC_API_VERSION", "2023-06-01")
        self._pricing_override_payload = os.environ.get("PHALANX_AI_MODEL_PRICING_JSON")
        self._benchmark_profile = normalize_benchmark_profile(benchmark_profile)

    def choose_action(
        self,
        snapshot: GameSnapshot,
        request: AiTurnRequest,
        action_history: list[Action] | None = None,
    ) -> AiDecision:
        if not self._api_key:
            raise AiConfigurationError("ANTHROPIC_API_KEY is not set.")

        legal_actions = snapshot.legal_actions
        if not legal_actions:
            raise AiDecisionError("No legal actions are available for the active player.")

        action_catalog = build_action_catalog(legal_actions)
        response_fields = resolve_action_choice_response_fields(request, benchmark_profile=self._benchmark_profile)
        prompt_text = build_user_prompt(
            snapshot,
            request,
            action_catalog,
            action_history,
            prompt_profile=self._benchmark_profile,
        )

        payload: dict[str, object] = {
            "model": self._model,
            "system": (
                f"{system_prompt_for_turn(request, benchmark_profile=self._benchmark_profile)}\n"
                f"{build_return_tool_call_instruction(response_fields=response_fields)}"
            ),
            "max_tokens": 400,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": prompt_text,
                        }
                    ],
                }
            ],
            "tools": [
                {
                    "name": ACTION_CHOICE_TOOL_NAME,
                    "description": build_action_choice_tool_description(response_fields=response_fields),
                    "input_schema": build_action_choice_schema(
                        len(action_catalog) - 1,
                        response_fields=response_fields,
                        deployment_batch=request.deployment_batch,
                        battle_batch=request.battle_batch,
                        board_width=snapshot.state.board_width,
                        board_height=snapshot.state.board_height,
                        battle_order_max_items=battle_order_max_items_for_snapshot(snapshot),
                    ),
                }
            ],
            "tool_choice": {
                "type": "tool",
                "name": ACTION_CHOICE_TOOL_NAME,
            },
        }
        apply_strict_benchmark_chat_settings(
            payload,
            benchmark_profile=self._benchmark_profile,
            provider_name="anthropic",
            model=self._model,
        )
        apply_deployment_batch_response_settings(payload, request)

        strict_profile = is_strict_benchmark_profile(self._benchmark_profile)
        max_attempts = STRICT_BENCHMARK_MAX_DECISION_ATTEMPTS if strict_profile else 1
        usage_records = []
        first_error: AiDecisionError | None = None
        last_error: AiDecisionError | None = None
        for attempt_index in range(max_attempts):
            attempt_payload = payload if attempt_index == 0 else self._repair_payload(payload)
            try:
                response_payload = self._post_message(attempt_payload)
                usage_records.append(
                    extract_anthropic_usage_metrics(
                        response_payload,
                        model=str(response_payload.get("model") or self._model),
                        pricing_overrides=load_model_pricing_overrides(self._pricing_override_payload),
                    )
                )
                choice = parse_anthropic_choice(response_payload)
                response_model = str(response_payload.get("model") or self._model)
                return decision_from_model_choice(
                    choice,
                    snapshot=snapshot,
                    legal_actions=legal_actions,
                    request=request,
                    provider_name="anthropic",
                    response_model=response_model,
                    usage=merge_usage_values(usage_records),
                )
            except AiDecisionError as error:
                if first_error is None:
                    first_error = error
                last_error = error
                if not strict_profile or attempt_index == max_attempts - 1:
                    if first_error is not error:
                        raise error from first_error
                    raise

        raise last_error or AiDecisionError("Anthropic did not return a usable decision.")

    def _repair_payload(self, payload: dict[str, object]) -> dict[str, object]:
        repair_payload = copy.deepcopy(payload)
        messages = repair_payload.get("messages")
        if isinstance(messages, list) and messages:
            first_message = messages[0]
            if isinstance(first_message, dict):
                first_message["content"] = append_repair_instruction_to_content(first_message.get("content"))
        return repair_payload

    def _post_message(self, payload: dict[str, object]) -> dict[str, object]:
        body = json.dumps(payload).encode("utf-8")
        request = urllib_request.Request(
            url=f"{self._base_url}/messages",
            data=body,
            headers=build_json_request_headers(
                {
                    "x-api-key": self._api_key,
                    "anthropic-version": self._api_version,
                }
            ),
            method="POST",
        )
        return post_json_request(request=request, timeout_seconds=self._timeout_seconds, provider_name="anthropic")
