#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const baseWiki = join(root, 'base-wiki');
const lintScript = join(root, 'scripts/lint-wiki.mjs');
const queryScript = join(root, 'scripts/query-wiki.mjs');
const viewerScript = join(root, 'scripts/build-wiki-viewer.mjs');

function runNode(script, args = []) {
  return JSON.parse(execFileSync(process.execPath, [script, ...args], { encoding: 'utf8' }));
}

function runNodeExpectFail(script, args = []) {
  try {
    execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', stdio: 'pipe' });
    assert.fail(`Expected non-zero exit for ${script} ${args.join(' ')}`);
  } catch (err) {
    assert.notEqual(err.status, 0);
    return JSON.parse((err.stdout || err.stderr || '{}').trim() || '{}');
  }
}

// 1. lint-wiki passes on base-wiki with expected counts
const lintOut = runNode(lintScript, ['--wiki-dir', baseWiki]);
assert.equal(lintOut.valid, true);
assert.equal(lintOut.modules, 11);
assert.equal(lintOut.lenses, 33);
assert.equal(lintOut.variants, 22);
assert.equal(lintOut.errors.length, 0);
assert.equal(lintOut.lenses_with_page_structure, 12);

// 2. query-wiki matches Chinese keywords, module filter, and handles zero-match cleanly
const q1 = runNode(queryScript, ['--wiki-dir', baseWiki, '--query', '价格战 非价格价值', '--limit', '3']);
assert.equal(q1.ok, true);
assert.ok(q1.total_matches >= 1);
assert.ok(q1.results.length <= 3);
assert.ok(q1.results[0].source_absolute_path.endsWith('.md'));
assert.ok(Array.isArray(q1.results[0].page_structure));

const qMod = runNode(queryScript, ['--wiki-dir', baseWiki, '--query', '品类', '--module', 'mod_brand-strategy']);
assert.equal(qMod.ok, true);
assert.ok(qMod.results.every((r) => r.module_id === 'mod_brand-strategy'));

const qZero = runNode(queryScript, ['--wiki-dir', baseWiki, '--query', 'zzzzNonExistentToken999']);
assert.equal(qZero.ok, true);
assert.equal(qZero.total_matches, 0);
assert.deepEqual(qZero.results, []);

// 3. build-wiki-viewer builds standalone offline HTML without external asset links
const tmp = mkdtempSync(join(tmpdir(), 'method-wiki-eval-'));
try {
  const wikiCopy = join(tmp, 'wiki');
  cpSync(baseWiki, wikiCopy, { recursive: true });
  const viewerOutPath = join(tmp, 'custom-viewer.html');
  const buildOut = runNode(viewerScript, ['--wiki-dir', wikiCopy, '--output', viewerOutPath]);
  assert.equal(buildOut.ok, true);
  assert.equal(buildOut.modules, 11);
  assert.equal(buildOut.lenses, 33);
  assert.ok(existsSync(viewerOutPath));
  const html = readFileSync(viewerOutPath, 'utf8');
  assert.ok(html.includes('Planners Method Wiki'));
  assert.ok(html.includes('lens_brand-system-from-insight'));
  assert.ok(!/<(?:script|link)\b[^>]+\b(?:src|href)="https?:\/\//i.test(html));

  // 4. lint-wiki rejects orphan file, missing section, invalid status, and broken index link
  writeFileSync(join(wikiCopy, 'lenses/lens_orphan.md'), `---
id: lens_orphan
name: 孤儿方法
module_id: mod_brand-strategy
module_title: 品牌策略开发
status: invalid_status
---

# 孤儿方法

## 解决的问题

测试孤儿方法与无效状态。

## 分析操作步骤

1. 第一步
`, 'utf8');
  writeFileSync(join(wikiCopy, 'index.md'), readFileSync(join(wikiCopy, 'index.md'), 'utf8') + '\n- [断链](lenses/lens_missing_target.md)\n', 'utf8');
  const badLint = runNodeExpectFail(lintScript, ['--wiki-dir', wikiCopy]);
  assert.equal(badLint.valid, false);
  const codes = new Set(badLint.errors.map((e) => e.code));
  assert.ok(codes.has('invalid_status'));
  assert.ok(codes.has('missing_section'));
  assert.ok(codes.has('orphan_lens_page'));
  assert.ok(codes.has('broken_index_link'));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log('planners-method-wiki evals passed: lint (positive+negative), query (hit+module+zero), build-wiki-viewer');
