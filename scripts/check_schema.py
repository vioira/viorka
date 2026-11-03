#!/usr/bin/env python3
"""Ensure the draft schema migrates in SQLite and satisfies a few constraints."""
from pathlib import Path
import sqlite3

root = Path(__file__).resolve().parents[1]
sql = '\n'.join(p.read_text(encoding='utf-8') for p in sorted((root / 'migrations').glob('*.up.sql')))
con = sqlite3.connect(':memory:')
con.execute('PRAGMA foreign_keys = ON')
con.executescript(sql)
tables = {row[0] for row in con.execute("select name from sqlite_master where type='table'")}
required = {'users','nodes','port_allocations','engines','proxy_services','relay_rules',
            'config_revisions','deployments','tasks','metrics_history','metrics_history_old','metrics_disk_io','metrics_disk_io_old','metrics_filesystems','metrics_filesystems_old','metric_ingest_checkpoints','metric_history_partitions','node_system_info','node_public_addresses','audit_logs','agent_credentials'}
assert required.issubset(tables), required - tables
assert 'metric_rollups' not in tables, 'legacy history must not be initialized'
con.execute("INSERT INTO nodes (id,name,kind,created_at) VALUES ('n1','test','nat','2026-10-29T00:00:00Z')")
try:
    con.execute("INSERT INTO port_allocations (id,node_id,public_host,public_port,private_host,private_port,transport,owner,created_at) VALUES ('p1','n1','example.com',70000,'127.0.0.1',10001,'tcp','provider','2026-10-29T00:00:00Z')")
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError('Port range validation is missing')
print(f'SQLite migration syntax and checks OK; tables={len(tables)}')

for table in ('metrics_history', 'metrics_history_old'):
    columns = {row[1] for row in con.execute('PRAGMA table_info('+table+')')}
    assert {'cpu_sum','cpu_count','ram_used_sum','net_in_speed_max','fast_sample_count','full_sample_count','updated_at'} <= columns
    assert 'stats_json' not in columns
