#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/../web"
pnpm run typecheck
pnpm run test
