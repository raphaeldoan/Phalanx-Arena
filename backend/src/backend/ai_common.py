from __future__ import annotations

import copy
import json
import os
import socket
import threading
import time
from dataclasses import dataclass
from typing import Protocol
from urllib import error as urllib_error
from urllib import request as urllib_request

from pydantic import BaseModel, Field, ValidationError, model_validator

from . import prompting_adapter
from .config import DEFAULT_MODEL_PRICING, MODEL_PRICING_OVERRIDES_ENV, ModelPricing
from .models import (
    Action,
    AiUsage,
    AiTurnRequest,
    ArmyId,
    Coord,
    Direction,
    GameSnapshot,
    LegalAction,
)
from .provider_catalog import provider_display_name


class AiConfigurationError(RuntimeError):
    pass


class AiDecisionError(RuntimeError):
    pass


class AiCommander(Protocol):
    def choose_action(
        self,
        snapshot: GameSnapshot,
        request: AiTurnRequest,
        action_history: list[Action] | None = None,
    ) -> "AiDecision":
        ...


class DeploymentPlacement(BaseModel):
    unit_id: str
    x: int
    y: int


class BattleOrderStep(BaseModel):
    unit_id: str | None = None
    target_id: str | None = None
    x: int | None = None
    y: int | None = None
    facing: str | None = None


class BattleOrder(BaseModel):
    type: str
    unit_id: str | None = None
    unit_ids: list[str] = Field(default_factory=list)
    target_id: str | None = None
    x: int | None = None
    y: int | None = None
    facing: str | None = None
    steps: list[BattleOrderStep] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def accept_action_type_alias(cls, payload: object) -> object:
        if isinstance(payload, dict) and "type" not in payload and "action_type" in payload:
            payload = {**payload, "type": payload.get("action_type")}
        return payload


class _ModelChoice(BaseModel):
    selected_action_index: int | None = None
    selected_action_indices: list[int] = Field(default_factory=list)
    placements: list[DeploymentPlacement] = Field(default_factory=list)
    orders: list[BattleOrder] = Field(default_factory=list)
    reasoning: str = ""
    visual_observations: str = ""
    confidence: float = 0.5
    intent_update: str = ""

    @model_validator(mode="before")
    @classmethod
    def accept_legacy_plan_update(cls, payload: object) -> object:
        if isinstance(payload, dict) and "intent_update" not in payload and "plan_update" in payload:
            payload = {**payload, "intent_update": payload.get("plan_update")}
        if isinstance(payload, dict) and "placements" not in payload and "deployment_placements" in payload:
            payload = {**payload, "placements": payload.get("deployment_placements")}
        return payload


@dataclass(frozen=True, slots=True)
class ActionChoiceResponseFields:
    include_reasoning: bool
    include_visual_observations: bool
    include_confidence: bool
    include_intent_update: bool

    @property
    def includes_any_commentary(self) -> bool:
        return self.include_reasoning or self.include_visual_observations or self.include_confidence


@dataclass(frozen=True, slots=True)
class UsageCost:
    input_cost_usd: float | None
    output_cost_usd: float | None
    total_cost_usd: float | None
    pricing_model: str | None


STRICT_BENCHMARK_PROFILE = "strict"
STRICT_BENCHMARK_MAX_OUTPUT_TOKENS = 2048
STRICT_BENCHMARK_DEPLOYMENT_MAX_OUTPUT_TOKENS = 4096
STRICT_BENCHMARK_MAX_DECISION_ATTEMPTS = 4
GEMINI_3_STRICT_MAX_OUTPUT_TOKENS = 1024
AI_INTENT_MAX_CHARS = 220
BATTLE_ORDER_MAX_ITEMS = 8
ACTION_CHOICE_SCHEMA_NAME = "phalanx_ai_action_choice"
ACTION_CHOICE_TOOL_NAME = "submit_action_choice"
ACTION_CHOICE_TOOL_DESCRIPTION = "Return the required action choice field(s), optional intent update, and concise notes."
ACTION_CHOICE_RATIONALE_TOOL_DESCRIPTION = (
    "Return the required action choice field(s), optional intent update, and a one or two sentence rationale."
)
ACTION_CHOICE_MINIMAL_TOOL_DESCRIPTION = "Return the required action choice field(s) and optional intent update."
ACTION_CHOICE_REASONING_DESCRIPTION = (
    "A one or two sentence rationale for the chosen legal action, grounded in the rules and current state."
)
ACTION_CHOICE_VISUAL_OBSERVATIONS_DESCRIPTION = (
    "Observations derived from the provided state text."
)
RETURN_TOOL_CALL_INSTRUCTION = f"Return the final answer by calling the {ACTION_CHOICE_TOOL_NAME} tool exactly once."
STRICT_BENCHMARK_REPAIR_PROMPT = (
    "Repair: the previous reply was empty or malformed. Return only the required response format "
    "with the required action choice field(s) and no extra commentary."
)
BATTLE_EXACT_ACTION_FALLBACK_PROMPT = (
    "Fallback exact-action mode: the previous semantic battle orders did not map to shown legal actions. "
    "Return `selected_action_indices` as an ordered array of shown original idx values from GROUPED_ACTIONS/ACTIONS. "
    "Exclude END. Prefer useful non-duplicate orders within the available PIPs; use [] only when no non-END order is useful."
)


@dataclass(slots=True)
class AiDecision:
    action: Action
    action_index: int
    action_summary: str
    reasoning: str
    visual_observations: str
    confidence: float
    model: str
    usage: AiUsage | None = None
    intent_update: str | None = None
    actions: list[Action] | None = None
    action_indices: list[int] | None = None
    deployment_placements: list[DeploymentPlacement] | None = None
    battle_orders: list[BattleOrder] | None = None


RETRYABLE_HTTP_STATUS_CODES = frozenset({408, 429, 500, 502, 503, 504})
DEFAULT_HTTP_RETRY_ATTEMPTS = 4
DEFAULT_HTTP_RETRY_BACKOFF_SECONDS = 2.0
DEFAULT_HTTP_USER_AGENT = "PhalanxArena/0.1"
DEFAULT_MISTRAL_MIN_REQUEST_INTERVAL_SECONDS = 20.0
MISTRAL_THROTTLE_ENV = "PHALANX_MISTRAL_THROTTLE_SECONDS"
MISTRAL_MIN_REQUEST_INTERVAL_ENV = "PHALANX_MISTRAL_MIN_REQUEST_INTERVAL_SECONDS"

_PROVIDER_THROTTLE_LOCK = threading.Lock()
_PROVIDER_LAST_REQUEST_STARTED_AT: dict[str, float] = {}


def resolve_http_retry_attempts() -> int:
    raw = os.environ.get("PHALANX_AI_RETRY_ATTEMPTS", str(DEFAULT_HTTP_RETRY_ATTEMPTS))
    try:
        return max(1, int(raw))
    except ValueError:
        return DEFAULT_HTTP_RETRY_ATTEMPTS


def resolve_http_retry_backoff_seconds() -> float:
    raw = os.environ.get("PHALANX_AI_RETRY_BACKOFF_SECONDS", str(DEFAULT_HTTP_RETRY_BACKOFF_SECONDS))
    try:
        return max(0.0, float(raw))
    except ValueError:
        return DEFAULT_HTTP_RETRY_BACKOFF_SECONDS


