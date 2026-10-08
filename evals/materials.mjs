import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main as prepare } from '../scripts/prepare-paged-markdown.mjs';
import { main as materialize } from '../scripts/materialize-semantic-units.mjs';
import { save, hash } from './lib/fixtures.mjs';

const root = mkdtempSync(join(tmpdir(), 'method-wiki-materials-'));
let checks = 0;
const check = (name, action) => { action(); checks++; console.log(`PASS ${name}`); };
try {
  const textRoot = join(root, 'text'), reading = join(root, 'reading');
  mkdirSync(textRoot);
  writeFileSync(join(textRoot, 'example.md'), '原始观察\f比较不同解释\f提出有限结论');
  check('preparation preserves declared page boundaries', () => assert.equal(prepare(['--text-root', textRoot, '--corpus-id', 'fixture', '--output-dir', reading]).pages, 3));
  const pages = readFileSync(join(reading, 'page-manifest.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const plan = { contract_version: '1.0.0', source_record_id: pages[0].source_record_id, source_sha256: pages[0].source_sha256, page_count: 3,
    units: [{ unit_id: `su_${'2'.repeat(24)}`, page_ids: [pages[0].page_id, pages[2].page_id], page_numbers: [1, 3], purpose_zh: '理解观察到结论', boundary_reason_zh: '中间解释作支持上下文', support_page_ids: [pages[1].page_id] }], discarded_pages: [] };
  const plans = save(join(root, 'plans.jsonl'), plan);
  const args = ['--plans', plans, '--page-manifest', join(reading, 'page-manifest.jsonl'), '--text-root', textRoot, '--output-dir', join(root, 'units')];
  check('cross-page units preserve support context', () => { assert.equal(materialize(args).units, 1); const unit = JSON.parse(readFileSync(join(root, 'units/units', `${plan.units[0].unit_id}.json`))); assert.deepEqual(unit.pages.map(page => page.page_number), [1, 3]); assert.equal(unit.support_pages[0].text, '比较不同解释'); });
  const bad = structuredClone(plan); bad.units[0].unit_id = '../escape'; save(plans, bad);
  check('unit paths are constrained by source contract', () => assert.throws(() => materialize(args), /unit_id/));
  save(plans, plan); writeFileSync(join(textRoot, 'example.md'), 'Changed');
  check('materialization rejects changed source bytes', () => assert.throws(() => materialize(args), /hash mismatch/));
  const unpaged = join(root, 'unpaged'); mkdirSync(unpaged); writeFileSync(join(unpaged, 'long.md'), '内容'.repeat(10000));
  check('long unpaged material is readable without fake pages', () => { const result = prepare(['--text-root', unpaged, '--corpus-id', 'long', '--output-dir', join(root, 'long-reading')]); assert.equal(result.pages, 1); assert.equal(result.warnings.length, 1); });
  console.log(JSON.stringify({ suite: 'materials', checks, valid: true }));
} finally { rmSync(root, { recursive: true, force: true }); }
