#!/usr/bin/env sh
set -eu
venv=cache/release-python
if [ ! -x "$venv/bin/python3" ]; then
    "$1" -m venv "$venv"
fi
"$venv/bin/python3" -m pip --disable-pip-version-check install -r scripts/requirements-dev.txt
"$venv/bin/python3" -c 'from jsonschema import Draft202012Validator; import yaml'