def resolve_http_user_agent() -> str:
    raw = os.environ.get("PHALANX_HTTP_USER_AGENT")
    if raw:
        trimmed = raw.strip()
        if trimmed:
            return trimmed
    return DEFAULT_HTTP_USER_AGENT


def resolve_mistral_min_request_interval_seconds() -> float:
    raw = os.environ.get(MISTRAL_MIN_REQUEST_INTERVAL_ENV)
    if raw is None:
        raw = os.environ.get(MISTRAL_THROTTLE_ENV, str(DEFAULT_MISTRAL_MIN_REQUEST_INTERVAL_SECONDS))
    try:
        return max(0.0, float(raw))
    except ValueError:
        return DEFAULT_MISTRAL_MIN_REQUEST_INTERVAL_SECONDS


def min_request_interval_seconds_for_provider(provider_name: str) -> float:
    if provider_name == "mistral":
        return resolve_mistral_min_request_interval_seconds()
    return 0.0


def throttle_provider_request(provider_name: str) -> None:
    interval_seconds = min_request_interval_seconds_for_provider(provider_name)
    if interval_seconds <= 0:
        return
    with _PROVIDER_THROTTLE_LOCK:
        now = time.monotonic()
        last_started_at = _PROVIDER_LAST_REQUEST_STARTED_AT.get(provider_name)
        reserved_started_at = now
        if last_started_at is not None:
            reserved_started_at = max(now, last_started_at + interval_seconds)
        _PROVIDER_LAST_REQUEST_STARTED_AT[provider_name] = reserved_started_at

    delay_seconds = reserved_started_at - now
    if delay_seconds > 0:
        time.sleep(delay_seconds)


def build_json_request_headers(extra_headers: dict[str, str] | None = None) -> dict[str, str]:
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": resolve_http_user_agent(),
    }
    if extra_headers:
        headers.update(extra_headers)
    return headers


def extract_api_error_message(payload: dict[str, object] | None) -> str | None:
    if not isinstance(payload, dict):
        return None
    api_error = payload.get("error")
    if isinstance(api_error, dict):
        message = api_error.get("message")
        if isinstance(message, str) and message:
            return message
    message = payload.get("message")
    if isinstance(message, str) and message:
        return message
    return None


def load_http_error_detail(error: urllib_error.HTTPError) -> tuple[dict[str, object] | None, str]:
    detail = error.read().decode("utf-8", errors="replace")
    try:
        payload = json.loads(detail)
    except json.JSONDecodeError:
        payload = None
    if not isinstance(payload, dict):
        payload = None
    return payload, detail


def extract_http_error_text(detail: str) -> str | None:
    normalized = " ".join(detail.split())
    if not normalized or normalized.startswith("<"):
        return None
    if len(normalized) > 240:
        return f"{normalized[:237]}..."
    return normalized


def resolve_retry_delay_seconds(error: urllib_error.HTTPError | None, attempt: int) -> float:
    if error is not None:
        retry_after = error.headers.get("Retry-After")
        if retry_after:
            try:
                return max(0.0, float(retry_after))
            except ValueError:
                pass
    return resolve_http_retry_backoff_seconds() * attempt


def post_json_request(
    *,
    request: urllib_request.Request,
    timeout_seconds: float,
    provider_name: str,
) -> dict[str, object]:
    retry_attempts = resolve_http_retry_attempts()
    for attempt in range(1, retry_attempts + 1):
        try:
            throttle_provider_request(provider_name)
            with urllib_request.urlopen(request, timeout=timeout_seconds) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib_error.HTTPError as error:
            payload, detail = load_http_error_detail(error)
            if attempt < retry_attempts and error.code in RETRYABLE_HTTP_STATUS_CODES:
                time.sleep(resolve_retry_delay_seconds(error, attempt))
                continue
            message = extract_api_error_message(payload)
            if message is None:
                message = extract_http_error_text(detail)
            if message:
                raise AiDecisionError(f"{provider_display_name(provider_name)} request failed: {message}") from error
            raise AiDecisionError(
                f"{provider_display_name(provider_name)} request failed with status {error.code}."
            ) from error
        except urllib_error.URLError as error:
            if attempt < retry_attempts:
                time.sleep(resolve_retry_delay_seconds(None, attempt))
                continue
            raise AiDecisionError(
                f"{provider_display_name(provider_name)} request failed: {error.reason}"
            ) from error
        except ConnectionError as error:
            if attempt < retry_attempts:
                time.sleep(resolve_retry_delay_seconds(None, attempt))
                continue
            raise AiDecisionError(
                f"{provider_display_name(provider_name)} request failed: {error}"
            ) from error
        except (TimeoutError, socket.timeout) as error:
            if attempt < retry_attempts:
                time.sleep(resolve_retry_delay_seconds(None, attempt))
                continue
            raise AiDecisionError(f"{provider_display_name(provider_name)} request timed out.") from error


def is_gemini_2_5_model(model: str | None) -> bool:
    if not model:
        return False
    return model.strip().lower().startswith("gemini-2.5")


def is_gemini_3_model(model: str | None) -> bool:
    if not model:
        return False
    return model.strip().lower().startswith("gemini-3")


def supports_disabling_gemini_thinking(model: str | None) -> bool:
    if not model:
        return False
    normalized = model.strip().lower()
    return normalized.startswith("gemini-2.5-flash") or normalized.startswith("gemini-2.5-flash-lite")


def is_claude_opus_4_7_model(model: str | None) -> bool:
    if not model:
        return False
    return model.strip().lower().startswith("claude-opus-4-7")


def resolve_action_choice_response_fields(
    request: AiTurnRequest,
    *,
    benchmark_profile: str | None,
) -> ActionChoiceResponseFields:
    if is_strict_benchmark_profile(benchmark_profile):
        return ActionChoiceResponseFields(
            include_reasoning=request.include_rationale,
            include_visual_observations=False,
            include_confidence=False,
            include_intent_update=True,
        )
    return ActionChoiceResponseFields(
        include_reasoning=True,
        include_visual_observations=True,
        include_confidence=True,
        include_intent_update=True,
    )


