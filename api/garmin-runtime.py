"""Server-only Garmin token runtime for Vercel Python Functions."""

from __future__ import annotations

import hmac
import json
import os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from typing import Any, Callable


SCHEMA_VERSION = 1
CLIENT_ID = "python-garminconnect"
CLIENT_VERSION = "0.3.6"
MAX_REQUEST_BYTES = 160 * 1024
MAX_ACTIVITIES = 100
TOKEN_KEYS = {"di_token", "di_refresh_token", "di_client_id"}
REQUEST_KEYS = {
    "schemaVersion",
    "operation",
    "client",
    "clientVersion",
    "date",
    "credential",
}
CREDENTIAL_KEYS = {
    "schemaVersion",
    "client",
    "clientVersion",
    "region",
    "tokenBundle",
}


class SafeRuntimeError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _exact_object(value: Any, keys: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise SafeRuntimeError("invalid_response")
    return value


def _nonempty_string(value: Any, maximum: int) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise SafeRuntimeError("invalid_token_bundle")
    return value


def _parse_date(value: Any) -> str:
    if not isinstance(value, str):
        raise SafeRuntimeError("invalid_response")
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d")
    except ValueError as error:
        raise SafeRuntimeError("invalid_response") from error
    if parsed.strftime("%Y-%m-%d") != value:
        raise SafeRuntimeError("invalid_response")
    return value


def _parse_credential(value: Any) -> dict[str, Any]:
    credential = _exact_object(value, CREDENTIAL_KEYS)
    if (
        credential["schemaVersion"] != 1
        or credential["client"] != CLIENT_ID
        or credential["clientVersion"] != CLIENT_VERSION
        or credential["region"] not in {"global", "china"}
    ):
        raise SafeRuntimeError("unsupported_client_version")
    token_bundle = _nonempty_string(credential["tokenBundle"], 131_072)
    try:
        tokens = _exact_object(json.loads(token_bundle), TOKEN_KEYS)
    except (json.JSONDecodeError, SafeRuntimeError) as error:
        raise SafeRuntimeError("invalid_token_bundle") from error
    for key in TOKEN_KEYS:
        _nonempty_string(tokens[key], 32_768 if key != "di_client_id" else 2_048)
    return credential


def _parse_request(raw: bytes) -> dict[str, Any]:
    if not raw or len(raw) > MAX_REQUEST_BYTES:
        raise SafeRuntimeError("invalid_response")
    try:
        request = _exact_object(json.loads(raw), REQUEST_KEYS)
    except (UnicodeDecodeError, json.JSONDecodeError, SafeRuntimeError) as error:
        raise SafeRuntimeError("invalid_response") from error
    if (
        request["schemaVersion"] != SCHEMA_VERSION
        or request["operation"] != "preview_activities"
        or request["client"] != CLIENT_ID
        or request["clientVersion"] != CLIENT_VERSION
    ):
        raise SafeRuntimeError("unsupported_client_version")
    request["date"] = _parse_date(request["date"])
    request["credential"] = _parse_credential(request["credential"])
    return request


def _number(value: Any, *, maximum: float, optional: bool = False) -> float | None:
    if value is None and optional:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SafeRuntimeError("invalid_response")
    result = float(value)
    if result < 0 or result > maximum:
        raise SafeRuntimeError("invalid_response")
    return result


def _started_at(value: Any) -> str:
    if not isinstance(value, str) or not value:
        raise SafeRuntimeError("invalid_response")
    normalized = value.replace("Z", "+00:00")
    if "T" not in normalized and " " in normalized:
        normalized = normalized.replace(" ", "T", 1)
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as error:
        raise SafeRuntimeError("invalid_response") from error
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _activity_type(value: Any) -> str:
    if isinstance(value, dict):
        value = value.get("typeKey") or value.get("key")
    if not isinstance(value, str) or not value or len(value) > 100:
        raise SafeRuntimeError("invalid_response")
    return value


def _normalize_activity(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise SafeRuntimeError("invalid_response")
    record_id = raw.get("activityId")
    if isinstance(record_id, bool) or not isinstance(record_id, (str, int)):
        raise SafeRuntimeError("invalid_response")
    record_id = str(record_id)
    if not record_id or len(record_id) > 200:
        raise SafeRuntimeError("invalid_response")

    duration = _number(raw.get("duration"), maximum=604_800)
    distance = _number(raw.get("distance"), maximum=10_000_000, optional=True)
    average_speed = _number(
        raw.get("averageSpeed"), maximum=100, optional=True
    )
    pace = None
    if average_speed is not None and average_speed > 0:
        pace = 1_000 / average_speed
    elif distance is not None and distance > 0 and duration is not None:
        pace = duration / (distance / 1_000)
    if pace is not None and (pace <= 0 or pace > 86_400):
        raise SafeRuntimeError("invalid_response")

    average_hr = _number(raw.get("averageHR"), maximum=300, optional=True)
    return {
        "providerRecordId": record_id,
        "activityType": _activity_type(raw.get("activityType")),
        "startedAt": _started_at(raw.get("startTimeGMT")),
        "durationSeconds": duration,
        "distanceMeters": distance,
        "averagePaceSecondsPerKilometer": pace,
        "averageHeartRateBpm": round(average_hr) if average_hr is not None else None,
    }


def _read_activities(credential: dict[str, Any], date: str) -> tuple[list[Any], str]:
    try:
        from garminconnect import (  # type: ignore[import-not-found]
            Garmin,
            GarminConnectAuthenticationError,
            GarminConnectConnectionError,
            GarminConnectTooManyRequestsError,
        )
    except ImportError as error:
        raise SafeRuntimeError("provider_unavailable") from error

    try:
        garmin = Garmin(
            is_cn=credential["region"] == "china",
            retry_attempts=0,
            verify_login=True,
        )
        garmin.client.loads(credential["tokenBundle"])
        activities = garmin.get_activities_by_date(date, date, sortorder="asc")
        return activities, garmin.client.dumps()
    except GarminConnectAuthenticationError as error:
        raise SafeRuntimeError("authentication") from error
    except GarminConnectTooManyRequestsError as error:
        raise SafeRuntimeError("rate_limited") from error
    except (TimeoutError, ConnectionError) as error:
        raise SafeRuntimeError("timeout") from error
    except GarminConnectConnectionError as error:
        raise SafeRuntimeError("provider_unavailable") from error
    except SafeRuntimeError:
        raise
    except Exception as error:
        raise SafeRuntimeError("provider_unavailable") from error


def execute_request(
    raw: bytes,
    authorization: str | None,
    expected_secret: str | None,
    reader: Callable[[dict[str, Any], str], tuple[list[Any], str]] = _read_activities,
) -> tuple[int, dict[str, Any]]:
    if (
        not expected_secret
        or not authorization
        or not authorization.startswith("Bearer ")
        or not hmac.compare_digest(authorization[7:], expected_secret)
    ):
        return 401, {"ok": False, "errorCode": "authentication"}
    try:
        request = _parse_request(raw)
        raw_activities, refreshed_token_bundle = reader(
            request["credential"], request["date"]
        )
        if not isinstance(raw_activities, list) or len(raw_activities) > MAX_ACTIVITIES:
            raise SafeRuntimeError("invalid_response")
        refreshed_credential = {
            **request["credential"],
            "tokenBundle": refreshed_token_bundle,
        }
        _parse_credential(refreshed_credential)
        return 200, {
            "ok": True,
            "schemaVersion": SCHEMA_VERSION,
            "clientVersion": CLIENT_VERSION,
            "activities": [_normalize_activity(item) for item in raw_activities],
            "refreshedTokenBundle": refreshed_token_bundle,
        }
    except SafeRuntimeError as error:
        status = {
            "invalid_token_bundle": 400,
            "unsupported_client_version": 400,
            "authentication": 422,
            "rate_limited": 429,
            "timeout": 504,
            "invalid_response": 502,
            "provider_unavailable": 502,
        }.get(error.code, 502)
        return status, {"ok": False, "errorCode": error.code}


class handler(BaseHTTPRequestHandler):
    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def _respond(self, status: int, body: dict[str, Any]) -> None:
        payload = json.dumps(body, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self) -> None:
        content_length = self.headers.get("Content-Length")
        try:
            length = int(content_length or "0")
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_REQUEST_BYTES:
            self._respond(413, {"ok": False, "errorCode": "invalid_response"})
            return
        raw = self.rfile.read(length)
        status, body = execute_request(
            raw,
            self.headers.get("Authorization"),
            os.environ.get("GARMIN_RUNTIME_SECRET"),
        )
        self._respond(status, body)
