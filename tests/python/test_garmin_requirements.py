import unittest
from pathlib import Path

from pip._vendor.packaging.markers import default_environment
from pip._vendor.packaging.requirements import Requirement
from pip._vendor.packaging.utils import canonicalize_name


REQUIREMENTS_PATH = Path(__file__).parents[2] / "requirements.txt"


def selected_requirements(python_version: str) -> dict[str, str]:
    environment = default_environment()
    environment["python_version"] = python_version
    selected: dict[str, str] = {}
    for line in REQUIREMENTS_PATH.read_text(encoding="utf-8").splitlines():
        value = line.strip()
        if not value or value.startswith("#"):
            continue
        requirement = Requirement(value)
        if requirement.marker is None or requirement.marker.evaluate(environment):
            selected[canonicalize_name(requirement.name)] = str(requirement.specifier)
    return selected


class GarminRequirementsTests(unittest.TestCase):
    def test_selects_verified_cffi_for_local_and_production_python(self):
        production = selected_requirements("3.12")
        local = selected_requirements("3.14")

        self.assertEqual(production["cffi"], "==2.1.0")
        self.assertEqual(local["cffi"], "==2.0.0")
        self.assertEqual(production["garminconnect"], "==0.3.6")
        self.assertEqual(local["garminconnect"], "==0.3.6")
        self.assertEqual(production["curl-cffi"], "==0.15.0")
        self.assertEqual(local["curl-cffi"], "==0.15.0")


if __name__ == "__main__":
    unittest.main()
