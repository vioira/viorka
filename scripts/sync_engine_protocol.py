#!/usr/bin/env python3
"""Synchronize the engine contract helpers and pinned catalog, without network IO."""
import argparse
from pathlib import Path
root = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser()
p.add_argument('--check', action='store_true')
p.add_argument('--agent', type=Path, default=root.parent / 'viorka-agent')
a = p.parse_args()
pairs = [(root / 'api/agent/v1/engine-releases.json', root / 'protocol/v1/engine-releases.json')]
for name in ['engine.go', 'engine_catalog.go']:
    pairs.append((root / 'protocol/v1' / name, a.agent / 'protocol/v1' / name))
pairs += [(root / 'api/agent/v1/engine-releases.json', a.agent / 'protocol/v1/engine-releases.json'), (root / 'api/agent/v1/envelope.schema.json', a.agent / 'protocol/v1/envelope.schema.json')]
for source, target in pairs:
    if a.check:
        if not target.exists() or source.read_bytes() != target.read_bytes():
            raise SystemExit(f'engine contract drift: {target}')
    else:
        target.write_bytes(source.read_bytes())
print('Engine contracts synchronized' if not a.check else 'Engine contracts match')
