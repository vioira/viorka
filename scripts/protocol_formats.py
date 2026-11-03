"""Formats used by protocol checks, without optional jsonschema extras."""
from datetime import datetime
import re
from jsonschema import FormatChecker

FORMATS = FormatChecker()


@FORMATS.checks('date-time', raises=ValueError)
def rfc3339(value):
    if not isinstance(value, str):
        return True  # The schema's type constraint rejects this separately.
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})', value):
        return False
    return datetime.fromisoformat(value.replace('Z', '+00:00')).tzinfo is not None
