import importlib.util
import json
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[2] / "api" / "garmin-runtime.py"
SPEC = importlib.util.spec_from_file_location("garmin_runtime", MODULE_PATH)
assert SPEC and SPEC.loader
RUNTIME = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNTIME)


def credential():
    return {
        "schemaVersion": 1,
        "client": "python-garminconnect",
        "clientVersion": "0.3.6",
        "region": "global",
        "tokenBundle": json.dumps(
            {
                "di_token": "anonymous-access-token",
                "di_refresh_token": "anonymous-refresh-token",
                "di_client_id": "anonymous-client-id",
            }
        ),
    }


def request():
    return json.dumps(
        {
            "schemaVersion": 1,
            "operation": "preview_activities",
            "client": "python-garminconnect",
            "clientVersion": "0.3.6",
            "date": "2026-07-24",
            "credential": credential(),
        }
    ).encode()


class GarminRuntimeTests(unittest.TestCase):
    def test_rejects_missing_internal_authorization_before_reading_tokens(self):
        calls = []
        status, body = RUNTIME.execute_request(
            request(), None, "anonymous-internal-secret", lambda *_args: calls.append(True)
        )

        self.assertEqual(status, 401)
        self.assertEqual(body, {"ok": False, "errorCode": "authentication"})
        self.assertEqual(calls, [])

    def test_projects_only_safe_activity_fields_and_refreshed_tokens(self):
        raw_activity = {
            "activityId": 123,
            "activityType": {"typeKey": "running", "private": "metadata"},
            "startTimeGMT": "2026-07-24 00:30:00",
            "duration": 1800.0,
            "distance": 3000.0,
            "averageSpeed": 8.333333,
            "averageHR": 128.4,
            "privatePayload": {"health": "not-returned"},
        }
        refreshed = credential()["tokenBundle"]
        status, body = RUNTIME.execute_request(
            request(),
            "Bearer anonymous-internal-secret",
            "anonymous-internal-secret",
            lambda imported, date: ([raw_activity], refreshed),
        )

        self.assertEqual(status, 200)
        self.assertEqual(body["schemaVersion"], 1)
        self.assertEqual(body["clientVersion"], "0.3.6")
        self.assertEqual(
            body["activities"],
            [
                {
                    "providerRecordId": "123",
                    "activityType": "running",
                    "startedAt": "2026-07-24T00:30:00Z",
                    "durationSeconds": 1800.0,
                    "distanceMeters": 3000.0,
                    "averagePaceSecondsPerKilometer": 120.0000048000002,
                    "averageHeartRateBpm": 128,
                }
            ],
        )
        self.assertEqual(body["refreshedTokenBundle"], refreshed)
        self.assertNotIn("privatePayload", json.dumps(body))

    def test_rejects_extra_or_incomplete_token_fields(self):
        malformed = json.loads(request())
        malformed["credential"]["tokenBundle"] = json.dumps(
            {"di_token": "anonymous", "password": "not-allowed"}
        )
        calls = []

        status, body = RUNTIME.execute_request(
            json.dumps(malformed).encode(),
            "Bearer anonymous-internal-secret",
            "anonymous-internal-secret",
            lambda *_args: calls.append(True),
        )

        self.assertEqual(status, 400)
        self.assertEqual(body, {"ok": False, "errorCode": "invalid_token_bundle"})
        self.assertEqual(calls, [])

    def test_returns_only_classified_provider_failures(self):
        def fail(*_args):
            raise RUNTIME.SafeRuntimeError("rate_limited")

        status, body = RUNTIME.execute_request(
            request(),
            "Bearer anonymous-internal-secret",
            "anonymous-internal-secret",
            fail,
        )

        self.assertEqual(status, 429)
        self.assertEqual(body, {"ok": False, "errorCode": "rate_limited"})
        self.assertNotIn("provider", json.dumps(body))


if __name__ == "__main__":
    unittest.main()
