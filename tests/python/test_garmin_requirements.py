import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from pip._vendor.packaging.markers import default_environment
from pip._vendor.packaging.requirements import Requirement
from pip._vendor.packaging.utils import canonicalize_name


REPO_ROOT = Path(__file__).parents[2]
PRODUCTION_REQUIREMENTS_PATH = REPO_ROOT / "requirements.txt"
LOCAL_REQUIREMENTS_PATH = REPO_ROOT / "scripts" / "requirements-garmin-local.txt"
AUTHORIZE_SCRIPT_PATH = REPO_ROOT / "scripts" / "garmin-authorize-local.sh"


def selected_requirements(path: Path, python_version: str) -> dict[str, str]:
    environment = default_environment()
    environment["python_version"] = python_version
    selected: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        value = line.strip()
        if not value or value.startswith("#"):
            continue
        requirement = Requirement(value)
        if requirement.marker is None or requirement.marker.evaluate(environment):
            selected[canonicalize_name(requirement.name)] = str(requirement.specifier)
    return selected


class GarminRequirementsTests(unittest.TestCase):
    def test_local_authorizer_uses_only_its_local_dependency_lock(self):
        script = AUTHORIZE_SCRIPT_PATH.read_text(encoding="utf-8")

        self.assertIn("scripts/requirements-garmin-local.txt", script)
        self.assertNotIn('$repo_dir/requirements.txt', script)

    def test_local_and_production_locks_do_not_change_with_python_version(self):
        for python_version in ("3.12", "3.13", "3.14"):
            with self.subTest(python_version=python_version):
                production = selected_requirements(
                    PRODUCTION_REQUIREMENTS_PATH, python_version
                )
                local = selected_requirements(LOCAL_REQUIREMENTS_PATH, python_version)

                self.assertEqual(production["cffi"], "==2.1.0")
                self.assertEqual(local["cffi"], "==2.0.0")
                self.assertEqual(production["garminconnect"], "==0.3.6")
                self.assertEqual(local["garminconnect"], "==0.3.6")
                self.assertEqual(production["curl-cffi"], "==0.15.0")
                self.assertEqual(local["curl-cffi"], "==0.15.0")
                self.assertEqual(production.keys(), local.keys())

    def test_local_authorizer_rejects_python_older_than_3_12_before_venv(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            fake_python = Path(temporary_directory) / "python3"
            fake_python.write_text(
                """#!/usr/bin/env python3
import sys

if len(sys.argv) >= 3 and sys.argv[1] == "-c":
    if "print(" in sys.argv[2]:
        print("3.11.9")
        raise SystemExit(0)
    raise SystemExit(1)
raise SystemExit(99)
""",
                encoding="utf-8",
            )
            fake_python.chmod(0o700)
            environment = os.environ.copy()
            environment["PYTHON_BIN"] = str(fake_python)

            result = subprocess.run(
                [str(AUTHORIZE_SCRIPT_PATH), "--region", "china"],
                capture_output=True,
                check=False,
                env=environment,
                errors="replace",
                text=True,
            )

        self.assertEqual(
            result.returncode,
            2,
            msg=f"stdout={result.stdout!r} stderr={result.stderr!r}",
        )
        self.assertIn("需要 Python 3.12 或更高版本", result.stderr)
        self.assertNotIn("Token", result.stdout)


if __name__ == "__main__":
    unittest.main()
