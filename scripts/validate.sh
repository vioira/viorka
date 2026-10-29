#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
if [ -n "$(gofmt -l $(find . -name '*.go' -type f))" ]; then
  echo 'Go files need formatting (gofmt).' >&2
  exit 1
fi
go test ./...
go build -o /tmp/viorka-scaffold-server ./cmd/server
python3 -m json.tool api/agent/v1/envelope.schema.json >/dev/null
python3 -m json.tool api/agent/v1/examples/task.dispatch.json >/dev/null
python3 -m json.tool api/agent/v1/examples/config.observed.json >/dev/null
python3 scripts/check_schema.py
python3 scripts/check_protocol.py
echo 'Viorka scaffold check OK (web dependencies checked by GitHub Actions)'
