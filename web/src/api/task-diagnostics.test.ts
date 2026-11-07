import { expect, it } from 'vitest';
import { parseEngineDiagnostic } from './task-diagnostics';

it('reads structured failure details and accepts replies without diagnostics', () => {
  const diagnostic = {
    stage: 'download',
    message: '下载服务器返回错误状态',
    interrupted: false,
    http_status: 403,
  };
  expect(parseEngineDiagnostic({ engine: { diagnostic } })).toEqual(diagnostic);
  expect(parseEngineDiagnostic(null)).toBeUndefined();
  expect(parseEngineDiagnostic({ engine: { status: 'running' } })).toBeUndefined();
});
it.each([
  { stage: 'shell', message: 'bad', interrupted: false },
  { stage: 'extract', message: 'x'.repeat(513), interrupted: true },
  { stage: 'extract', message: 'bad\ncontrol', interrupted: true },
  { stage: 'download', message: 'bad', interrupted: false, http_status: 999 },
  { stage: 'start', message: 'bad', interrupted: false, exit_code: -1 },
])('rejects malformed diagnostics', (diagnostic) => {
  expect(() => parseEngineDiagnostic({ engine: { diagnostic } })).toThrow('任务诊断格式无效');
});
