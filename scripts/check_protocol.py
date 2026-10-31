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
from jsonschema import Draft202012Validator, FormatChecker
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema, format_checker=FormatChecker())
payload_types = {'node.metrics_batch':'NodeMetricsBatch','node.inventory':'NodeInventory','node.metrics':'NodeMetrics','system.hello':'Hello','system.hello_ack':'HelloAck','node.heartbeat':'Heartbeat','task.dispatch':'TaskDispatch','task.ack':'TaskReply','task.result':'TaskReply'}
for file in examples:
    data=json.loads(file.read_text());validator.validate(data)
    if data['type'] in payload_types:
        sub={'$ref':'#/$defs/'+payload_types[data['type']], '$defs':schema['$defs']}
        Draft202012Validator(sub, format_checker=FormatChecker()).validate(data['payload'])
# Legacy proxy.apply example remains valid schema, but is not an authorized M0 operation.
assert json.loads((root/'api/agent/v1/examples/task.dispatch.json').read_text())['payload']['operation']=='proxy.apply'
print(f'Agent envelope and typed payload schemas: {len(examples)} examples OK')
