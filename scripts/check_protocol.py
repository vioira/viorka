#!/usr/bin/env python3
"""Validate protocol schema, examples and planned message naming."""
from pathlib import Path
import json
import re

root = Path(__file__).resolve().parents[1]
schema = json.loads((root / 'api/agent/v1/envelope.schema.json').read_text())
allowed_type = re.compile(schema['properties']['type']['pattern'])
assert allowed_type.fullmatch('system.hello_ack'), 'message pattern must accept planned names'
assert allowed_type.fullmatch('task.dispatch')
assert not allowed_type.fullmatch('shell.exec; rm -rf /')
examples = list((root / 'api/agent/v1/examples').glob('*.json'))
assert examples, 'no contract examples found'
required = set(schema['required'])
for file in examples:
    data = json.loads(file.read_text())
    assert required <= data.keys(), (file, required - data.keys())
    assert data['version'] == schema['properties']['version']['const'], file
    assert allowed_type.fullmatch(data['type']), file
    assert isinstance(data['payload'], dict), file
try:
    from jsonschema import Draft202012Validator
except ImportError:
    print('jsonschema not installed; passed stdlib fallback checks')
else:
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)
    for file in examples:
        validator.validate(json.loads(file.read_text()))
print(f'Agent protocol schema and {len(examples)} examples OK')
