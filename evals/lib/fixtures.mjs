import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const hash = raw => createHash('sha256').update(raw).digest('hex');
export const save = (path, value) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); return path; };
export const read = path => JSON.parse(readFileSync(path, 'utf8'));
export const SOURCE = `mi_${'1'.repeat(24)}`;
export const lens = (id = 'lens_compare-value') => ({
  lens_id: id, name: '比较决策价值', aliases: ['价值比较'], question: '选择差异是否改变购买决定？',
  use_conditions: ['有可比较选项与真实选择理由'], skip_conditions: ['只有口号，没有选择理由'],
  required_inputs: ['选项属性与选择理由'], analysis_operations: ['把属性映射到选择理由，标出无理由支持的属性', '比较取舍，检验哪项差异真的改变选择'],
  output_types: ['有依据的差异与适用边界'], failure_modes: ['把高频属性误当选择原因'], boundaries: ['相关关系不是因果证明'],
  variants: [], source_module_instance_ids: [SOURCE], page_structure: [],
});
export const recipe = (id = 'recipe_compare-proof') => ({
  recipe_id: id, name: '从差异到取舍', purpose: '形成有证据的选择建议', required_lens_ids: ['lens_compare-value'], optional_lens_ids: [],
  steps: [{ step_index: 1, lens_id: 'lens_compare-value', role: '比较', input: '属性与理由', output: '有效差异', dependency: '' }, { step_index: 2, lens_id: 'lens_compare-value', role: '检验', input: '有效差异', output: '取舍建议', dependency: '上一步的差异' }],
  use_conditions: ['存在需要取舍的选项'], skip_conditions: ['没有可靠输入'], source_module_instance_ids: [SOURCE],
});
export function fixture(root, { withRecipe = false } = {}) {
  mkdirSync(root, { recursive: true });
  const raw = '# 方法资料\n比较属性与实际选择理由，再检验哪项差异改变选择。\n';
  writeFileSync(join(root, 'source.md'), raw);
  const sourceIndex = join(root, 'source-index.json');
  save(sourceIndex, { contract_version: 'source-index/2.0.0', source_root: '.', sources: [{ source_id: 'source-method', origin: { path: 'source.md', sha256: hash(raw) }, kind: 'document', role: '方法原文', audit_layer: { mode: 'source_file' }, coverage: { status: 'full', scope: '全文' }, anchors: [{ kind: 'section', value: '方法资料' }] }] });
  const wiki = join(root, 'wiki');
  const set = { contract_version: 'method-change-set/1.0.0', route: 'isolated_bootstrap', wiki_dir: wiki, baseline_sha256: null, source_index: sourceIndex,
    sources: [{ source_module_instance_id: SOURCE, source_id: 'source-method', locator: '方法资料，第 2 行' }],
    modules: [{ module_id: 'mod_choice-method', title: '选择判断', stable_decision: '检验差异是否改变选择', unified_preconditions: ['有比较材料'], page_expression_options: [] }],
    changes: [{ change_id: 'change-lens', method_kind: 'lens', source_module_id: 'mod_choice-method', object: lens(), recommended_action: 'new', target_id: null, target_module_id: null, comparison: null }],
  };
  if (withRecipe) set.changes.push({ change_id: 'change-recipe', method_kind: 'recipe', source_module_id: null, object: recipe(), recommended_action: 'new', target_id: null, target_module_id: null, comparison: null });
  const changeSet = save(join(root, 'change-set.json'), set);
  return { root, wiki, set, sourceIndex, changeSet, bundlePath: join(root, 'review', 'review-bundle.json'), feedbackPath: join(root, 'review', 'review-feedback.json') };
}
export function buildBundle(fix) {
  const script = fileURLToPath(new URL('../../scripts/build-review-bundle.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--change-set', fix.changeSet, '--output', fix.bundlePath], { encoding: 'utf8', env: { ...process.env, PLANNERS_NO_AUTO_INSTALL: '1' } });
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  return read(fix.bundlePath);
}
export function feedback(fix, bundle, overrides = {}) {
  const value = { contract_version: '1.0.0', review_bundle_sha256: hash(readFileSync(fix.bundlePath)), route: bundle.route, saved_at: '2026-10-08T12:00:00.000Z', reviewer: 'Fixture user', decisions: bundle.items.map(item => ({ item_id: item.item_id, decision: bundle.route === 'isolated_bootstrap' ? 'approve' : 'new', target_module_id: null, target_id: null, edited_proposal: null, note_zh: '' })), ...overrides };
  save(fix.feedbackPath, value);
  return value;
}