def build_action_choice_schema(
    maximum_index: int,
    *,
    response_fields: ActionChoiceResponseFields,
    deployment_batch: bool = False,
    battle_batch: bool = False,
    battle_batch_exact_actions: bool = False,
    board_width: int | None = None,
    board_height: int | None = None,
    battle_order_max_items: int = BATTLE_ORDER_MAX_ITEMS,
) -> dict[str, object]:
    if deployment_batch:
        x_schema: dict[str, object] = {"type": "integer", "minimum": 0}
        y_schema: dict[str, object] = {"type": "integer", "minimum": 0}
        if board_width is not None and board_width > 0:
            x_schema["maximum"] = board_width - 1
        if board_height is not None and board_height > 0:
            y_schema["maximum"] = board_height - 1
        properties: dict[str, object] = {
            "placements": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "unit_id": {
                            "type": "string",
                            "description": "The unit id to deploy.",
                        },
                        "x": x_schema,
                        "y": y_schema,
                    },
                    "required": ["unit_id", "x", "y"],
                    "additionalProperties": False,
                },
                "minItems": 1,
                "description": "Deployment coordinates for this army's reserve units.",
            }
        }
        required = ["placements"]
    elif battle_batch and battle_batch_exact_actions:
        properties = {
            "selected_action_indices": {
                "type": "array",
                "items": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": maximum_index,
                },
                "maxItems": max(1, battle_order_max_items),
                "description": (
                    "Ordered shown original legal action indices for this army's bound. "
                    "Exclude end_bound/END; the harness ends the bound after attempting the plan."
                ),
            }
        }
        required = ["selected_action_indices"]
    elif battle_batch:
        nullable_string: dict[str, object] = {"type": ["string", "null"]}
        nullable_integer: dict[str, object] = {"type": ["integer", "null"]}
        nullable_facing: dict[str, object] = {"type": ["string", "null"], "enum": ["N", "E", "S", "W", None]}
        step_schema = {
            "type": "object",
            "properties": {
                "unit_id": {
                    **nullable_string,
                    "description": "SELF/ENEMY unit id for this step; null when not applicable.",
                },
                "target_id": {
                    **nullable_string,
                    "description": "SELF/ENEMY target id for group charges; null otherwise.",
                },
                "x": nullable_integer,
                "y": nullable_integer,
                "facing": nullable_facing,
            },
            "required": ["unit_id", "target_id", "x", "y", "facing"],
            "additionalProperties": False,
        }
        properties = {
            "orders": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": [
                                "move",
                                "march_move",
                                "charge",
                                "group_move",
                                "group_march_move",
                                "group_charge",
                                "rotate",
                                "shoot",
                                "rally",
                                "reform_pike",
                            ],
                            "description": "The order type to match against the grouped legal actions.",
                        },
                        "unit_id": {
                            **nullable_string,
                            "description": "SELF/ENEMY unit id for single-unit orders; null for group orders.",
                        },
                        "unit_ids": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "SELF unit ids for group orders; [] for single-unit orders.",
                        },
                        "target_id": {
                            **nullable_string,
                            "description": "ENEMY target id for charge/shoot orders; null otherwise.",
                        },
                        "x": nullable_integer,
                        "y": nullable_integer,
                        "facing": nullable_facing,
                        "steps": {
                            "type": "array",
                            "items": step_schema,
                            "description": "Per-unit steps for group orders; [] for single-unit orders.",
                        },
                    },
                    "required": ["type", "unit_id", "unit_ids", "target_id", "x", "y", "facing", "steps"],
                    "additionalProperties": False,
                },
                "maxItems": max(1, battle_order_max_items),
                "description": (
                    "Ordered semantic orders to attempt for this army's bound. Use SELF/ENEMY ids and local "
                    "coordinates/facing exactly as shown in the grouped action list. Use null or [] for fields "
                    "that do not apply. Omit end_bound; the harness ends the bound after attempting the plan."
                ),
            }
        }
        required = ["orders"]
    else:
        properties = {
            "selected_action_index": {
                "type": "integer",
                "minimum": 0,
                "maximum": maximum_index,
                "description": "The index of the chosen legal action.",
            }
        }
        required = ["selected_action_index"]
    if response_fields.include_intent_update:
        properties["intent_update"] = {
            "type": "string",
            "maxLength": AI_INTENT_MAX_CHARS,
            "description": "Replacement for the current intent when updates are allowed; use an empty string to keep it.",
        }
        required.append("intent_update")
    if response_fields.include_reasoning:
        properties["reasoning"] = {
            "type": "string",
            "description": ACTION_CHOICE_REASONING_DESCRIPTION,
        }
        required.append("reasoning")
    if response_fields.include_visual_observations:
        properties["visual_observations"] = {
            "type": "string",
            "description": ACTION_CHOICE_VISUAL_OBSERVATIONS_DESCRIPTION,
        }
        required.append("visual_observations")
    if response_fields.include_confidence:
        properties["confidence"] = {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
            "description": "Confidence in the chosen legal action.",
        }
        required.append("confidence")
    return {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False,
    }


def build_action_choice_tool_description(*, response_fields: ActionChoiceResponseFields) -> str:
    if response_fields.include_visual_observations or response_fields.include_confidence:
        return ACTION_CHOICE_TOOL_DESCRIPTION
    if response_fields.include_reasoning:
        return ACTION_CHOICE_RATIONALE_TOOL_DESCRIPTION
    return ACTION_CHOICE_MINIMAL_TOOL_DESCRIPTION


def build_return_tool_call_instruction(*, response_fields: ActionChoiceResponseFields) -> str:
    if response_fields.includes_any_commentary:
        return RETURN_TOOL_CALL_INSTRUCTION
    return (
        f"Return the final answer by calling the {ACTION_CHOICE_TOOL_NAME} tool exactly once "
        "with the required action choice field(s) and intent_update."
    )


def battle_order_max_items_for_snapshot(snapshot: GameSnapshot) -> int:
    pips_remaining = max(0, int(getattr(snapshot.state, "pips_remaining", 0) or 0))
    if pips_remaining <= 0:
        return 1
    return max(1, min(BATTLE_ORDER_MAX_ITEMS, pips_remaining))


def apply_strict_benchmark_response_settings(payload: dict[str, object], *, benchmark_profile: str | None) -> None:
    if is_strict_benchmark_profile(benchmark_profile):
        payload["max_output_tokens"] = STRICT_BENCHMARK_MAX_OUTPUT_TOKENS
        payload["reasoning"] = {"effort": "low"}


def apply_deployment_batch_response_settings(payload: dict[str, object], request: AiTurnRequest) -> None:
    if not (request.deployment_batch or request.battle_batch):
        return
    if "max_output_tokens" in payload:
        payload["max_output_tokens"] = max(int(payload["max_output_tokens"]), STRICT_BENCHMARK_DEPLOYMENT_MAX_OUTPUT_TOKENS)
    if "max_tokens" in payload:
        payload["max_tokens"] = max(int(payload["max_tokens"]), STRICT_BENCHMARK_DEPLOYMENT_MAX_OUTPUT_TOKENS)


def apply_strict_benchmark_chat_settings(
    payload: dict[str, object],
    *,
    benchmark_profile: str | None,
    provider_name: str,
    model: str | None,
) -> None:
    if is_strict_benchmark_profile(benchmark_profile):
        payload["max_tokens"] = (
            GEMINI_3_STRICT_MAX_OUTPUT_TOKENS
            if provider_name == "gemini" and is_gemini_3_model(model)
            else STRICT_BENCHMARK_MAX_OUTPUT_TOKENS
        )
        if not (provider_name == "anthropic" and is_claude_opus_4_7_model(model)):
            payload["temperature"] = 0
        if provider_name == "gemini" and supports_disabling_gemini_thinking(model):
            # Gemini 2.5 Flash variants can disable internal thinking for lower-latency benchmark turns.
            payload["reasoning_effort"] = "none"
        elif provider_name == "gemini" and is_gemini_3_model(model):
            # Gemini 3 models cannot disable thinking; use the lightest supported reasoning level instead.
            payload["reasoning_effort"] = "low"


