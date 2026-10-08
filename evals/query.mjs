#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { readWiki } from '../scripts/lib/wiki-read.mjs';
import { queryTerms, queryWiki } from '../scripts/query-wiki.mjs';

const skill = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const mi = `mi_${'1'.repeat(24)}`;
const approval = { human_approved: true, approved_at: '2026-10-08T00:00:00Z', reviewer_note: 'Fixture' };
const deletion = { deleted: false, reason: null, replaced_by: null };

function lens(id = 'lens_brand-positioning') {
  return { lens_id: id, name: '品牌差异化定位', aliases: ['定位破局', 'Differentiation'],
    question: '如何从消费者洞察找到品牌差异化定位？', use_conditions: ['品牌认知存在差异'],
    skip_conditions: ['缺乏消费者资料'], required_inputs: ['消费者洞察与竞品访谈'],
    analysis_operations: ['比较品牌与消费者需求'], output_types: ['品牌定位判断'],
    failure_modes: ['将个案当作普遍规律'], boundaries: ['不替代项目证据'],
    variants: [{ variant_id: 'variant_cultural-positioning', name: '文化锚点', use_conditions: ['存在文化张力'],
      analysis_operations: ['对照文化需求'], source_module_instance_ids: [mi] }],
    page_structure: [{ page: 1, title: '定位依据', content: '消费者与品牌能力交叉', required_evidence: ['访谈'], purpose: '比较' }],
    source_module_instance_ids: [mi], evidence: 'Fixture evidence', custom_preserved_field: { untouched: true } };
}

function moduleFixture() {
  return { contract_version: '1.0.0', wiki_module_id: `wm_${'2'.repeat(24)}`, module_id: 'mod_brand-strategy',
    title: '品牌策略', stable_decision: '从材料形成判断', unified_preconditions: ['材料可读'],
    lens_catalog: [lens(), { ...lens('lens_competitor-comparison'), name: '竞品比较', aliases: ['竞争分析'], variants: [] }],
    recipes: [], page_expression_options: [{ direction: '比较', use_when: '存在差异', information_relationship: 'comparative' }],
    source_module_instance_ids: [mi], wiki_version: '1.0.0', status: 'active', approval, deletion, created_from_hash: '3'.repeat(64) };
}

function recipeFixture() {
  return { recipe_id: 'recipe_brand-positioning', name: '洞察到定位的推导', aliases: ['策略串联'],
    purpose: '从消费者洞察组织品牌定位与竞品比较', required_lens_ids: ['lens_brand-positioning', 'lens_competitor-comparison'],
    optional_lens_ids: [], steps: [
      { step_index: 1, lens_id: 'lens_brand-positioning', role: '定位', input: ['访谈'], output: ['定位假设'], dependency: '先读项目材料', depends_on: [] },
      { step_index: 2, lens_id: 'lens_competitor-comparison', role: '检验', input: ['定位假设'], output: ['差异判断'], dependency: '使用第一步定位假设', depends_on: [1] },
    ], use_conditions: ['有材料'], skip_conditions: ['不能形成对照'], source_module_instance_ids: [mi],
    status: 'active', approval, deletion, custom_preserved_field: 'recipe-full-object' };
}

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'method-wiki-query-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const dir = join(home, 'wiki');
  mkdirSync(join(dir, 'modules'), { recursive: true });
  const module = moduleFixture();
  const index = { index_version: '3.0.0', modules: [{ module_id: module.module_id,
    wiki_module_id: module.wiki_module_id, path: 'modules/mod_brand-strategy.json',
    lenses: module.lens_catalog.map(item => ({ lens_id: item.lens_id })) }], recipe_catalog: 'wiki-recipes.json' };
  const catalog = { contract_version: '1.0.0', catalog_version: '1.0.0', updated_at: '2026-10-08', recipes: [recipeFixture()] };
  const write = (path, value) => writeFileSync(join(dir, path), `${JSON.stringify(value, null, 2)}\n`);
  const save = () => { write('wiki-index.json', index); write(index.modules[0].path, module); write('wiki-recipes.json', catalog); };
  save();
  return { home, dir, module, index, catalog, write, save };
}

function cli(script, args = []) {
  return spawnSync(process.execPath, [join(skill, 'scripts', script), ...args], { encoding: 'utf8' });
}

