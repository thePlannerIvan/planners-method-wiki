#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readWiki } from '../scripts/lib/wiki-read.mjs';
import { hash, validateBundle, validateFeedback } from '../scripts/lib/review-validation.mjs';
import { startLibraryReview } from '../scripts/start-library-review.mjs';
import { importSubmission } from '../scripts/review-inbox.mjs';
import { moduleScript } from '../scripts/lib/planners-modules.mjs';

const root = mkdtempSync(join(tmpdir(), 'method-review-eval-'));
const skill = resolve(import.meta.dirname, '..');
const json = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const clone = value => structuredClone(value);
const tests = [];
async function test(name, action) { await action(); tests.push(name); console.log(`PASS ${name}`); }
let host;
let hostApi;
try {
  const wikiDir = join(root, 'wiki');
  cpSync(join(skill, 'base-wiki'), wikiDir, { recursive: true });
  const wiki = readWiki(wikiDir);
  const existing = wiki.modules[0].lens_catalog[0];
  const existingOther = wiki.modules[1].lens_catalog[0];
  const sourceId = 'mi_0123456789abcdef01234567';
  writeFileSync(join(root, 'source.md'), '# Test source\n\nMethod evidence at page 7.\n');
  const sourceIndex = join(root, 'source-index.json');
  json(sourceIndex, { contract_version: 'source-index/2.0.0', source_root: '.', sources: [{ source_id: 'test-source',
    origin: { path: 'source.md', sha256: hash(readFileSync(join(root, 'source.md'))) }, kind: 'document', role: 'Test fixture evidence',
    audit_layer: { mode: 'source_file' }, coverage: { status: 'full' }, anchors: [{ kind: 'page', value: '7' }] }] });
  const lens = { ...clone(existing), lens_id: 'lens_review-candidate', name: 'Canonical Test Lens', source_module_instance_ids: [sourceId], variants: [] };
  const optional = { ...clone(lens), lens_id: 'lens_review-optional', name: 'Optional Test Lens' };
  const recipe = { recipe_id: 'recipe_review-candidate', name: 'Canonical Test Recipe', purpose: 'Execute an approved candidate with an existing Lens',
    required_lens_ids: [lens.lens_id, existing.lens_id], optional_lens_ids: [optional.lens_id],
    steps: [{ step_index: 1, lens_id: lens.lens_id, role: 'Determine', input: 'Evidence', output: 'Decision', dependency: 'None' },
      { step_index: 2, lens_id: existing.lens_id, role: 'Express', input: 'Decision', output: 'Expression', dependency: 'Step 1' }],
    use_conditions: ['Test conditions'], skip_conditions: [], source_module_instance_ids: [sourceId] };
  const existingRecipe = { ...clone(recipe), recipe_id: 'recipe_existing-review', name: 'Existing Recipe',
    required_lens_ids: [existing.lens_id, existingOther.lens_id], optional_lens_ids: [],
    steps: recipe.steps.map((step, index) => ({ ...step, lens_id: index ? existingOther.lens_id : existing.lens_id })) };
  json(join(wikiDir, 'wiki-recipes.json'), { ...wiki.recipeCatalog, recipes: [existingRecipe] });
  const module = { module_id: 'mod_review-test', title: 'Test Module', stable_decision: 'A test decision', unified_preconditions: ['Evidence available'], page_expression_options: [] };
  const change = object => ({ change_id: object.lens_id || object.recipe_id, method_kind: object.lens_id ? 'lens' : 'recipe',
    source_module_id: object.lens_id ? module.module_id : null, object, recommended_action: 'new', target_id: null, target_module_id: null,
    comparison: { rationale: 'Test difference', matched_ids: [existing.lens_id] } });
  const source = { contract_version: 'method-change-set/1.0.0', route: 'upgrade_existing', wiki_dir: wikiDir,
    baseline_sha256: readWiki(wikiDir).wiki_root_sha256, source_index: sourceIndex,
    sources: [{ source_module_instance_id: sourceId, source_id: 'test-source', locator: 'Page 7, method evidence' }],
    modules: [module], changes: [change(lens), change(optional), change(recipe)] };
  const changePath = join(root, 'change-set.json');
  json(changePath, source);
  const reviewDir = join(root, 'review');
  let ready;
  await test('public surface-only adapter validates source and surface', async () => {
    ready = await startLibraryReview(['--change-set', changePath, '--review-dir', reviewDir, '--surface-only']);
    assert.equal(ready.host_started, false);
    assert.equal(ready.status, 'surface_ready');
    const surface = JSON.parse(readFileSync(ready.surface));
    assert.equal(surface.dir, '.'); assert.equal(surface.entry, 'index.html'); assert.equal(surface.project_root, '..');
    assert.equal(surface.id, 'planners-method-wiki/library');
  });
  const bundlePath = join(reviewDir, 'review-bundle.json');
  const raw = readFileSync(bundlePath, 'utf8');
  const bundle = JSON.parse(raw);
  const decision = (index, value = 'new') => ({ item_id: bundle.items[index].item_id, decision: value,
    target_module_id: null, target_id: null, edited_proposal: null, note_zh: 'TEST FIXTURE ONLY' });
  const feedback = decisions => ({ contract_version: '1.0.0', review_bundle_sha256: hash(raw), route: bundle.route,
    saved_at: '2026-10-08T00:00:00.000Z', reviewer: 'TEST FIXTURE ONLY', decisions });
  const full = feedback([decision(0), decision(1, 'reject'), decision(2)]);
  const valid = (value, options) => validateFeedback(bundle, value, raw, options);
  await test('bundle preserves canonical proposal and readonly source locators', () => {
    assert.deepEqual(bundle.items[0].proposal, lens);
    assert.deepEqual(bundle.wiki_context.sources, source.sources);
    assert.equal(bundle.source_sha256, hash(readFileSync(changePath)));
    assert.equal(bundle.items[2].module_targets.length, wiki.modules.length);
    assert.equal(validateBundle(bundle).valid, true);
    const changed = clone(bundle); changed.wiki_context.sources[0].locator = 'Invented';
    assert.equal(validateBundle(changed).valid, false);
  });
  await test('full coverage accepts existing Recipe dependencies and unused optional rejection', () => assert.deepEqual(valid(full), { valid: true, errors: [] }));
  await test('partial coverage requires explicit approvedOnly', () => {
    const partial = feedback([decision(0)]);
    assert.equal(valid(partial).valid, false);
    assert.equal(valid(partial, { approvedOnly: true }).valid, true);
    assert.equal(valid(feedback([])).valid, false);
    assert.equal(valid(feedback([]), { approvedOnly: true }).valid, true);
  });
  await test('approvedOnly never accepts unknown or duplicate decisions and fields', () => {
    for (const decisions of [[{ ...decision(0), item_id: `review_${'0'.repeat(24)}` }], [decision(0), decision(0)], [{ ...decision(0), extra: true }]]) {
      assert.equal(valid(feedback(decisions), { approvedOnly: true }).valid, false);
    }
  });
  await test('executed optional Lens requires approval; unknown edited Lens fails', () => {
    const edited = clone(recipe); edited.steps[1].lens_id = optional.lens_id; edited.required_lens_ids = [lens.lens_id];
    const input = clone(full);
    input.decisions[2].edited_proposal = edited;
    assert.equal(valid(input).valid, false);
    assert.ok(valid(input).errors.some(error => error.includes('Executed Lens')));
    const unknown = clone(full); unknown.decisions[2].edited_proposal = { ...recipe, optional_lens_ids: ['lens_not-in-bundle'] };
    assert.equal(valid(unknown).valid, false);
    const rejected = clone(full); rejected.decisions[0].decision = 'reject';
    assert.equal(valid(rejected).valid, false);
  });
  await test('canonical edits require complete objects and stable candidate IDs', () => {
    const input = feedback([{ ...decision(0), edited_proposal: { ...lens, question: 'Edited question' } }]);
    assert.equal(valid(input, { approvedOnly: true }).valid, true);
    input.decisions[0].edited_proposal.name_zh = 'Old curation'; assert.equal(valid(input, { approvedOnly: true }).valid, false);
    delete input.decisions[0].edited_proposal.name_zh;
    input.decisions[0].edited_proposal.lens_id = existing.lens_id; assert.equal(valid(input, { approvedOnly: true }).valid, false);
    input.decisions[0].edited_proposal = { lens_id: lens.lens_id }; assert.equal(valid(input, { approvedOnly: true }).valid, false);
    const malformed = clone(full); malformed.decisions[2].edited_proposal = { ...recipe, steps: [null, null] };
    assert.equal(valid(malformed).valid, false);
  });
  await test('merge requires edited final object and opened target', () => {
    const input = feedback([{ ...decision(0, 'merge'), target_id: existing.lens_id, target_module_id: wiki.modules[0].module_id }]);
    assert.equal(valid(input, { approvedOnly: true }).valid, false);
    input.decisions[0].edited_proposal = clone(lens);
    assert.equal(valid(input, { approvedOnly: true }).valid, true);
    input.decisions[0].target_id = 'lens_unknown'; assert.equal(valid(input, { approvedOnly: true }).valid, false);
  });
  await test('Recipe revision uses a full edited canonical object with stable candidate ID', () => {
    const input = feedback([{ ...decision(2, 'revision'), target_id: existingRecipe.recipe_id,
      edited_proposal: { ...clone(existingRecipe), recipe_id: recipe.recipe_id } }]);
    assert.equal(valid(input, { approvedOnly: true }).valid, true);
    input.decisions[0].edited_proposal = null;
    assert.equal(valid(input, { approvedOnly: true }).valid, false);
  });
  await test('malformed target and duplicate bundle IDs return reports rather than throwing', () => {
    const value = clone(bundle); value.items[0].module_targets[0].target.lens_catalog = null;
    assert.equal(validateBundle(value).valid, false);
    const duplicate = clone(bundle); duplicate.items.push(clone(duplicate.items[0]));
    assert.equal(validateBundle(duplicate).valid, false);
  });
  const submit = value => json(join(reviewDir, 'review-submissions.json'), value);
  const nativePath = join(reviewDir, 'review-feedback.json');
  await test('inbox no submission does not authorize previous feedback', () => {
    const result = importSubmission(ready.surface); assert.equal(result.status, 'no_submission'); assert.equal(result.imported, null);
  });
  await test('inbox imports full decisions and identifies duplicates', () => {
    submit(full); assert.equal(importSubmission(ready.surface).status, 'feedback_imported');
    assert.deepEqual(JSON.parse(readFileSync(nativePath)), full);
    assert.equal(importSubmission(ready.surface).status, 'duplicate_submission');
  });
  await test('missing/stale hashes cannot overwrite approval', () => {
    const previous = readFileSync(nativePath, 'utf8');
    for (const bad of [undefined, 'f'.repeat(64)]) {
      submit({ ...full, review_bundle_sha256: bad }); assert.equal(importSubmission(ready.surface).ok, false);
      assert.equal(readFileSync(nativePath, 'utf8'), previous);
    }
  });
  await test('whole note removes old native approval, including repeated notes', () => {
    writeFileSync(join(reviewDir, 'review-inbox-receipt.json'), '{');
    submit({ ...feedback([]), overall_note_zh: 'Revise the whole batch' });
    const result = importSubmission(ready.surface);
    assert.equal(result.status, 'overall_only'); assert.equal(result.imported.overall_only, true); assert.equal(existsSync(nativePath), false);
    assert.equal(importSubmission(ready.surface).status, 'duplicate_submission'); assert.equal(existsSync(nativePath), false);
  });
  await test('recipe-only change exposes existing Lens dependencies', async () => {
    const path = join(root, 'recipe-only.json'); const only = clone(source);
    const object = { ...clone(recipe), required_lens_ids: [existing.lens_id, existingOther.lens_id], optional_lens_ids: [],
      steps: recipe.steps.map((step, index) => ({ ...step, lens_id: index ? existingOther.lens_id : existing.lens_id })) };
    only.changes = [change(object)]; only.modules = []; json(path, only);
    const report = await startLibraryReview(['--change-set', path, '--review-dir', join(root, 'recipe-review'), '--surface-only']);
    const text = readFileSync(report.bundle, 'utf8'); const value = JSON.parse(text);
    assert.equal(validateFeedback(value, { ...feedback([]), review_bundle_sha256: hash(text), decisions: [{ ...decision(2), item_id: value.items[0].item_id }] }, text).valid, true);
  });
  await test('existing source Module needs no duplicate new definition', async () => {
    const path = join(root, 'existing-module.json'); const input = clone(source);
    input.modules = []; input.changes = [change(lens)]; input.changes[0].source_module_id = wiki.modules[0].module_id;
    json(path, input);
    const report = await startLibraryReview(['--change-set', path, '--review-dir', join(root, 'existing-module-review'), '--surface-only']);
    const value = JSON.parse(readFileSync(report.bundle, 'utf8'));
    assert.equal(value.wiki_context.modules.length, 0);
    assert.equal(value.items[0].module_meta.title_zh, wiki.modules[0].title);
    assert.equal(validateBundle(value).valid, true);
  });
  await test('change-set edits invalidate an already opened bundle', () => {
    json(changePath, { ...source, notes: 'New review required' }); assert.equal(valid(full).valid, false); json(changePath, source);
  });
  if (process.argv.includes('--browser')) {
    await test('public host smoke and canonical UI workflows', async () => {
      hostApi = await import(moduleScript('planners-review-core', 'scripts/review-host.mjs'));
      host = await startLibraryReview(['--change-set', changePath, '--review-dir', reviewDir, '--no-open']);
      assert.equal(host.opened, false);
      assert.equal(host.host_started, true);
      const python = process.env.REVIEW_TEST_PYTHON || 'python3';
      const result = spawnSync(python, ['-c', `
import json, sys
from playwright.sync_api import sync_playwright
url, review_dir = sys.argv[1:]
with sync_playwright() as p:
  browser = p.chromium.launch(headless=True)
  try:
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url)
    page.wait_for_load_state('networkidle')
    page.wait_for_function("bundleCheck.state === 'ok'")
    assert page.locator('.brand').inner_text() == 'WIKI REVIEW'
    assert 'Page 7, method evidence' in page.locator('#reviewCard').inner_text()
    assert page.locator('.nav-item').count() == 3
    assert page.locator('#save').is_disabled()
    assert page.evaluate('Object.keys(decisions).length') == 0
    page.locator('[data-decision="merge"]').click()
    page.locator('.target-select').select_option(index=1)
    page.locator('.load-target').click()
    value = json.loads(page.locator('.json-editor').input_value())
    assert value['lens_id'] == 'lens_review-candidate'
    assert 'name' in value and 'name_zh' not in value
    assert 'mi_0123456789abcdef01234567' in value['source_module_instance_ids']
    assert len(value['variants']) > 0
    assert page.evaluate('validateMethod(JSON.parse(document.querySelector(".json-editor").value), "lens").length') == 0
    value['question'] = 'Human-edited test question'
    page.locator('.json-editor').fill(json.dumps(value, ensure_ascii=False))
    page.locator('#next').click()
    page.locator('[data-decision="reject"]').click()
    page.locator('#next').click()
    assert page.locator('.dependency-row.pruned').count() == 1
    page.locator('[data-decision="new"]').click()
    assert page.locator('#save').is_enabled()
    page.locator('#save').click()
    page.locator('.completion.open').wait_for()
    with open(review_dir + '/review-submissions.json') as file:
      saved = json.load(file)
    assert saved['decisions'][0]['edited_proposal']['question'] == 'Human-edited test question'
    page.locator('#closeCompletion').click()
    page.locator('#overallNote').fill('Whole note test')
    page.locator('#submitOverall').click()
    page.locator('.completion.open').wait_for()
    assert not errors, errors
    page.locator('#closeCompletion').click()
    page.evaluate('window.scrollTo(0,0)')
    page.screenshot(path=review_dir + '/desktop.png')
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile overflow'
    page.screenshot(path=review_dir + '/mobile.png')
    page.locator('#reload').click()
    page.wait_for_load_state('networkidle')
    assert page.evaluate('Object.keys(decisions).length') == 0
  finally:
    browser.close()
`, host.url, reviewDir], { encoding: 'utf8', timeout: 120000 });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(importSubmission(ready.surface).imported.overall_only, true);
      assert.equal(existsSync(nativePath), false);
    });
  }
  console.log(JSON.stringify({ valid: true, tests: tests.length, browser: process.argv.includes('--browser'), root }, null, 2));
} finally {
  if (host && hostApi) await hostApi.stopHost(host);
  if (!process.argv.includes('--keep')) rmSync(root, { recursive: true, force: true });
}
