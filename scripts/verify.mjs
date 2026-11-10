import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const directory = '.saikan/execution/offline-language-paths';
mkdirSync(directory, { recursive: true });
const commands = ['test', 'run typecheck', 'run build', 'run test:e2e'];
const results = [];
for (const command of commands) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.env.ComSpec || 'C:/Windows/System32/cmd.exe', ['/d', '/s', '/c', `npm.cmd ${command}`], { encoding: 'utf8', maxBuffer: 10_000_000 });
  const output = (result.stdout || '') + (result.stderr || '') + (result.error ? String(result.error) : '');
  process.stdout.write(`\nnpm.cmd ${command}\n${output}\nEXIT ${result.status}\n`);
  const log = `${directory}/${command.replace(/[^a-z0-9-]/g, '-')}.log`;
  writeFileSync(log, output);
  results.push({ command: `npm.cmd ${command}`, exitCode: result.status, startedAt, finishedAt: new Date().toISOString(), log });
}
writeFileSync(`${directory}/command-results.json`, JSON.stringify(results, null, 2));
if (results.some(r => r.exitCode !== 0)) process.exitCode = 1;
