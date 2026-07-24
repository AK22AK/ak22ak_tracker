#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/ak-garmin-auth.XXXXXX")"
trap 'rm -rf "$runtime_dir"' EXIT

python_bin="${PYTHON_BIN:-python3}"
"$python_bin" -m venv "$runtime_dir/venv"
"$runtime_dir/venv/bin/python" -m pip install --quiet --disable-pip-version-check -r "$repo_dir/requirements.txt"
"$runtime_dir/venv/bin/python" "$repo_dir/scripts/garmin_authorize_local.py" "$@"
