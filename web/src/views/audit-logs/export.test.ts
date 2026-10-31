import { describe, expect, it } from 'vitest';
import { auditCsv } from './export';
import { mockAudits } from './export-fixtures';

describe('audit CSV export', () => {
  it('exports only supplied records with UTF-8 BOM and UTC timestamps', () => {
    const records = mockAudits.filter((record) => record.kind === 'system');
    const csv = auditCsv(records);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(records.length + 2);
    expect(csv).not.toContain('Jonathan');
    expect(csv).toContain(records[0].time);
  });
  it('escapes quotes and newlines and neutralizes spreadsheet formulas', () => {
    const csv = auditCsv([{ ...mockAudits[0], actor: ' =SUM(1,2)', target: '含"引号",\n换行' }]);
    expect(csv).toContain('"\' =SUM(1,2)"');
    expect(csv).toContain('"含""引号"",\n换行"');
  });
});