def append_repair_instruction_to_text(text: str) -> str:
    return f"{text}\n\n{STRICT_BENCHMARK_REPAIR_PROMPT}"


def append_battle_exact_action_fallback_instruction_to_text(text: str) -> str:
    return f"{text}\n\n{BATTLE_EXACT_ACTION_FALLBACK_PROMPT}"


def append_repair_instruction_to_content(content: object, *, openai_response_input: bool = False) -> object:
    if isinstance(content, str):
        return append_repair_instruction_to_text(content)
    if not isinstance(content, list):
        return content

    repaired_content = copy.deepcopy(content)
    text_type = "input_text" if openai_response_input else "text"
    repaired_content.append({"type": text_type, "text": STRICT_BENCHMARK_REPAIR_PROMPT})
    return repaired_content


def append_battle_exact_action_fallback_instruction_to_content(
    content: object,
    *,
    openai_response_input: bool = False,
) -> object:
    if isinstance(content, str):
        return append_battle_exact_action_fallback_instruction_to_text(content)
    if not isinstance(content, list):
        return content

    fallback_content = copy.deepcopy(content)
    text_type = "input_text" if openai_response_input else "text"
    fallback_content.append({"type": text_type, "text": BATTLE_EXACT_ACTION_FALLBACK_PROMPT})
    return fallback_content


def should_use_battle_exact_action_fallback(*, request: AiTurnRequest, model: str) -> bool:
    return request.battle_batch and "gpt-oss" in model.strip().lower()


def battle_decision_needs_exact_action_fallback(
    choice: _ModelChoice,
    decision: AiDecision,
    *,
    request: AiTurnRequest,
) -> bool:
    return request.battle_batch and bool(choice.orders) and not (decision.action_indices or [])


def sanitize_intent_update(raw_intent: str | None, *, allowed: bool) -> str | None:
    if not allowed or raw_intent is None:
        return None
    normalized = " ".join(raw_intent.split()).strip()
    if not normalized:
        return None
    return normalized[:AI_INTENT_MAX_CHARS]


def selected_action_indices_from_choice(
    choice: _ModelChoice,
    legal_action_count: int,
    *,
    provider_name: str,
    deployment_batch: bool,
    battle_batch: bool = False,
) -> list[int]:
    if deployment_batch or battle_batch:
        raw_indices = choice.selected_action_indices
        if not raw_indices and choice.selected_action_index is not None:
            raw_indices = [choice.selected_action_index]
    else:
        if choice.selected_action_index is None:
            raise AiDecisionError(f"{provider_display_name(provider_name)} did not select a legal action index.")
        raw_indices = [choice.selected_action_index]

    selected: list[int] = []
    seen: set[int] = set()
    for index in raw_indices:
        if index < 0 or index >= legal_action_count:
            raise AiDecisionError(
                f"{provider_display_name(provider_name)} selected action index {index}, "
                "which is outside the legal action range."
            )
        if index in seen:
            continue
        seen.add(index)
        selected.append(index)
    if not selected and not battle_batch:
        raise AiDecisionError(f"{provider_display_name(provider_name)} did not select any legal action indices.")
    return selected


def deployment_actions_from_placements(
    placements: list[DeploymentPlacement],
    legal_actions: list[LegalAction],
    *,
    snapshot: GameSnapshot,
    request: AiTurnRequest,
) -> list[Action]:
    legal_deploy_actions: dict[tuple[str, int, int], LegalAction] = {}
    for legal_action in legal_actions:
        if legal_action.type != "deploy":
            continue
        legal_deploy_actions[
            (legal_action.unit_id, legal_action.destination.x, legal_action.destination.y)
        ] = legal_action

    actions: list[Action] = []
    used_units: set[str] = set()
    for placement in placements:
        unit_id = resolve_deployment_unit_id(placement.unit_id, request.army)
        if unit_id in used_units:
            continue
        candidate_coords = deployment_candidate_coordinates(
            placement.x,
            placement.y,
            snapshot=snapshot,
            request=request,
        )
        legal_action = next(
            (
                legal_deploy_actions.get((unit_id, x, y))
                for x, y in candidate_coords
                if legal_deploy_actions.get((unit_id, x, y)) is not None
            ),
            None,
        )
        if legal_action is None:
            continue
        used_units.add(unit_id)
        actions.append(prompting_adapter.legal_action_to_action(legal_action))
    return actions


def resolve_deployment_unit_id(unit_id: str, army: ArmyId) -> str:
    if unit_id.startswith("SELF-"):
        return f"{army.value}-{unit_id.removeprefix('SELF-')}"
    if unit_id.startswith("ENEMY-"):
        enemy = ArmyId.B if army == ArmyId.A else ArmyId.A
        return f"{enemy.value}-{unit_id.removeprefix('ENEMY-')}"
    return unit_id


def deployment_candidate_coordinates(
    x: int,
    y: int,
    *,
    snapshot: GameSnapshot,
    request: AiTurnRequest,
) -> list[tuple[int, int]]:
    candidates = [(x, y)]
    if request.army == ArmyId.B:
        local_as_global = (
            snapshot.state.board_width - 1 - x,
            snapshot.state.board_height - 1 - y,
        )
        if local_as_global not in candidates:
            candidates.append(local_as_global)
    return candidates


def battle_actions_from_orders(
    orders: list[BattleOrder],
    legal_actions: list[LegalAction],
    *,
    snapshot: GameSnapshot,
    request: AiTurnRequest,
) -> tuple[list[int], list[Action]]:
    selected_indices: list[int] = []
    actions: list[Action] = []
    used_indices: set[int] = set()
    used_units: set[str] = set()

    for order in orders:
        index = match_battle_order_to_legal_action(
            order,
            legal_actions,
            snapshot=snapshot,
            request=request,
            used_units=used_units,
            used_indices=used_indices,
        )
        if index is None:
            continue
        legal_action = legal_actions[index]
        selected_indices.append(index)
        actions.append(prompting_adapter.legal_action_to_action(legal_action))
        used_indices.add(index)
        used_units.update(battle_ordered_unit_ids(legal_action))

    return selected_indices, actions


def match_battle_order_to_legal_action(
    order: BattleOrder,
    legal_actions: list[LegalAction],
    *,
    snapshot: GameSnapshot,
    request: AiTurnRequest,
    used_units: set[str],
    used_indices: set[int],
) -> int | None:
    order_type = normalize_battle_order_type(order.type)
    if order_type is None:
        return None

    candidates: list[tuple[int, LegalAction]] = [
        (index, legal_action)
        for index, legal_action in enumerate(legal_actions)
        if index not in used_indices and legal_action.type == order_type and legal_action.type != "end_bound"
    ]
    if not candidates:
        return None

    order_units = battle_order_unit_ids_from_model(order, request=request)
    if order_units and any(unit_id in used_units for unit_id in order_units):
        return None

    filtered = [
        (index, legal_action)
        for index, legal_action in candidates
        if battle_order_matches_action(order, legal_action, snapshot=snapshot, request=request)
    ]
    if len(filtered) == 1:
        return filtered[0][0]
    return None


