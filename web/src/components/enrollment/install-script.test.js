import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildInstallScript } from './install-script';

describe('installation script', () => {
  it.each([
    'http://panel.example.com',
    'https://panel.example.com/path',
    'https://user:pass@panel.example.com',
    'https://panel.example.com?x=1',
  ])('rejects invalid origins: %s', (origin) => {
    expect(() => buildInstallScript(origin, 'node')).toThrow();
  });
  it('encodes user input as JSON and uses hidden stdin for the token', () => {
    const name = 'a\nVIORKA_CONFIG\n$(touch /tmp/unsafe)\n"node"';
    const script = buildInstallScript('https://panel.example.com', name);
    execFileSync('bash', ['-n'], { input: script });
    const json = script.split("<<'VIORKA_CONFIG'\n")[1].split('\nVIORKA_CONFIG')[0];
    expect(JSON.parse(json).node_name).toBe(name);
    expect(script).toContain('read -r -s enrollment_token </dev/tty');
    expect(script).toContain('--token-stdin');
    expect(script.indexOf('sha256sum --check')).toBeLessThan(script.indexOf('chmod 700'));
  });
  it.each(['existing', 'checksum', 'download', 'architecture'])(
    'stops safely on %s failure',
    (failure) => {
      const home = mkdtempSync(join(tmpdir(), 'viorka-install-test-'));
      try {
        const bin = join(home, 'bin');
        mkdirSync(bin);
        const executable = (name, script) =>
          writeFileSync(join(bin, name), `#!/bin/sh\n${script}\n`, { mode: 0o700 });
        executable(
          'uname',
          `if [ "$1" = -s ]; then echo Linux; else echo ${failure === 'architecture' ? 'riscv64' : 'x86_64'}; fi`,
        );
        executable('sha256sum', 'exit 1');
        executable(
          'curl',
          failure === 'download'
            ? 'exit 22'
            : `
case "$*" in
  *releases/latest*) printf https://github.com/vioira/viorka-agent/releases/tag/v0.1.0 ;;
  *.sha256*) printf '%064d' 0 > viorka-agent.sha256 ;;
  *) printf 'invalid binary' > viorka-agent.download ;;
esac`,
        );
        const dir = join(home, '.local/share/viorka-agent');
        if (failure === 'existing') {
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, 'identity'), 'existing identity');
        }
        expect(() =>
          execFileSync('bash', [], {
            input: buildInstallScript('https://panel.example.com', 'node'),
            env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
            stdio: ['pipe', 'pipe', 'pipe'],
          }),
        ).toThrow();
        expect(existsSync(join(dir, 'agent.json'))).toBe(false);
        expect(existsSync(join(dir, 'viorka-agent'))).toBe(false);
        if (failure === 'existing')
          expect(readFileSync(join(dir, 'identity'), 'utf8')).toBe('existing identity');
        if (failure === 'checksum')
          expect(existsSync(join(dir, 'viorka-agent.download'))).toBe(true);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    },
  );
});
