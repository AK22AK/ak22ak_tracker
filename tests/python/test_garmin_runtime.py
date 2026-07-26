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


def wellness_request():
    value = json.loads(request())
    value["operation"] = "read_daily_wellness"
    return json.dumps(value).encode()


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

    def test_projects_daily_steps_and_sleep_through_a_strict_whitelist(self):
        refreshed = credential()["tokenBundle"]
        raw_summary = {
            "calendarDate": "2026-07-24",
            "totalSteps": 0,
            "dailyStepGoal": 8000,
            "totalKilocalories": 2100,
            "bodyBatteryHighestValue": 72,
        }
        raw_sleep = {
            "dailySleepDTO": {
                "calendarDate": "2026-07-24",
                "sleepStartTimestampGMT": 1784844000000,
                "sleepEndTimestampGMT": 1784872800000,
                "sleepTimeSeconds": 27000,
                "deepSleepSeconds": 3600,
                "lightSleepSeconds": 16200,
                "remSleepSeconds": 5400,
                "awakeSleepSeconds": 1800,
                "sleepScores": {
                    "overall": {"value": 81, "private": "not-returned"}
                },
                "avgSpO2": 97,
            },
            "sleepMovement": [{"private": "not-returned"}],
        }

        status, body = RUNTIME.execute_request(
            wellness_request(),
            "Bearer anonymous-internal-secret",
            "anonymous-internal-secret",
            wellness_reader=lambda _credential, _date: (
                raw_summary,
                raw_sleep,
                refreshed,
            ),
        )

        self.assertEqual(status, 200)
        self.assertEqual(
            body["wellness"],
            {
                "localDate": "2026-07-24",
                "steps": {
                    "status": "available",
                    "totalSteps": 0,
                    "stepGoal": 8000,
                },
                "sleep": {
                    "status": "available",
                    "sleepStart": "2026-07-23T22:00:00Z",
                    "sleepEnd": "2026-07-24T06:00:00Z",
                    "totalSleepSeconds": 27000,
                    "deepSleepSeconds": 3600,
                    "lightSleepSeconds": 16200,
                    "remSleepSeconds": 5400,
                    "awakeSleepSeconds": 1800,
                    "sleepScore": 81,
                },
            },
        )
        serialized = json.dumps(body)
        for forbidden in (
            "totalKilocalories",
            "bodyBattery",
            "avgSpO2",
            "sleepMovement",
            "private",
        ):
            self.assertNotIn(forbidden, serialized)

    def test_preserves_missing_wellness_without_inventing_zeroes(self):
        status, body = RUNTIME.execute_request(
            wellness_request(),
            "Bearer anonymous-internal-secret",
            "anonymous-internal-secret",
            wellness_reader=lambda _credential, _date: (
                {"calendarDate": "2026-07-24"},
                {"dailySleepDTO": None},
                credential()["tokenBundle"],
            ),
        )

        self.assertEqual(status, 200)
        self.assertEqual(body["wellness"]["steps"]["status"], "missing")
        self.assertIsNone(body["wellness"]["steps"]["totalSteps"])
        self.assertEqual(body["wellness"]["sleep"]["status"], "missing")
        self.assertIsNone(body["wellness"]["sleep"]["totalSleepSeconds"])

    def test_rejects_invalid_or_cross_date_wellness_and_classifies_reader_failure(self):
        invalid_values = [
            (
                {"calendarDate": "2026-07-23", "totalSteps": 100},
                {"dailySleepDTO": None},
            ),
            (
                {"calendarDate": "2026-07-24", "totalSteps": -1},
                {"dailySleepDTO": None},
            ),
            (
                {"calendarDate": "2026-07-24", "totalSteps": 100},
                {
                    "dailySleepDTO": {
                        "calendarDate": "2026-07-24",
                        "sleepStartTimestampGMT": 1784872800000,
                        "sleepEndTimestampGMT": 1784844000000,
                        "sleepTimeSeconds": 100,
                    }
                },
            ),
            (
                {"calendarDate": "2026-07-24", "totalSteps": 1000001},
                {"dailySleepDTO": None},
            ),
            (
                {"calendarDate": "2026-07-24", "totalSteps": 100},
                {
                    "dailySleepDTO": {
                        "calendarDate": "2026-07-24",
                        "sleepTimeSeconds": -1,
                    }
                },
            ),
            (
                {"calendarDate": "2026-07-24", "totalSteps": 100},
                {
                    "dailySleepDTO": {
                        "calendarDate": "2026-07-24",
                        "sleepTimeSeconds": 100,
                        "sleepScores": {"overall": {"value": 101}},
                    }
                },
            ),
        ]
        for summary, sleep in invalid_values:
            status, body = RUNTIME.execute_request(
                wellness_request(),
                "Bearer anonymous-internal-secret",
                "anonymous-internal-secret",
                wellness_reader=lambda _credential, _date, s=summary, p=sleep: (
                    s,
                    p,
                    credential()["tokenBundle"],
                ),
            )
            self.assertEqual(status, 502)
            self.assertEqual(body, {"ok": False, "errorCode": "invalid_response"})

        def fail_after_summary(*_args):
            raise RUNTIME.SafeRuntimeError("timeout")

        status, body = RUNTIME.execute_request(
            wellness_request(),
            "Bearer anonymous-internal-secret",
            "anonymous-internal-secret",
            wellness_reader=fail_after_summary,
        )
        self.assertEqual(status, 504)
        self.assertEqual(body, {"ok": False, "errorCode": "timeout"})


if __name__ == "__main__":
    unittest.main()
