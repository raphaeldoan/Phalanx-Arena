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
    append_battle_exact_action_fallback_instruction_to_content,
    append_battle_exact_action_fallback_instruction_to_text,
    append_repair_instruction_to_content,
    apply_deployment_batch_response_settings,
    apply_strict_benchmark_chat_settings,
    battle_decision_needs_exact_action_fallback,
    battle_order_max_items_for_snapshot,
    build_json_request_headers,
    build_action_choice_schema,
    build_action_choice_tool_description,
    decision_from_model_choice,
    extract_chat_completion_model,
    extract_chat_completion_usage_metrics,
    extract_message_style_model,
    is_strict_benchmark_profile,
    load_model_pricing_overrides,
    merge_usage_values,
    normalize_benchmark_profile,
    parse_chat_completion_choice,
    post_json_request,
    provider_display_name,
    resolve_action_choice_response_fields,
    should_use_battle_exact_action_fallback,
)


class OpenAICompatibleChatCommander:
    def __init__(
        self,
        *,
        provider_name: str,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
        timeout_seconds: float | None = None,
        benchmark_profile: str | None = None,
    ) -> None:
        self._provider_name = provider_name
        self._api_key = api_key
        self._model = model or os.environ.get("PHALANX_AI_MODEL")
        self._base_url = (base_url or "").rstrip("/")
        self._timeout_seconds = timeout_seconds or float(os.environ.get("PHALANX_AI_TIMEOUT_SECONDS", "45"))
        self._pricing_override_payload = os.environ.get("PHALANX_AI_MODEL_PRICING_JSON")
        self._benchmark_profile = normalize_benchmark_profile(benchmark_profile)

    def choose_action(
        self,
        snapshot: GameSnapshot,
        request: AiTurnRequest,
        action_history: list[Action] | None = None,
    ) -> AiDecision:
        if not self._api_key:
            raise AiConfigurationError(f"{provider_display_name(self._provider_name)} API key is not set.")
        if not self._model:
            raise AiConfigurationError(f"No model is configured for provider {self._provider_name!r}.")
        if not self._base_url:
            raise AiConfigurationError(f"No base URL is configured for provider {self._provider_name!r}.")

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

        battle_order_max_items = battle_order_max_items_for_snapshot(snapshot)
        schema = build_action_choice_schema(
            len(action_catalog) - 1,
            response_fields=response_fields,
            deployment_batch=request.deployment_batch,
            battle_batch=request.battle_batch,
            board_width=snapshot.state.board_width,
            board_height=snapshot.state.board_height,
            battle_order_max_items=battle_order_max_items,
        )
        payload: dict[str, object] = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system_prompt_for_turn(request, benchmark_profile=self._benchmark_profile)},
                {"role": "user", "content": prompt_text},
            ],
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": ACTION_CHOICE_TOOL_NAME,
                        "description": build_action_choice_tool_description(response_fields=response_fields),
                        "parameters": schema,
                    },
                }
            ],
        }
        if self._provider_name == "mistral":
            payload["tool_choice"] = "any"
        elif self._provider_name == "gemini":
            payload["tool_choice"] = "auto"
        else:
            payload["tool_choice"] = "required"
        apply_strict_benchmark_chat_settings(
            payload,
            benchmark_profile=self._benchmark_profile,
            provider_name=self._provider_name,
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
                response_payload = self._post_chat_completion(attempt_payload)
                usage_records.append(
                    extract_chat_completion_usage_metrics(
                        response_payload,
                        model=extract_chat_completion_model(response_payload)
                        or extract_message_style_model(response_payload)
                        or self._model,
                        pricing_overrides=load_model_pricing_overrides(self._pricing_override_payload),
                    )
                )
                choice = parse_chat_completion_choice(response_payload, provider_name=self._provider_name)
                response_model = (
                    extract_chat_completion_model(response_payload)
                    or extract_message_style_model(response_payload)
                    or self._model
                )
                decision = decision_from_model_choice(
                    choice,
                    snapshot=snapshot,
                    legal_actions=legal_actions,
                    request=request,
                    provider_name=self._provider_name,
                    response_model=response_model,
                    usage=merge_usage_values(usage_records),
                )
                if (
                    should_use_battle_exact_action_fallback(request=request, model=self._model)
                    and battle_decision_needs_exact_action_fallback(choice, decision, request=request)
                ):
                    fallback_decision = self._try_battle_exact_action_fallback(
                        payload=payload,
                        maximum_index=len(action_catalog) - 1,
                        response_fields=response_fields,
                        battle_order_max_items=battle_order_max_items,
                        snapshot=snapshot,
                        legal_actions=legal_actions,
                        request=request,
                        usage_records=usage_records,
                    )
                    if fallback_decision is not None:
                        return fallback_decision
                return decision
            except AiDecisionError as error:
                if first_error is None:
                    first_error = error
                last_error = error
                if not strict_profile or attempt_index == max_attempts - 1:
                    if first_error is not error:
                        raise error from first_error
                    raise

        raise last_error or AiDecisionError(f"{provider_display_name(self._provider_name)} did not return a usable decision.")

    def _try_battle_exact_action_fallback(
        self,
        *,
        payload: dict[str, object],
        maximum_index: int,
        response_fields,
        battle_order_max_items: int,
        snapshot: GameSnapshot,
        legal_actions: list,
        request: AiTurnRequest,
        usage_records: list,
    ) -> AiDecision | None:
        fallback_payload = self._battle_exact_action_fallback_payload(
            payload,
            build_action_choice_schema(
                maximum_index,
                response_fields=response_fields,
                battle_batch=True,
                battle_batch_exact_actions=True,
                board_width=snapshot.state.board_width,
                board_height=snapshot.state.board_height,
                battle_order_max_items=battle_order_max_items,
            ),
        )
        try:
            response_payload = self._post_chat_completion(fallback_payload)
            usage_records.append(
                extract_chat_completion_usage_metrics(
                    response_payload,
                    model=extract_chat_completion_model(response_payload)
                    or extract_message_style_model(response_payload)
                    or self._model,
                    pricing_overrides=load_model_pricing_overrides(self._pricing_override_payload),
                )
            )
            choice = parse_chat_completion_choice(response_payload, provider_name=self._provider_name)
            response_model = (
                extract_chat_completion_model(response_payload)
                or extract_message_style_model(response_payload)
                or self._model
            )
            return decision_from_model_choice(
                choice,
                snapshot=snapshot,
                legal_actions=legal_actions,
                request=request,
                provider_name=self._provider_name,
                response_model=response_model,
                usage=merge_usage_values(usage_records),
            )
        except AiDecisionError:
            return None

    def _battle_exact_action_fallback_payload(
        self,
        payload: dict[str, object],
        schema: dict[str, object],
    ) -> dict[str, object]:
        fallback_payload = copy.deepcopy(payload)
        messages = fallback_payload.get("messages")
        if isinstance(messages, list) and len(messages) >= 2:
            system_message = messages[0]
            if isinstance(system_message, dict):
                system_message["content"] = append_battle_exact_action_fallback_instruction_to_text(
                    str(system_message.get("content") or "")
                )
            user_message = messages[1]
            if isinstance(user_message, dict):
                user_message["content"] = append_battle_exact_action_fallback_instruction_to_content(
                    user_message.get("content")
                )
        tools = fallback_payload.get("tools")
        if isinstance(tools, list) and tools:
            tool = tools[0]
            if isinstance(tool, dict):
                function_payload = tool.get("function")
                if isinstance(function_payload, dict):
                    function_payload["parameters"] = schema
        return fallback_payload

    def _repair_payload(self, payload: dict[str, object]) -> dict[str, object]:
        repair_payload = copy.deepcopy(payload)
        messages = repair_payload.get("messages")
        if isinstance(messages, list) and len(messages) >= 2:
            user_message = messages[1]
            if isinstance(user_message, dict):
                user_message["content"] = append_repair_instruction_to_content(user_message.get("content"))
        return repair_payload

    def _post_chat_completion(self, payload: dict[str, object]) -> dict[str, object]:
        body = json.dumps(payload).encode("utf-8")
        request = urllib_request.Request(
            url=f"{self._base_url}/chat/completions",
            data=body,
            headers=build_json_request_headers(
                {
                    "Authorization": f"Bearer {self._api_key}",
                }
            ),
            method="POST",
        )
        return post_json_request(
            request=request,
            timeout_seconds=self._timeout_seconds,
            provider_name=self._provider_name,
        )