function queryCli(dir, args = []) {
  return cli('query-wiki.mjs', ['--wiki-dir', dir, '--query', '消费者洞察 品牌定位', ...args]);
}

if (process.argv.includes('--help')) {
  console.log('Usage: node evals/query.mjs\nRuns real QUERY/SNAPSHOT tests with disposable local Wiki fixtures and a read-only base-library audit.\nOptional WIKI_BASELINE_DIR compares the installed base against a baseline, byte for byte.\nNo dependencies or source/runtime writes. --help shows this message.');
} else {
  test('natural Chinese input, aliases, exact path/hash and full canonical Lens fields', t => {
    const f = fixture(t);
    const wiki = readWiki(f.dir);
    const response = queryWiki(wiki, { query: '如何用消费者洞察找到品牌差异化定位？' });
    assert.equal(response.ok, true);
    assert.equal(response.type, 'lens');
    assert.equal(response.wiki_dir, f.dir);
    assert.equal(response.wiki_root_sha256, wiki.wiki_root_sha256);
    assert.ok(queryTerms(response.query).includes('洞察'));
    assert.ok(queryTerms(response.query).includes('品牌'));
    const result = response.results.find(item => item.id === f.module.lens_catalog[0].lens_id);
    assert.ok(result);
    assert.deepEqual(result.canonical, f.module.lens_catalog[0]);
    for (const key of ['variants', 'required_inputs', 'skip_conditions', 'failure_modes', 'page_structure', 'custom_preserved_field']) assert.deepEqual(result[key], f.module.lens_catalog[0][key]);
    assert.equal(result.source_path, f.index.modules[0].path);
    assert.equal(result.source_absolute_path, join(f.dir, result.source_path));
    assert.equal(result.module_details.stable_decision, f.module.stable_decision);
    assert.equal(result.module_details.approval.human_approved, true);
    assert.equal(result.eligibility.human_approved, null);
    assert.equal(result.eligibility.approval_scope, 'module');
    assert.equal(result.eligibility.module_approval.human_approved, true);
    assert.ok(result.warnings.some(item => item.code === 'ITEM_APPROVAL_NOT_TRUE'));
    assert.equal(result.score, result.matched_fields.reduce((sum, item) => sum + item.occurrences, 0));
    assert.ok(response.matching.score_meaning.includes('not applicability'));
    const alias = queryWiki(wiki, { query: 'DIFFERENTIATION' });
    assert.ok(alias.results[0].matched_fields.some(item => item.field === 'aliases'));
    const old = queryCli(f.dir, ['--limit', '1']);
    assert.equal(old.status, 0, old.stderr);
    assert.equal(JSON.parse(old.stdout).returned, 1);
  });

  test('recipe/all CLI types return full Recipe and Lens/step locations', t => {
    const f = fixture(t);
    const run = queryCli(f.dir, ['--type', 'recipe']);
    assert.equal(run.status, 0, run.stderr);
    const response = JSON.parse(run.stdout);
    assert.equal(response.results.length, 1);
    const result = response.results[0];
    assert.deepEqual(result.canonical, f.catalog.recipes[0]);
    assert.deepEqual(result.steps, f.catalog.recipes[0].steps);
    assert.equal(result.source_path, 'wiki-recipes.json');
    assert.equal(result.lens_context.length, 2);
    assert.ok(result.lens_context.every(context => context.source_path === f.index.modules[0].path && context.resolved));
    assert.equal(result.step_context[1].lens_context.lens_id, 'lens_competitor-comparison');
    assert.equal(result.dependency_status.all_steps_available, true);
    const all = JSON.parse(queryCli(f.dir, ['--type', 'all', '--limit', '12']).stdout);
    assert.deepEqual(new Set(all.results.map(item => item.type)), new Set(['lens', 'recipe']));
    for (const step of f.catalog.recipes[0].steps) {
      step.input = step.input.join('；');
      step.output = step.output.join('；');
    }
    f.save();
    assert.deepEqual(readWiki(f.dir).recipeCatalog.recipes[0].steps, f.catalog.recipes[0].steps);
  });

  test('zero matches are success, not malformed/missing/path/unindexed errors', async t => {
    const f = fixture(t);
    const run = cli('query-wiki.mjs', ['--wiki-dir', f.dir, '--query', 'zzzz-never-present']);
    assert.equal(run.status, 0);
    assert.equal(JSON.parse(run.stdout).ok, true);
    assert.deepEqual(JSON.parse(run.stdout).results, []);
    const cases = [
      ['invalid JSON', f => writeFileSync(join(f.dir, f.index.modules[0].path), '{bad'), 'WIKI_INVALID_JSON'],
      ['invalid index JSON', f => writeFileSync(join(f.dir, 'wiki-index.json'), '{bad'), 'WIKI_INVALID_JSON'],
      ['missing indexed file', f => unlinkSync(join(f.dir, f.index.modules[0].path)), 'WIKI_FILE_MISSING'],
      ['missing indexed catalog', f => unlinkSync(join(f.dir, 'wiki-recipes.json')), 'WIKI_FILE_MISSING'],
      ['parent path escape', f => { f.index.modules[0].path = '../outside.json'; f.write('wiki-index.json', f.index); }, 'WIKI_PATH_ESCAPE'],
      ['absolute path escape', f => { f.index.modules[0].path = join(f.home, 'outside.json'); f.write('wiki-index.json', f.index); }, 'WIKI_PATH_ESCAPE'],
      ['symlink escape', f => { writeFileSync(join(f.home, 'outside.json'), '{}'); unlinkSync(join(f.dir, f.index.modules[0].path)); symlinkSync(join(f.home, 'outside.json'), join(f.dir, f.index.modules[0].path)); }, 'WIKI_PATH_ESCAPE'],
      ['unindexed file', f => f.write('modules/unindexed.json', {}), 'WIKI_UNINDEXED_MODULE'],
      ['nested unindexed file', f => { mkdirSync(join(f.dir, 'modules/nested')); f.write('modules/nested/unindexed.json', {}); }, 'WIKI_UNINDEXED_MODULE'],
      ['null indexed path', f => { f.index.modules[0].path = null; f.write('wiki-index.json', f.index); }, 'WIKI_INVALID'],
      ['broken catalog symlink', f => { unlinkSync(join(f.dir, 'wiki-recipes.json')); symlinkSync(join(f.home, 'nonexistent'), join(f.dir, 'wiki-recipes.json')); }, 'WIKI_FILE_MISSING'],
    ];
    for (const [name, mutate, code] of cases) await t.test(name, t => {
      const f = fixture(t);
      mutate(f);
      assert.throws(() => readWiki(f.dir), error => error.code === code);
      const run = queryCli(f.dir);
      assert.equal(run.status, 2, run.stderr);
      assert.equal(run.stdout, '');
      assert.equal(JSON.parse(run.stderr).ok, false);
      assert.equal(JSON.parse(run.stderr).error.code, code);
    });
  });

  test('allowEmpty permits only NEW directories with lock/empty rollback directories, not user files', t => {
    const f = fixture(t);
    const missing = join(f.home, 'new-missing');
    const empty = join(f.home, 'new-empty');
    mkdirSync(empty);
    for (const dir of [missing, empty]) {
      assert.throws(() => readWiki(dir));
      const wiki = readWiki(dir, { allowEmpty: true });
      assert.equal(wiki.wikiDir, dir);
      assert.equal(wiki.index, null);
      assert.equal(wiki.wiki_root_sha256, null);
      assert.deepEqual(wiki.modules, []);
      assert.deepEqual(wiki.recipeCatalog.recipes, []);
      assert.deepEqual(wiki.artifacts, []);
    }
    mkdirSync(join(empty, 'modules'));
    mkdirSync(join(empty, 'revisions/approval/previous/modules'), { recursive: true });
    assert.equal(readWiki(empty, { allowEmpty: true }).wiki_root_sha256, null);
    writeFileSync(join(empty, 'modules/user.json'), '{}');
    assert.throws(() => readWiki(empty, { allowEmpty: true }), error => error.code === 'WIKI_FILE_MISSING');
    unlinkSync(join(empty, 'modules/user.json'));
    writeFileSync(join(empty, 'revisions/approval/previous/modules/user.json'), '{}');
    assert.throws(() => readWiki(empty, { allowEmpty: true }), error => error.code === 'WIKI_FILE_MISSING');
    unlinkSync(join(empty, 'revisions/approval/previous/modules/user.json'));
    writeFileSync(join(empty, 'user.txt'), 'preserve');
    assert.throws(() => readWiki(empty, { allowEmpty: true }), error => error.code === 'WIKI_FILE_MISSING');
    unlinkSync(join(empty, 'user.txt'));
    mkdirSync(join(empty, 'other-empty-directory'));
    assert.throws(() => readWiki(empty, { allowEmpty: true }), error => error.code === 'WIKI_FILE_MISSING');
    writeFileSync(join(f.home, 'not-a-directory'), 'x');
    assert.throws(() => readWiki(join(f.home, 'not-a-directory'), { allowEmpty: true }));
    const lockOnly = join(f.home, 'lock-only');
    mkdirSync(lockOnly);
    writeFileSync(join(lockOnly, '.wiki-install.lock'), '');
    assert.equal(readWiki(lockOnly, { allowEmpty: true }).wiki_root_sha256, null);
    mkdirSync(join(lockOnly, 'modules/nested'), { recursive: true });
    mkdirSync(join(lockOnly, 'revisions/nested'), { recursive: true });
    assert.equal(readWiki(lockOnly, { allowEmpty: true }).wiki_root_sha256, null);
    const linkOnly = join(f.home, 'symlink-lock');
    mkdirSync(linkOnly);
    symlinkSync(join(lockOnly, '.wiki-install.lock'), join(linkOnly, '.wiki-install.lock'));
    assert.throws(() => readWiki(linkOnly, { allowEmpty: true }));
    const linkedTree = join(f.home, 'symlink-directory');
    mkdirSync(linkedTree);
    symlinkSync(join(lockOnly, 'modules'), join(linkedTree, 'modules'));
    assert.throws(() => readWiki(linkedTree, { allowEmpty: true }));
    const output = join(f.home, 'new-snapshot.json');
    const run = cli('build-wiki-snapshot.mjs', ['--wiki-dir', missing, '--output', output, '--allow-empty']);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(readFileSync(output)).wiki_root_sha256, null);
    assert.equal(existsSync(missing), false);
  });

  test('custom indexed Module paths remain canonical and available in artifacts/query context', t => {
    const f = fixture(t);
    const previous = f.index.modules[0].path;
    f.index.modules[0].path = 'domain/brand/custom-module.json';
    mkdirSync(join(f.dir, 'domain/brand'), { recursive: true });
    f.save();
    unlinkSync(join(f.dir, previous));
    const wiki = readWiki(f.dir);
    assert.deepEqual(wiki.modules[0], f.module);
    const artifact = wiki.artifacts.find(item => item.content.module_id === f.module.module_id);
    assert.equal(artifact.path, f.index.modules[0].path);
    const response = queryWiki(wiki, { query: '洞察', type: 'all' });
    assert.equal(response.results.find(item => item.type === 'lens').source_path, f.index.modules[0].path);
    assert.ok(response.results.find(item => item.type === 'recipe').lens_context.every(item => item.source_path === f.index.modules[0].path));
  });

  test('IDs and Recipe step dependency graph are validated', async t => {
    const mutations = [
      ['duplicate Module ID', f => f.index.modules.push({ ...f.index.modules[0] })],
      ['Module ID mismatch', f => f.module.module_id = 'mod_other-module'],
      ['duplicate Lens ID', f => f.module.lens_catalog[1].lens_id = f.module.lens_catalog[0].lens_id],
      ['invalid Lens ID', f => f.module.lens_catalog[0].lens_id = 'bad'],
      ['index Lens mismatch', f => f.index.modules[0].lenses.pop()],
      ['duplicate Recipe ID', f => f.catalog.recipes.push(structuredClone(f.catalog.recipes[0]))],
      ['required Lens missing', f => f.catalog.recipes[0].required_lens_ids.push('lens_missing-required')],
      ['nonmember step Lens', f => f.catalog.recipes[0].steps[0].lens_id = 'lens_nonmember-ref'],
      ['noncontiguous steps', f => f.catalog.recipes[0].steps[1].step_index = 3],
      ['self dependency', f => f.catalog.recipes[0].steps[1].depends_on = [2]],
      ['forward dependency', f => f.catalog.recipes[0].steps[0].depends_on = [2]],
      ['missing dependency', f => f.catalog.recipes[0].steps[1].depends_on = [99]],
      ['invalid dependency type', f => f.catalog.recipes[0].steps[1].depends_on = ['1']],
      ['required member without step', f => f.catalog.recipes[0].steps[1].lens_id = 'lens_brand-positioning'],
      ['overlapping optional and required', f => f.catalog.recipes[0].optional_lens_ids = ['lens_brand-positioning']],
      ['missing variant reference', f => f.catalog.recipes[0].steps[0].variant_id = 'variant_nonexistent-ref'],
      ['invalid catalog version', f => f.catalog.catalog_version = 'invalid'],
      ['single-step Recipe', f => f.catalog.recipes[0].steps.pop()],
    ];
    for (const [name, mutate] of mutations) await t.test(name, t => {
      const f = fixture(t);
      mutate(f);
      f.save();
      assert.throws(() => readWiki(f.dir), error => error.code === 'WIKI_INVALID');
    });
  });

  test('unresolved optional Lens is explicit and never fabricated', t => {
    const f = fixture(t);
    const recipe = f.catalog.recipes[0];
    recipe.optional_lens_ids = ['lens_missing-optional'];
    recipe.steps.push({ step_index: 3, lens_id: 'lens_missing-optional', depends_on: [2] });
    f.save();
    const wiki = readWiki(f.dir);
    assert.equal(wiki.audit.unresolved_optional_lenses, 1);
    const result = queryWiki(wiki, { query: '洞察', type: 'recipe' }).results[0];
    assert.deepEqual(result.lens_context[2], { lens_id: 'lens_missing-optional', optional: true, resolved: false, source_path: null, canonical: null, eligibility: null });
    assert.equal(result.dependency_status.required_available, true);
    assert.equal(result.dependency_status.all_steps_available, false);
    assert.ok(result.warnings.some(item => item.code === 'OPTIONAL_LENS_UNRESOLVED'));
  });

  test('legacy Recipes and conflicts are separately audited without mutation or promotion', t => {
    const f = fixture(t);
    f.module.recipes = [{ ...f.catalog.recipes[0], name: '旧版冲突名称' },
      { ...f.catalog.recipes[0], recipe_id: 'recipe_legacy-only', name: '旧版独有' }];
    f.save();
    const before = readFileSync(join(f.dir, f.index.modules[0].path));
    const wiki = readWiki(f.dir);
    assert.equal(wiki.audit.legacy_module_recipes, 2);
    assert.equal(wiki.audit.legacy_recipe_conflicts, 1);
    assert.ok(wiki.warnings.some(item => item.code === 'LEGACY_RECIPE_CONFLICT'));
    assert.equal(wiki.legacy_recipes[1].canonical_present, false);
    assert.equal(queryWiki(wiki, { query: '旧版独有', type: 'recipe' }).results.length, 0);
    assert.equal(queryWiki(wiki, { query: '洞察', type: 'recipe' }).results[0].name, f.catalog.recipes[0].name);
    assert.deepEqual(readFileSync(join(f.dir, f.index.modules[0].path)), before);
  });

  test('status/deletion filters are independent of honest human approval', async t => {
    for (const state of ['draft', 'deprecated', 'deleted', 'unexpected', null]) await t.test(`Module status ${state}`, t => {
      const f = fixture(t);
      f.module.status = state;
      f.save();
      const response = queryWiki(readWiki(f.dir), { query: '定位' });
      assert.equal(response.results.length, 0);
      assert.equal(response.audit.lenses, 2);
    });
    await t.test('deletion and object status', t => {
      const f = fixture(t);
      f.module.lens_catalog[0].deletion = { deleted: true };
      f.module.lens_catalog[1].status = 'deprecated';
      f.catalog.recipes[0].status = 'draft';
      f.save();
      assert.equal(queryWiki(readWiki(f.dir), { query: '定位', type: 'all' }).results.length, 0);
    });
    await t.test('active historical false approval remains visible, literal string true is not upgraded', t => {
      const f = fixture(t);
      f.module.approval = { ...approval, human_approved: false };
      f.catalog.recipes[0].approval = { ...approval, human_approved: 'true' };
      f.save();
      const response = queryWiki(readWiki(f.dir), { query: '定位', type: 'all' });
      const lens = response.results.find(item => item.type === 'lens');
      const recipe = response.results.find(item => item.type === 'recipe');
      assert.equal(lens.eligibility.module_approval.human_approved, false);
      assert.equal(lens.eligibility.human_approved, null);
      assert.equal(lens.eligibility.requires_human_review, true);
      assert.equal(recipe.eligibility.human_approved, 'true');
      assert.equal(recipe.eligibility.human_approval_confirmed, false);
      assert.ok(response.warnings.some(item => item.code === 'INVALID_APPROVAL_VALUE'));
      assert.equal(response.audit.active_lenses_without_confirmed_approval, 2);
    });
    await t.test('legacy Recipe missing status and approval is visible with explicit compatibility warning', t => {
      const f = fixture(t);
      delete f.catalog.recipes[0].status;
      delete f.catalog.recipes[0].approval;
      f.save();
      const result = queryWiki(readWiki(f.dir), { query: '洞察', type: 'recipe' }).results[0];
      assert.equal(result.eligibility.recorded_status, null);
      assert.equal(result.eligibility.status_scope, 'legacy-unrecorded');
      assert.equal(result.eligibility.human_approved, null);
      assert.equal(result.eligibility.requires_human_review, true);
      assert.ok(result.warnings.some(item => item.code === 'UNRECORDED_STATUS'));
      assert.equal(Object.hasOwn(result.canonical, 'status'), false);
    });
    await t.test('Recipe references inactive Lens without claiming it usable', t => {
      const f = fixture(t);
      f.module.status = 'deprecated';
      f.save();
      const recipe = queryWiki(readWiki(f.dir), { query: '洞察', type: 'recipe' }).results[0];
      assert.equal(recipe.dependency_status.required_available, false);
      assert.ok(recipe.warnings.some(item => item.code === 'RECIPE_LENS_INELIGIBLE'));
    });
  });

  test('stable sorted-byte snapshot, revisions excluded, copies identical, original unchanged', t => {
    const f = fixture(t);
    const wiki = readWiki(f.dir);
    const paths = wiki.artifacts.map(item => item.path);
    assert.deepEqual(paths, [...paths].sort());
    for (const artifact of wiki.artifacts) assert.equal(artifact.sha256, hash(readFileSync(join(f.dir, artifact.path))));
    assert.equal(wiki.wiki_root_sha256, hash(wiki.artifacts.map(item => `${item.path}:${item.sha256}`).join('\n')));
    mkdirSync(join(f.dir, 'revisions'));
    writeFileSync(join(f.dir, 'revisions/ignored.json'), '{malformed history');
    assert.equal(readWiki(f.dir).wiki_root_sha256, wiki.wiki_root_sha256);
    const copy = join(f.home, 'copy');
    cpSync(f.dir, copy, { recursive: true });
    assert.equal(readWiki(copy).wiki_root_sha256, wiki.wiki_root_sha256);
    const output = join(f.home, 'snapshot.json');
    const args = ['--wiki-dir', f.dir, '--output', output];
    const run = cli('build-wiki-snapshot.mjs', args);
    assert.equal(run.status, 0, run.stderr);
    const first = readFileSync(output);
    const snapshot = JSON.parse(first);
    assert.equal(snapshot.wiki_root_sha256, wiki.wiki_root_sha256);
    assert.deepEqual(snapshot.artifacts, wiki.artifacts);
    assert.equal(cli('build-wiki-snapshot.mjs', args).status, 0);
    assert.deepEqual(readFileSync(output), first);
    assert.equal(readWiki(f.dir).wiki_root_sha256, wiki.wiki_root_sha256);
    f.write(f.index.modules[0].path, { ...f.module, title: '改变标题' });
    assert.notEqual(readWiki(f.dir).wiki_root_sha256, wiki.wiki_root_sha256);
  });

  test('snapshot failure never overwrites output and cannot overwrite source artifact', t => {
    const f = fixture(t);
    const output = join(f.home, 'snapshot.json');
    writeFileSync(output, 'preserved');
    writeFileSync(join(f.dir, 'wiki-recipes.json'), '{malformed');
    const run = cli('build-wiki-snapshot.mjs', ['--wiki-dir', f.dir, '--output', output]);
    assert.equal(run.status, 2);
    assert.equal(JSON.parse(run.stderr).ok, false);
    assert.equal(readFileSync(output, 'utf8'), 'preserved');
    f.save();
    const before = readFileSync(join(f.dir, 'wiki-index.json'));
    const overwrite = cli('build-wiki-snapshot.mjs', ['--wiki-dir', f.dir, '--output', join(f.dir, 'wiki-index.json')]);
    assert.equal(overwrite.status, 2);
    assert.deepEqual(readFileSync(join(f.dir, 'wiki-index.json')), before);
    for (const link of ['symlink', 'hardlink']) {
      const alias = join(f.home, `${link}-output.json`);
      if (link === 'symlink') symlinkSync(join(f.dir, 'wiki-index.json'), alias);
      else linkSync(join(f.dir, 'wiki-index.json'), alias);
      const run = cli('build-wiki-snapshot.mjs', ['--wiki-dir', f.dir, '--output', alias]);
      assert.equal(run.status, 2);
      assert.deepEqual(readFileSync(join(f.dir, 'wiki-index.json')), before);
    }
    const dangling = join(f.home, 'dangling-output.json');
    const missingTarget = join(f.home, 'must-not-create.json');
    symlinkSync(missingTarget, dangling);
    assert.equal(cli('build-wiki-snapshot.mjs', ['--wiki-dir', f.dir, '--output', dangling]).status, 2);
    assert.equal(existsSync(missingTarget), false);
  });

  test('every owned CLI --help works; argument errors are structured and nonzero', t => {
    const f = fixture(t);
    for (const script of ['query-wiki.mjs', 'build-wiki-snapshot.mjs']) {
      const run = cli(script, ['--help', '--wiki-dir', '/nonexistent']);
      assert.equal(run.status, 0);
      assert.match(run.stdout, /Usage:/);
    }
    const evalHelp = spawnSync(process.execPath, [join(skill, 'evals/query.mjs'), '--help'], { encoding: 'utf8' });
    assert.equal(evalHelp.status, 0);
    assert.match(evalHelp.stdout, /Usage:/);
    for (const args of [['--type', 'wrong'], ['--limit', '0'], ['--limit', '13'], ['--limit', '1.5'], ['--unknown', 'x'], ['--query'], ['--limit', '2', '--limit', '3']]) {
      const run = queryCli(f.dir, args);
      assert.equal(run.status, 2, `Expected argument failure: ${JSON.stringify(args)}`);
      assert.equal(JSON.parse(run.stderr).ok, false);
    }
  });

  test('base-library audit preserves content and reports approval/legacy counts', t => {
    const installed = readWiki(join(skill, 'base-wiki'));
    const installedBytes = new Map(installed.artifacts.map(item => [item.path, readFileSync(join(installed.wikiDir, item.path))]));
    const libraries = [installed];
    if (process.env.WIKI_BASELINE_DIR !== undefined) {
      assert.ok(process.env.WIKI_BASELINE_DIR.trim(), 'WIKI_BASELINE_DIR must not be empty');
      libraries.push(readWiki(resolve(process.env.WIKI_BASELINE_DIR)));
    }
    for (const wiki of libraries) {
      const path = wiki.wikiDir;
      const before = wiki.artifacts.map(item => readFileSync(join(path, item.path)));
      const response = queryWiki(wiki, { query: '如何从消费者洞察找到品牌差异化定位？', limit: 12 });
      assert.ok(response.results.length > 0);
      assert.equal(response.audit.modules, 11);
      assert.equal(response.audit.lenses, 33);
      assert.equal(response.audit.module_human_approved_true, 11);
      assert.equal(response.audit.lens_item_human_approved_true, 0);
      assert.equal(response.audit.lens_item_human_approval_not_true, 33);
      assert.equal(response.audit.recipes, 0);
      assert.equal(response.audit.legacy_module_recipes, 4);
      assert.deepEqual(wiki.artifacts.map(item => item.path), [...installedBytes.keys()], 'Baseline artifact paths must match the installed base');
      wiki.artifacts.forEach((item, offset) => assert.deepEqual(before[offset], installedBytes.get(item.path), `Baseline bytes differ for ${item.path}`));
      assert.equal(wiki.wiki_root_sha256, installed.wiki_root_sha256, 'Baseline fingerprint must match the installed base');
      wiki.artifacts.forEach((item, offset) => assert.deepEqual(readFileSync(join(path, item.path)), before[offset]));
      t.diagnostic(JSON.stringify({ wiki_dir: path, wiki_root_sha256: wiki.wiki_root_sha256, audit: wiki.audit }));
    }
  });
}
