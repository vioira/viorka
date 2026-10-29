#!/usr/bin/env python3
"""Check local references and all declared JSON schemas, not HTTP behavior."""
from pathlib import Path
import yaml
from jsonschema import Draft202012Validator
root=Path(__file__).resolve().parents[1]
doc=yaml.safe_load((root/'api/openapi/openapi.yaml').read_text())
def walk(value):
    if isinstance(value,dict):
        if '$ref' in value:
            target=doc
            for part in value['$ref'].removeprefix('#/').split('/'):target=target[part]
        for child in value.values():walk(child)
    elif isinstance(value,list):
        for child in value:walk(child)
walk(doc)
for schema in doc['components']['schemas'].values():Draft202012Validator.check_schema(schema)
assert '/api/v1/agents/ws' in doc['paths']
print('OpenAPI references and component schemas OK')
