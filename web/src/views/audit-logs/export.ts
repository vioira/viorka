import type { AuditRecord } from './mock-data';

// Quote every cell, preserve newlines, and neutralize spreadsheet formulas.
function csvCell(value: string) {
  const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function auditCsv(records: AuditRecord[]) {
  const rows = [
    ['操作者', '动作', '对象', '来源 IP', '时间（UTC）'],
    ...records.map(({ actor, action, target, ip, time }) => [actor, action, target, ip, time]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