def normalize_battle_order_type(raw_type: str | None) -> str | None:
    if raw_type is None:
        return None
    normalized = raw_type.strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "march": "march_move",
        "group_march": "group_march_move",
        "group_move": "group_move",
        "group_march_move": "group_march_move",
        "group_charge": "group_charge",
        "reform": "reform_pike",
        "reform_pikes": "reform_pike",
    }
    normalized = aliases.get(normalized, normalized)
    if normalized in {
        "move",
        "march_move",
        "charge",
        "group_move",
        "group_march_move",
        "group_charge",
        "rotate",
        "shoot",
        "rally",
        "reform_pike",
    }:
        return normalized
    return None


def battle_order_unit_ids_from_model(order: BattleOrder, *, request: AiTurnRequest) -> list[str]:
    if order.unit_ids:
        return [
            resolved
            for unit_id in order.unit_ids
            if (resolved := resolve_battle_unit_id(unit_id, request.army))
        ]
    unit_id = resolve_battle_unit_id(order.unit_id, request.army)
    return [unit_id] if unit_id else []


def battle_order_matches_action(
    order: BattleOrder,
    legal_action: LegalAction,
    *,
    snapshot: GameSnapshot,
    request: AiTurnRequest,
) -> bool:
    if legal_action.type in {"move", "march_move"}:
        return (
            single_unit_matches(order, legal_action.unit_id, request=request)
            and destination_matches(order, legal_action.destination, snapshot=snapshot, request=request)
            and facing_matches(order, legal_action.facing, request=request)
        )
    if legal_action.type == "charge":
        return (
            single_unit_matches(order, legal_action.unit_id, request=request)
            and target_matches(order, legal_action.target_id, request=request)
            and destination_matches(order, legal_action.destination, snapshot=snapshot, request=request)
            and facing_matches(order, legal_action.facing, request=request)
        )
    if legal_action.type in {"group_move", "group_march_move"}:
        return group_units_match(order, legal_action.unit_ids, request=request) and group_move_steps_match(
            order.steps,
            legal_action.steps,
            snapshot=snapshot,
            request=request,
        )
    if legal_action.type == "group_charge":
        return group_units_match(order, legal_action.unit_ids, request=request) and group_charge_steps_match(
            order.steps,
            legal_action.steps,
            snapshot=snapshot,
            request=request,
        )
    if legal_action.type == "rotate":
        return single_unit_matches(order, legal_action.unit_id, request=request) and facing_matches(
            order,
            legal_action.facing,
            request=request,
        )
    if legal_action.type == "shoot":
        return single_unit_matches(order, legal_action.unit_id, request=request) and target_matches(
            order,
            legal_action.target_id,
            request=request,
        )
    if legal_action.type in {"rally", "reform_pike"}:
        return single_unit_matches(order, legal_action.unit_id, request=request)
    return False


def single_unit_matches(order: BattleOrder, legal_unit_id: str, *, request: AiTurnRequest) -> bool:
    unit_id = resolve_battle_unit_id(order.unit_id, request.army)
    return unit_id == legal_unit_id if unit_id else False


def target_matches(order: BattleOrder, legal_target_id: str, *, request: AiTurnRequest) -> bool:
    target_id = resolve_battle_unit_id(order.target_id, request.army)
    return target_id == legal_target_id if target_id else False


def group_units_match(order: BattleOrder, legal_unit_ids: list[str], *, request: AiTurnRequest) -> bool:
    unit_ids = battle_order_unit_ids_from_model(order, request=request)
    if not unit_ids:
        return False
    return unit_ids == list(legal_unit_ids)


def group_move_steps_match(
    order_steps: list[BattleOrderStep],
    legal_steps: list[object],
    *,
    snapshot: GameSnapshot,
    request: AiTurnRequest,
) -> bool:
    if not order_steps:
        return True
    if len(order_steps) != len(legal_steps):
        return False
    return all(
        step_unit_matches(order_step, legal_step.unit_id, request=request)
        and step_destination_matches(order_step, legal_step.destination, snapshot=snapshot, request=request)
        and step_facing_matches(order_step, legal_step.facing, request=request)
        for order_step, legal_step in zip(order_steps, legal_steps, strict=False)
    )


def group_charge_steps_match(
    order_steps: list[BattleOrderStep],
    legal_steps: list[object],
    *,
    snapshot: GameSnapshot,
    request: AiTurnRequest,
) -> bool:
    if not order_steps:
        return True
    if len(order_steps) != len(legal_steps):
        return False
    return all(
        step_unit_matches(order_step, legal_step.unit_id, request=request)
        and step_target_matches(order_step, legal_step.target_id, request=request)
        and step_destination_matches(order_step, legal_step.destination, snapshot=snapshot, request=request)
        and step_facing_matches(order_step, legal_step.facing, request=request)
        for order_step, legal_step in zip(order_steps, legal_steps, strict=False)
    )


def destination_matches(
    order: BattleOrder,
    legal_destination: Coord,
    *,
    snapshot: GameSnapshot,
    request: AiTurnRequest,
) -> bool:
    destination = resolve_battle_coord(order.x, order.y, snapshot=snapshot, request=request)
    return destination == (legal_destination.x, legal_destination.y) if destination is not None else False


def facing_matches(order: BattleOrder, legal_facing: Direction, *, request: AiTurnRequest) -> bool:
    facing = resolve_battle_direction(order.facing, request.army)
    return facing == legal_facing if facing is not None else False


def step_unit_matches(step: BattleOrderStep, legal_unit_id: str, *, request: AiTurnRequest) -> bool:
    unit_id = resolve_battle_unit_id(step.unit_id, request.army)
    return unit_id == legal_unit_id if unit_id else False


def step_target_matches(step: BattleOrderStep, legal_target_id: str, *, request: AiTurnRequest) -> bool:
    target_id = resolve_battle_unit_id(step.target_id, request.army)
    return target_id == legal_target_id if target_id else False


def step_destination_matches(
    step: BattleOrderStep,
    legal_destination: Coord,
    *,
    snapshot: GameSnapshot,
    request: AiTurnRequest,
) -> bool:
    destination = resolve_battle_coord(step.x, step.y, snapshot=snapshot, request=request)
    return destination == (legal_destination.x, legal_destination.y) if destination is not None else False


def step_facing_matches(step: BattleOrderStep, legal_facing: Direction, *, request: AiTurnRequest) -> bool:
    facing = resolve_battle_direction(step.facing, request.army)
    return facing == legal_facing if facing is not None else False


def resolve_battle_unit_id(unit_id: str | None, army: ArmyId) -> str | None:
    if unit_id is None:
        return None
    normalized = unit_id.strip()
    if not normalized:
        return None
    if normalized.startswith("SELF-"):
        return f"{army.value}-{normalized.removeprefix('SELF-')}"
    if normalized.startswith("ENEMY-"):
        enemy = ArmyId.B if army == ArmyId.A else ArmyId.A
        return f"{enemy.value}-{normalized.removeprefix('ENEMY-')}"
    return normalized


def resolve_battle_coord(
    x: int | None,
    y: int | None,
    *,
    snapshot: GameSnapshot,
    request: AiTurnRequest,
) -> tuple[int, int] | None:
    if x is None or y is None:
        return None
    if request.army == ArmyId.B:
        return (snapshot.state.board_width - 1 - x, snapshot.state.board_height - 1 - y)
    return (x, y)


