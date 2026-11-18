import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildInstallScript } from './install-script';

const token = 'a'.repeat(64);

describe('installation command', () => {
  it('omits the token argument so the installer prompts securely in the terminal', () => {
    const command = buildInstallScript('https://panel.example.com');
    execFileSync('sh', ['-n'], { input: command });
    expect(command).toContain("| sh -s -- install --url='https://panel.example.com'");
    expect(command).not.toContain('--token');
    expect(() => buildInstallScript('http://panel.example.com')).toThrow();
  });
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
      expect(command).toContain(`install --url='${origin}'`);
      expect(command).toContain('--token-stdin');
      expect(command).not.toMatch(/secret|auto_update|node_id/);
    },
  );
});

it('rejects invalid re-registration inputs', () => {
  expect(() => buildInstallScript('https://panel.example.com', token, "node'; rm")).toThrow();
  expect(() => buildInstallScript('https://panel.example.com', undefined, 'node-1')).toThrow();
});

it.each([
  ['single node', undefined, false, []],
  ['re-registration', 'node-1', false, ['--reenroll-node=node-1']],
  ['batch', undefined, true, ['--registration']],
])('passes the %s token via stdin', (_, node, batch, flags) => {
  const origin = 'https://panel.example.com';
  const command = buildInstallScript(origin, token, node, batch);
  const installer = ['set -eu', 'IFS= read -r secret', 'printf "%s\\n" "$@" "$secret"'].join('\n');
  const output = execFileSync('sh', ['-s'], {
    input: `curl() { cat <<'INSTALLER'\n${installer}\nINSTALLER\n}\n${command}`,
    encoding: 'utf8',
  });
  expect(output.trimEnd().split('\n')).toEqual([
    'install',
    `--url=${origin}`,
    ...flags,
    '--token-stdin',
    token,
  ]);
});

it('rejects invalid batch registration inputs', () => {
  const origin = 'https://panel.example.com';
  expect(() => buildInstallScript(origin, undefined, undefined, true)).toThrow();
  expect(() => buildInstallScript(origin, token, 'node-1', true)).toThrow();
});
