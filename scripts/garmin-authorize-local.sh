#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/ak-garmin-auth.XXXXXX")"
trap 'exit_code=$?; rm -rf "$runtime_dir"; exit "$exit_code"' EXIT

python_bin="${PYTHON_BIN:-python3}"
python_version="$("$python_bin" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")')"
if ! "$python_bin" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)'; then
  echo "本机授权需要 Python 3.12 或更高版本（当前 ${python_version}）。" >&2
  exit 2
fi

printf '本机授权运行时 Python %s\n' "$python_version"
"$python_bin" -m venv "$runtime_dir/venv"
"$runtime_dir/venv/bin/python" -m pip install --quiet --disable-pip-version-check -r "$repo_dir/scripts/requirements-garmin-local.txt"
"$runtime_dir/venv/bin/python" "$repo_dir/scripts/garmin_authorize_local.py" "$@"