def resolve_battle_direction(facing: str | None, army: ArmyId) -> Direction | None:
    if facing is None:
        return None
    try:
        direction = Direction(facing.strip().upper())
    except ValueError:
        return None
    if army == ArmyId.A:
        return direction
    return {
        Direction.N: Direction.S,
        Direction.S: Direction.N,
        Direction.E: Direction.W,
        Direction.W: Direction.E,
    }[direction]


def battle_ordered_unit_ids(legal_action: LegalAction) -> set[str]:
    if legal_action.type in {"group_move", "group_march_move", "group_charge"}:
        return set(legal_action.unit_ids)
    unit_id = getattr(legal_action, "unit_id", None)
    return {unit_id} if isinstance(unit_id, str) else set()


def first_legal_action(legal_actions: list[LegalAction]) -> Action:
    return prompting_adapter.legal_action_to_action(legal_actions[0])


def decision_from_model_choice(
    choice: _ModelChoice,
    *,
    snapshot: GameSnapshot,
    legal_actions: list[LegalAction],
    request: AiTurnRequest,
    provider_name: str,
    response_model: str,
    usage: AiUsage | None,
) -> AiDecision:
    if request.deployment_batch:
        selected_indices: list[int] = []
        if choice.placements:
            actions = deployment_actions_from_placements(
                choice.placements,
                legal_actions,
                snapshot=snapshot,
                request=request,
            )
        else:
            selected_indices = selected_action_indices_from_choice(
                choice,
                len(legal_actions),
                provider_name=provider_name,
                deployment_batch=True,
            )
            actions = [prompting_adapter.legal_action_to_action(legal_actions[index]) for index in selected_indices]
        if not actions:
            actions = [first_legal_action(legal_actions)]
        action_summary = f"deployment plan: {len(choice.placements) or len(actions)} placements"
    elif request.battle_batch:
        if choice.orders:
            selected_indices, actions = battle_actions_from_orders(
                choice.orders,
                legal_actions,
                snapshot=snapshot,
                request=request,
            )
            action_summary = f"bound plan: {len(actions)}/{len(choice.orders)} matched orders"
        else:
            selected_indices = selected_action_indices_from_choice(
                choice,
                len(legal_actions),
                provider_name=provider_name,
                deployment_batch=False,
                battle_batch=True,
            )
            actions = [prompting_adapter.legal_action_to_action(legal_actions[index]) for index in selected_indices]
            action_summary = f"bound plan: {len(selected_indices)} orders"
    else:
        selected_indices = selected_action_indices_from_choice(
            choice,
            len(legal_actions),
            provider_name=provider_name,
            deployment_batch=False,
            battle_batch=False,
        )
        actions = [prompting_adapter.legal_action_to_action(legal_actions[index]) for index in selected_indices]
        chosen_legal_actions = [legal_actions[index] for index in selected_indices]
        action_summary = prompting_adapter.describe_legal_action(chosen_legal_actions[0])
    primary_action = actions[0] if actions else first_legal_action(legal_actions)
    return AiDecision(
        action=primary_action,
        action_index=selected_indices[0] if selected_indices else 0,
        action_summary=action_summary,
        reasoning=resolve_reasoning_text(
            choice.reasoning,
            provider_name=provider_name,
            action_summary=action_summary,
        ),
        visual_observations=resolve_visual_observations_text(
            choice.visual_observations,
            provider_name=provider_name,
        ),
        confidence=max(0.0, min(1.0, choice.confidence)),
        model=response_model,
        usage=usage,
        intent_update=sanitize_intent_update(
            choice.intent_update,
            allowed=request.can_update_intent,
        ),
        actions=actions,
        action_indices=selected_indices if request.battle_batch else selected_indices or None,
        deployment_placements=choice.placements or None,
        battle_orders=choice.orders or None,
    )


def merge_usage_values(usages: list[AiUsage | None]) -> AiUsage | None:
    present = [usage for usage in usages if usage is not None]
    if not present:
        return None

    total_tokens = sum(
        usage.total_tokens
        if usage.total_tokens is not None
        else (usage.input_tokens or 0) + (usage.output_tokens or 0)
        for usage in present
        if usage.total_tokens is not None or usage.input_tokens is not None or usage.output_tokens is not None
    )
    pricing_model = next((usage.pricing_model for usage in reversed(present) if usage.pricing_model), None)
    return AiUsage(
        input_tokens=sum_optional_int([usage.input_tokens for usage in present]),
        output_tokens=sum_optional_int([usage.output_tokens for usage in present]),
        total_tokens=total_tokens if any(
            usage.total_tokens is not None or usage.input_tokens is not None or usage.output_tokens is not None
            for usage in present
        ) else None,
        cached_input_tokens=sum_optional_int([usage.cached_input_tokens for usage in present]),
        reasoning_tokens=sum_optional_int([usage.reasoning_tokens for usage in present]),
        input_cost_usd=sum_optional_float([usage.input_cost_usd for usage in present]),
        output_cost_usd=sum_optional_float([usage.output_cost_usd for usage in present]),
        total_cost_usd=sum_optional_float([usage.total_cost_usd for usage in present]),
        pricing_model=pricing_model,
        estimated=all(usage.estimated for usage in present),
    )


def sum_optional_int(values: list[int | None]) -> int | None:
    present = [value for value in values if value is not None]
    return sum(present) if present else None


def sum_optional_float(values: list[float | None]) -> float | None:
    present = [value for value in values if value is not None]
    return sum(present) if present else None


def parse_openai_choice(response_payload: dict[str, object]) -> _ModelChoice:
    output_text = extract_output_text(response_payload)
    if not output_text.strip():
        raise AiDecisionError(f"OpenAI returned an empty decision payload. {summarize_openai_response_status(response_payload)}")
    try:
        return _ModelChoice.model_validate_json(output_text)
    except ValidationError as error:
        raise AiDecisionError(f"OpenAI returned an invalid decision payload: {error}") from error


def summarize_openai_response_status(response_payload: dict[str, object]) -> str:
    status = response_payload.get("status")
    incomplete_details = response_payload.get("incomplete_details")
    output = response_payload.get("output")
    output_types: list[str] = []
    if isinstance(output, list):
        for item in output:
            if isinstance(item, dict):
                item_type = item.get("type")
                if isinstance(item_type, str):
                    output_types.append(item_type)
    usage = response_payload.get("usage")
    reasoning_tokens = None
    if isinstance(usage, dict):
        output_details = usage.get("output_tokens_details")
        if isinstance(output_details, dict):
            reasoning_tokens = output_details.get("reasoning_tokens")
    return (
        f"status={status!r}; incomplete_details={incomplete_details!r}; "
        f"output_types={output_types!r}; reasoning_tokens={reasoning_tokens!r}"
    )


def parse_anthropic_choice(response_payload: dict[str, object]) -> _ModelChoice:
    choice_payload = extract_anthropic_tool_input(response_payload, tool_name=ACTION_CHOICE_TOOL_NAME)
    if choice_payload is not None:
        try:
            return _ModelChoice.model_validate(choice_payload)
        except ValidationError as error:
            raise AiDecisionError(f"Anthropic returned an invalid tool payload: {error}") from error

    output_text = extract_anthropic_text(response_payload)
    if not output_text.strip():
        raise AiDecisionError("Anthropic returned an empty decision payload.")
    try:
        return _ModelChoice.model_validate_json(output_text)
    except ValidationError as error:
        raise AiDecisionError(f"Anthropic returned an invalid decision payload: {error}") from error


