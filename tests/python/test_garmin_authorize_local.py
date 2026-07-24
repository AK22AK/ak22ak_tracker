import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[2] / "scripts" / "garmin_authorize_local.py"
SPEC = importlib.util.spec_from_file_location("garmin_authorize_local", MODULE_PATH)
assert SPEC and SPEC.loader
AUTHORIZER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUTHORIZER)


class GarminLocalAuthorizerTests(unittest.TestCase):
    def test_writes_only_the_strict_token_envelope_with_owner_permissions(self):
        token_bundle = json.dumps(
            {
                "di_token": "anonymous-access-token",
                "di_refresh_token": "anonymous-refresh-token",
                "di_client_id": "anonymous-client-id",
            }
        )
        envelope = AUTHORIZER.build_envelope(token_bundle, "global")
        self.assertEqual(set(envelope), {
            "schemaVersion", "client", "clientVersion", "region", "tokenBundle"
        })
        self.assertNotIn("password", envelope)

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "private" / "garmin-token.json"
            AUTHORIZER.write_private_json(output, envelope)

            self.assertEqual(os.stat(output).st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(output.read_text()), envelope)

    def test_rejects_extra_private_fields(self):
        with self.assertRaisesRegex(ValueError, "invalid_token_bundle"):
            AUTHORIZER.build_envelope(
                json.dumps(
                    {
                        "di_token": "anonymous-access-token",
                        "di_refresh_token": "anonymous-refresh-token",
                        "di_client_id": "anonymous-client-id",
                        "password": "not-allowed",
                    }
                ),
                "global",
            )


if __name__ == "__main__":
    unittest.main()
