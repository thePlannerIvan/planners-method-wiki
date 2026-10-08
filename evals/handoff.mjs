import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { moduleCandidates } from '../scripts/lib/planners-modules.mjs';

const caller = name => moduleCandidates(name).find(path => existsSync(join(path, 'SKILL.md')));
const proposal = caller('planners-proposal-system'), bypage = caller('planners-bypage');
if (!proposal || !bypage) {
  console.log(JSON.stringify({ suite: 'handoff', skipped: true, reason: 'Caller Skills not installed; standalone Wiki tests remain available' }));
} else {
  const p = readFileSync(join(proposal, 'SKILL.md'), 'utf8');
  const b = readFileSync(join(bypage, 'SKILL.md'), 'utf8');
  assert.ok(p.includes('planners-method-wiki') && b.includes('planners-method-wiki'));
  assert.ok(!p.includes('/proposal-library-maintenance/base-wiki') && !b.includes('/proposal-library-maintenance/base-wiki'));
  const query = join(proposal, 'proposal-library-maintenance/scripts/query-wiki.mjs');
  const result = spawnSync(process.execPath, [query, '--query', '消费者', '--limit', '2'], { encoding: 'utf8', env: { ...process.env, PLANNERS_NO_AUTO_INSTALL: '1' } });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.ok(data.results.length > 0);
  assert.ok(data.wiki_dir.includes('planners-method-wiki'));
  assert.ok(!existsSync(join(proposal, 'proposal-library-maintenance/base-wiki')));
  console.log(JSON.stringify({ suite: 'handoff', checks: 5, valid: true, limitation: 'Checks actual caller pointers and legacy delegation; agent continuation is independently evaluated' }));
}