def parse_chat_completion_choice(response_payload: dict[str, object], *, provider_name: str) -> _ModelChoice:
    choice_payload = extract_chat_completion_tool_input(response_payload, tool_name=ACTION_CHOICE_TOOL_NAME)
    if choice_payload is not None:
        try:
            return _ModelChoice.model_validate(choice_payload)
        except ValidationError as error:
            raise AiDecisionError(
                f"{provider_display_name(provider_name)} returned an invalid tool payload: {error}"
            ) from error

    output_text = extract_chat_completion_text(response_payload)
    if not output_text.strip():
        raise AiDecisionError(f"{provider_display_name(provider_name)} returned an empty decision payload.")
    try:
        return _ModelChoice.model_validate_json(output_text)
    except ValidationError as error:
        raise AiDecisionError(
            f"{provider_display_name(provider_name)} returned an invalid decision payload: {error}"
        ) from error


def load_model_pricing_overrides(raw: str | None) -> dict[str, ModelPricing]:
    if not raw:
        return {}

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        raise AiConfigurationError(f"{MODEL_PRICING_OVERRIDES_ENV} is not valid JSON.") from error

    if not isinstance(payload, dict):
        raise AiConfigurationError(f"{MODEL_PRICING_OVERRIDES_ENV} must be a JSON object keyed by model name.")

    overrides: dict[str, ModelPricing] = {}
    for model_name, config in payload.items():
        if not isinstance(model_name, str) or not isinstance(config, dict):
            raise AiConfigurationError(
                f"{MODEL_PRICING_OVERRIDES_ENV} entries must look like "
                '{"model-name":{"input_usd_per_1m":0.25,"cached_input_usd_per_1m":0.025,"output_usd_per_1m":2.0}}.'
            )
        input_rate = coerce_float(config.get("input_usd_per_1m"))
        output_rate = coerce_float(config.get("output_usd_per_1m"))
        cached_input_rate = coerce_float(config.get("cached_input_usd_per_1m"))
        if input_rate is None or output_rate is None:
            raise AiConfigurationError(
                f"Pricing override for {model_name!r} must include input_usd_per_1m and output_usd_per_1m."
            )
        overrides[normalize_model_name(model_name)] = ModelPricing(
            input_usd_per_1m=input_rate,
            cached_input_usd_per_1m=cached_input_rate,
            output_usd_per_1m=output_rate,
        )
    return overrides


def normalize_model_name(model: str) -> str:
    return model.strip().lower()


def normalize_benchmark_profile(profile: str | None) -> str | None:
    if profile is None:
        return None
    normalized = profile.strip().lower()
    if not normalized:
        return None
    if normalized == STRICT_BENCHMARK_PROFILE:
        return normalized
    raise AiConfigurationError(f"Unsupported benchmark profile {profile!r}.")


def is_strict_benchmark_profile(profile: str | None) -> bool:
    return profile == STRICT_BENCHMARK_PROFILE


def resolve_model_pricing(
    model: str, pricing_overrides: dict[str, ModelPricing] | None = None
) -> tuple[str, ModelPricing] | None:
    """Resolve pricing from overrides layered onto fallback config estimates."""
    normalized_model = normalize_model_name(model)
    price_table = {**DEFAULT_MODEL_PRICING, **(pricing_overrides or {})}
    direct_match = price_table.get(normalized_model)
    if direct_match is not None:
        return normalized_model, direct_match

    matching_prefixes = [
        pricing_model
        for pricing_model in price_table
        if is_pricing_model_version_variant(normalized_model, pricing_model)
    ]
    if not matching_prefixes:
        return None

    resolved_model = max(matching_prefixes, key=len)
    return resolved_model, price_table[resolved_model]


def is_pricing_model_version_variant(normalized_model: str, pricing_model: str) -> bool:
    if not normalized_model.startswith(pricing_model):
        return False
    suffix = normalized_model[len(pricing_model) :]
    return len(suffix) > 1 and suffix.startswith("-") and suffix[1].isdigit()


def price_usage(
    input_tokens: int | None,
    output_tokens: int | None,
    cached_tokens: int | None,
    model: str,
    *,
    pricing_overrides: dict[str, ModelPricing] | None = None,
) -> UsageCost:
    if input_tokens is None or output_tokens is None:
        return UsageCost(
            input_cost_usd=None,
            output_cost_usd=None,
            total_cost_usd=None,
            pricing_model=None,
        )

    resolved_pricing = resolve_model_pricing(model, pricing_overrides)
    if resolved_pricing is None:
        return UsageCost(
            input_cost_usd=None,
            output_cost_usd=None,
            total_cost_usd=None,
            pricing_model=None,
        )

    pricing_model, pricing = resolved_pricing
    safe_cached_tokens = max(cached_tokens or 0, 0)
    uncached_input_tokens = max(input_tokens - safe_cached_tokens, 0)
    cached_input_rate = pricing.cached_input_usd_per_1m
    if cached_input_rate is None:
        cached_input_rate = pricing.input_usd_per_1m

    input_cost_usd = (
        (uncached_input_tokens * pricing.input_usd_per_1m) + (safe_cached_tokens * cached_input_rate)
    ) / 1_000_000
    output_cost_usd = (output_tokens * pricing.output_usd_per_1m) / 1_000_000
    return UsageCost(
        input_cost_usd=input_cost_usd,
        output_cost_usd=output_cost_usd,
        total_cost_usd=input_cost_usd + output_cost_usd,
        pricing_model=pricing_model,
    )


def extract_usage_metrics(
    response_payload: dict[str, object],
    *,
    model: str,
    pricing_overrides: dict[str, ModelPricing] | None = None,
) -> AiUsage | None:
    usage_payload = response_payload.get("usage")
    if not isinstance(usage_payload, dict):
        return None

    input_tokens = coerce_int(usage_payload.get("input_tokens"))
    output_tokens = coerce_int(usage_payload.get("output_tokens"))
    total_tokens = coerce_int(usage_payload.get("total_tokens"))

    cached_input_tokens = None
    input_details = usage_payload.get("input_tokens_details")
    if isinstance(input_details, dict):
        cached_input_tokens = coerce_int(input_details.get("cached_tokens"))

    reasoning_tokens = None
    output_details = usage_payload.get("output_tokens_details")
    if isinstance(output_details, dict):
        reasoning_tokens = coerce_int(output_details.get("reasoning_tokens"))

    if total_tokens is None and input_tokens is not None and output_tokens is not None:
        total_tokens = input_tokens + output_tokens

    if all(
        value is None for value in (input_tokens, output_tokens, total_tokens, cached_input_tokens, reasoning_tokens)
    ):
        return None

    usage_cost = price_usage(
        input_tokens,
        output_tokens,
        cached_input_tokens,
        model,
        pricing_overrides=pricing_overrides,
    )

    return AiUsage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        cached_input_tokens=cached_input_tokens,
        reasoning_tokens=reasoning_tokens,
        input_cost_usd=usage_cost.input_cost_usd,
        output_cost_usd=usage_cost.output_cost_usd,
        total_cost_usd=usage_cost.total_cost_usd,
        pricing_model=usage_cost.pricing_model,
        estimated=True,
    )


