import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HELP_COMMANDS, helpText, requestedHelp } from '../src/help.ts';
import { SERVE_PORT } from '../src/serve.ts';

const COMMANDS = [
  'build', 'test', 'e2e', 'lint', 'typecheck', 'check', 'publish', 'serve', 'init', 'skill',
];

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'honyomi-help-'));
  const tools = path.resolve(import.meta.dirname, '..');
  try {
    const result = spawnSync(process.execPath, [
      '--import', pathToFileURL(path.join(tools, 'register.mjs')).href,
      path.join(tools, 'src', 'cli.ts'),
      ...args,
    ], { cwd: root, encoding: 'utf8' });
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: `${result.stderr ?? ''}${result.error === undefined ? '' : result.error.message}`,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('every command has help, and the overview names each command', () => {
  assert.deepEqual([...HELP_COMMANDS].sort(), [...COMMANDS].sort());
  const overview = helpText('');
  assert.ok(overview !== null);
  assert.match(overview, /--help/);
  for (const command of COMMANDS) {
    const text = helpText(command);
    assert.ok(text !== null);
    assert.match(text, new RegExp(`honyomi-plugin ${command}`));
    assert.match(overview, new RegExp(`\\b${command}\\b`));
  }
  assert.match(helpText('lint') ?? '', /--fix/);
  assert.match(helpText('publish') ?? '', /--release/);
  assert.match(helpText('publish') ?? '', /整个 catalog/);
  assert.match(helpText('serve') ?? '', new RegExp(String(SERVE_PORT)));
  assert.match(helpText('e2e') ?? '', /replay\|record\|live/);
  assert.equal(helpText('nope'), null);
});

test('requestedHelp recognizes --help, -h, and help without treating them as plugin paths', () => {
  assert.equal(requestedHelp('--help', []), '');
  assert.equal(requestedHelp('-h', []), '');
  assert.equal(requestedHelp('help', []), '');
  assert.equal(requestedHelp('--help', ['build']), 'build');
  assert.equal(requestedHelp('help', ['publish', '--help']), 'publish');
  assert.equal(requestedHelp('lint', ['--fix', '--help']), 'lint');
  assert.equal(requestedHelp('test', ['-h', 'src/zh/example']), 'test');
  assert.equal(requestedHelp('build', ['src/zh/example']), undefined);
  assert.equal(requestedHelp(undefined, []), undefined);
  assert.throws(() => requestedHelp('help', ['build', 'test']), /多余参数：test/);
});

test('cli --help exits 0 outside a project and does not run the command', () => {
  const overview = runCli(['--help']);
  assert.equal(overview.status, 0, overview.stderr);
  assert.match(overview.stdout, /honyomi-plugin <command> --help/);
  assert.equal(overview.stderr.includes('请在插件目录'), false);

  const publish = runCli(['publish', '--help']);
  assert.equal(publish.status, 0, publish.stderr);
  assert.match(publish.stdout, /--release/);
  assert.equal(publish.stdout.includes('built'), false);
  assert.equal(publish.stdout.includes('no plugins'), false);

  const init = runCli(['init', '-h']);
  assert.equal(init.status, 0, init.stderr);
  assert.match(init.stdout, /honyomi-plugin init/);
  assert.equal(init.stdout.includes('created'), false);

  const unknown = runCli(['help', 'nope']);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /未知命令：nope/);
  assert.match(unknown.stdout, /honyomi-plugin <command>/);
});
