import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildInstallScript } from './install-script';

const token = 'a'.repeat(64);

describe('installation command', () => {
  it.each([
    'http://panel.example.com',
    'https://panel.example.com/path',
    'https://user:pass@panel.example.com',
    'https://panel.example.com?x=1',
    'https://panel.example.com#fragment',
    "https://host'$(id)'",
    'https://host\nBAD',
  ])('rejects invalid origins: %s', (origin) => {
    expect(() => buildInstallScript(origin, token)).toThrow();
  });
  it.each(['', 'short', 'g'.repeat(64), `${'a'.repeat(64)}\n`, `'; touch /tmp/unsafe; '`])(
    'rejects malformed tokens without exposing them: %s',
    (invalid) => {
      expect(() => buildInstallScript('https://panel.example.com', invalid)).toThrow(
        '注册令牌格式无效，请重新生成。',
      );
    },
  );
  it.each(['https://panel.example.com', 'https://local.vioira.com:8143', 'https://[::1]:8443'])(
    'builds a single POSIX shell command for %s with the one-time token',
    (origin) => {
      const command = buildInstallScript(origin, token);
      execFileSync('sh', ['-n'], { input: command });
      expect(command.split('\n')).toHaveLength(1);
      expect(command).toContain(
        'https://raw.githubusercontent.com/vioira/viorka-agent/main/install.sh',
      );
      expect(command).toContain(`| sh -s -- install --url='${origin}'`);
      expect(command).toContain(`--token='${token}'`);
      expect(command).not.toMatch(/secret|auto_update|node_id/);
    },
  );
});