def extract_anthropic_usage_metrics(
    response_payload: dict[str, object],
    *,
    model: str,
    pricing_overrides: dict[str, ModelPricing] | None = None,
) -> AiUsage | None:
    usage_payload = response_payload.get("usage")
    if not isinstance(usage_payload, dict):
        return None

    request_input_tokens = coerce_int(usage_payload.get("input_tokens"))
    cache_creation_input_tokens = coerce_int(usage_payload.get("cache_creation_input_tokens"))
    cache_read_input_tokens = coerce_int(usage_payload.get("cache_read_input_tokens"))
    output_tokens = coerce_int(usage_payload.get("output_tokens"))

    input_token_parts = [
        value
        for value in (request_input_tokens, cache_creation_input_tokens, cache_read_input_tokens)
        if value is not None
    ]
    input_tokens = sum(input_token_parts) if input_token_parts else None
    cached_input_tokens = cache_read_input_tokens
    total_tokens = None
    if input_tokens is not None and output_tokens is not None:
        total_tokens = input_tokens + output_tokens

    if input_tokens is None and output_tokens is None:
        return None

    usage_cost = price_usage(
        input_tokens,
        output_tokens,
        cached_input_tokens,
        model,
        pricing_overrides=pricing_overrides,
    )

    return AiUsage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        cached_input_tokens=cached_input_tokens,
        reasoning_tokens=None,
        input_cost_usd=usage_cost.input_cost_usd,
        output_cost_usd=usage_cost.output_cost_usd,
        total_cost_usd=usage_cost.total_cost_usd,
        pricing_model=usage_cost.pricing_model,
        estimated=True,
    )


def extract_chat_completion_usage_metrics(
    response_payload: dict[str, object],
    *,
    model: str,
    pricing_overrides: dict[str, ModelPricing] | None = None,
) -> AiUsage | None:
    usage_payload = response_payload.get("usage")
    if not isinstance(usage_payload, dict):
        return None

    input_tokens = coerce_int(usage_payload.get("prompt_tokens"))
    output_tokens = coerce_int(usage_payload.get("completion_tokens"))
    total_tokens = coerce_int(usage_payload.get("total_tokens"))

    cached_input_tokens = None
    prompt_details = usage_payload.get("prompt_tokens_details")
    if isinstance(prompt_details, dict):
        cached_input_tokens = coerce_int(prompt_details.get("cached_tokens"))

    if total_tokens is None and input_tokens is not None and output_tokens is not None:
        total_tokens = input_tokens + output_tokens

    if all(value is None for value in (input_tokens, output_tokens, total_tokens, cached_input_tokens)):
        return None

    usage_cost = price_usage(
        input_tokens,
        output_tokens,
        cached_input_tokens,
        model,
        pricing_overrides=pricing_overrides,
    )

    return AiUsage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        cached_input_tokens=cached_input_tokens,
        reasoning_tokens=None,
        input_cost_usd=usage_cost.input_cost_usd,
        output_cost_usd=usage_cost.output_cost_usd,
        total_cost_usd=usage_cost.total_cost_usd,
        pricing_model=usage_cost.pricing_model,
        estimated=True,
    )


def coerce_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    return None


def coerce_float(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def extract_output_text(response_payload: dict[str, object]) -> str:
    output_text = response_payload.get("output_text")
    if isinstance(output_text, str):
        return output_text

    output = response_payload.get("output")
    if not isinstance(output, list):
        return ""

    fragments: list[str] = []
    for item in output:
        if not isinstance(item, dict):
            continue
        content = item.get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            if not isinstance(part, dict):
                continue
            if part.get("type") in {"output_text", "text"}:
                text = part.get("text")
                if isinstance(text, str):
                    fragments.append(text)
    return "".join(fragments)


def extract_chat_completion_tool_input(response_payload: dict[str, object], *, tool_name: str) -> dict[str, object] | None:
    choices = response_payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return None

    first_choice = choices[0]
    if not isinstance(first_choice, dict):
        return None
    message = first_choice.get("message")
    if not isinstance(message, dict):
        return None

    tool_calls = message.get("tool_calls")
    if not isinstance(tool_calls, list):
        return None

    for tool_call in tool_calls:
        if not isinstance(tool_call, dict):
            continue
        function_payload = tool_call.get("function")
        if not isinstance(function_payload, dict):
            continue
        if function_payload.get("name") != tool_name:
            continue
        arguments = function_payload.get("arguments")
        if isinstance(arguments, dict):
            return arguments
        if isinstance(arguments, str):
            try:
                payload = json.loads(arguments)
            except json.JSONDecodeError:
                return None
            if isinstance(payload, dict):
                return payload
    return None


def extract_chat_completion_text(response_payload: dict[str, object]) -> str:
    choices = response_payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""

    first_choice = choices[0]
    if not isinstance(first_choice, dict):
        return ""
    message = first_choice.get("message")
    if not isinstance(message, dict):
        return ""

    content = message.get("content")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""

    fragments: list[str] = []
    for part in content:
        if isinstance(part, str):
            fragments.append(part)
            continue
        if not isinstance(part, dict):
            continue
        text = part.get("text")
        if isinstance(text, str):
            fragments.append(text)
    return "".join(fragments)


def extract_chat_completion_model(response_payload: dict[str, object]) -> str | None:
    model = response_payload.get("model")
    if isinstance(model, str) and model:
        return model
    return None


def extract_message_style_model(response_payload: dict[str, object]) -> str | None:
    model = response_payload.get("model")
    if isinstance(model, str) and model:
        return model
    return None


def extract_anthropic_tool_input(response_payload: dict[str, object], *, tool_name: str) -> dict[str, object] | None:
    content = response_payload.get("content")
    if not isinstance(content, list):
        return None

    for part in content:
        if not isinstance(part, dict):
            continue
        if part.get("type") != "tool_use":
            continue
        if part.get("name") != tool_name:
            continue
        payload = part.get("input")
        if isinstance(payload, dict):
            return payload
    return None


def extract_anthropic_text(response_payload: dict[str, object]) -> str:
    content = response_payload.get("content")
    if not isinstance(content, list):
        return ""

    fragments: list[str] = []
    for part in content:
        if not isinstance(part, dict):
            continue
        if part.get("type") != "text":
            continue
        text = part.get("text")
        if isinstance(text, str):
            fragments.append(text)
    return "".join(fragments)


def resolve_reasoning_text(raw_reasoning: str, *, provider_name: str, action_summary: str) -> str:
    reasoning = raw_reasoning.strip()
    if reasoning:
        return reasoning
    return f"{provider_display_name(provider_name)} selected {action_summary}; the provider did not supply reasoning."


def resolve_visual_observations_text(raw_text: str, *, provider_name: str) -> str:
    visual_observations = raw_text.strip()
    if visual_observations:
        return visual_observations
    return f"{provider_display_name(provider_name)} did not return separate visual observations for this text-only turn."
