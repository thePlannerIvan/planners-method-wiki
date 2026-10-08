#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

for (const suite of ['query.mjs', 'review.mjs', 'install.mjs', 'materials.mjs', 'handoff.mjs']) {
  console.log(`Suite: ${suite}`);
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, suite)], { encoding: 'utf8', timeout: 120000, env: { ...process.env, PLANNERS_NO_AUTO_INSTALL: '1', REVIEW_TEST_NO_OPEN: '1' } });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('5/5 Method Wiki suites passed');
