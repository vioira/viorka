#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
if [ -n "$(gofmt -l $(find . -name '*.go' -type f))" ]; then
  echo 'Go files need formatting (gofmt).' >&2
  exit 1
fi
go test ./...
go vet ./...
go build -o /tmp/viorka-scaffold-server ./cmd/server
python3 -m json.tool api/agent/v1/envelope.schema.json >/dev/null
python3 -m json.tool api/agent/v1/examples/task.dispatch.json >/dev/null
python3 -m json.tool api/agent/v1/examples/config.observed.json >/dev/null
python3 scripts/check_schema.py
python3 scripts/check_protocol.py
python3 scripts/generate_protocol.py --check
go run ./cmd/openapi -check
python3 scripts/check_openapi.py
echo 'Viorka M0 checks OK (Web and race checks run separately)'
