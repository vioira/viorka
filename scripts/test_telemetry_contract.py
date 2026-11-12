#!/usr/bin/env python3
"""P0 executable schema contracts; no server, database or production state."""
import copy
import json
from pathlib import Path
import unittest
from jsonschema import Draft202012Validator
from protocol_formats import FORMATS

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / 'api/agent/v1/envelope.schema.json').read_text())
DEFS = SCHEMA['$defs']


def valid(name, value):
    validator = Draft202012Validator({'$ref': '#/$defs/' + name, '$defs': DEFS}, format_checker=FORMATS)
    return not list(validator.iter_errors(value))


def example(name):
    return json.loads((ROOT / 'api/agent/v1/examples' / (name + '.json')).read_text())['payload']


class TelemetryContract(unittest.TestCase):
    def test_tcp_probe_optional_extension(self):
        batch = example('node.metrics.v3.tcp_probe')
        self.assertTrue(valid('TelemetryBatch', batch))
        probe = batch['full'][0]['tcp_probes'][0]
        for key, value in [('samples', 121), ('window_seconds', 59), ('median_ms', None), ('failure_percent', 101), ('last_error', 'icmp_loss')]:
            bad = copy.deepcopy(batch)
            bad['full'][0]['tcp_probes'][0][key] = value
            self.assertFalse(valid('TelemetryBatch', bad))
        batch['full'][0]['tcp_probes'] = [probe] * 4
        self.assertFalse(valid('TelemetryBatch', batch))
        self.assertTrue(valid('TelemetryBatch', example('node.metrics.v3')))

    def test_settings_bounds_and_retired_shapes(self):
        settings = example('node.settings.v3')
        self.assertTrue(valid('TelemetrySettings', settings))
        self.assertNotIn('NodeSettings', DEFS)
        self.assertNotIn('NodeMetrics', DEFS)
        for value, expected in [(0, False), (1, True), (30, True), (60, True), (61, False), (1.5, False), ('30', False), (None, False)]:
            with self.subTest(value=value):
                self.assertEqual(valid('TelemetrySettings', dict(settings, collection_seconds=value)), expected)
        self.assertTrue(valid('TelemetrySettings', dict(settings, collection_seconds=60, http_report_seconds=30)))
        self.assertEqual(DEFS['TelemetrySettings']['properties']['collection_seconds']['default'], 30)

    def test_limits_and_unknown_fields(self):
        batch = example('node.metrics.v3')
        batch['fast'] = [batch['fast'][0]] * 300
        self.assertTrue(valid('TelemetryBatch', batch))
        batch['fast'].append(batch['fast'][0])
        self.assertFalse(valid('TelemetryBatch', batch))
        batch = example('node.metrics.v3')
        batch['fast'][0]['cpu_percent'] = 101
        self.assertFalse(valid('TelemetryBatch', batch))
        batch['fast'][0]['cpu_percent'] = None
        self.assertFalse(valid('TelemetryBatch', batch))
        batch = example('node.metrics.v3')
        batch['full'][0]['filesystems'] = [None]
        self.assertFalse(valid('TelemetryBatch', batch))
        batch = example('node.metrics.v3')
        batch['full'][0]['filesystems'] = []
        self.assertFalse(valid('TelemetryBatch', batch))
        batch = example('node.metrics.v3')
        batch['fast'][0]['shell'] = 'anything'
        self.assertFalse(valid('TelemetryBatch', batch))
        self.assertFalse(valid('TelemetryBatch', dict(example('node.metrics.v3'), fast=[], full=[], public_ip=[])))

    def test_lossless_counters_and_missing_values(self):
        batch = example('node.metrics.v3')
        iface = batch['fast'][0]['interfaces'][0]
        for counter in [2**53+1, 2**63-1]:
            iface['rx_bytes'] = counter
            encoded = json.dumps(batch)
            self.assertEqual(json.loads(encoded)['fast'][0]['interfaces'][0]['rx_bytes'], counter)
            self.assertTrue(valid('TelemetryBatch', batch))
        for counter in [-1, 2**63, 1.25, '100']:
            iface['rx_bytes'] = counter
            self.assertFalse(valid('TelemetryBatch', batch))
        batch = example('node.metrics.v3')
        del batch['fast'][0]['cpu_percent']
        self.assertTrue(valid('TelemetryBatch', batch))
        del batch['fast'][0]['sequence']
        self.assertFalse(valid('TelemetryBatch', batch))

    def test_invalid_timestamp_formats(self):
        for at in ['not-a-date', '2026-02-30T00:00:00Z', '2026-11-02T00:00:00', '2026-11-02', '2026-11-02T99:00:00Z']:
            batch = example('node.metrics.v3')
            batch['fast'][0]['sampled_at'] = at
            self.assertFalse(valid('TelemetryBatch', batch), at)

    def test_lease_and_receipt_states(self):
        demand = example('node.metrics.demand')
        self.assertTrue(valid('TelemetryDemand', demand))
        self.assertFalse(valid('TelemetryDemand', dict(demand, ttl_seconds=0)))
        self.assertFalse(valid('TelemetryDemand', dict(demand, enabled=False)))
        self.assertTrue(valid('TelemetryDemand', dict(demand, enabled=False, ttl_seconds=0)))
        receipt = example('node.metrics.receipt')
        self.assertTrue(valid('TelemetryReceipt', receipt))
        self.assertFalse(valid('TelemetryReceipt', dict(receipt, error_code='overloaded')))
        self.assertFalse(valid('TelemetryReceipt', dict(receipt, state='rejected')))
        self.assertFalse(valid('TelemetryReceipt', dict(receipt, state='rejected', error_code='overloaded')))
        self.assertTrue(valid('TelemetryReceipt', dict(receipt, state='rejected', accepted_count=0, error_code='overloaded')))

    def test_slow_only_and_independent_observation_time(self):
        batch = example('node.metrics.v3')
        batch['fast'] = []
        batch['public_ip'] = [{'sequence': 1, 'sampled_at': '2026-11-01T23:50:00Z', 'ipv4': '203.0.113.1', 'errors': []}]
        self.assertTrue(valid('TelemetryBatch', batch))
        self.assertNotEqual(batch['full'][0]['sampled_at'], batch['public_ip'][0]['sampled_at'])
        batch['public_ip'][0]['ipv4'] = '::1'
        self.assertFalse(valid('TelemetryBatch', batch))


if __name__ == '__main__':
    unittest.main()
