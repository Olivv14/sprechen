import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('all tracked original JS, CSS, media, course and HTML inputs match baseline bytes', () => {
  assert.equal(execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(), 'feat/offline-language-paths-safe-backup');
  const output = execFileSync('git', ['diff', '--exit-code', 'da77c50a4b7938d4d49759f0f6c85b830db63156', '--', 'assets', 'audio', 'corpus', 'img', 'video', 'index.html', '404.html', 'manifest.json', 'favicon.svg', 'icons.svg', 'icon-192.png', 'apple-touch-icon.png'], { encoding: 'utf8' });
  assert.equal(output, '');
});
