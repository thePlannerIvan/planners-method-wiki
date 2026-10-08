#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { argumentsOf, isMain, runCli } from './lib/cli.mjs';
import { validateChangeSet } from './validate-change-set.mjs';
import { readWiki } from './lib/wiki-read.mjs';
import { hash, itemId, allowedDecisions, validateBundle } from './lib/review-validation.mjs';

export function buildReviewBundle(changeSetPath, output) {
  const inputPath = resolve(changeSetPath);
  const raw = readFileSync(inputPath, 'utf8');
  const changeSet = JSON.parse(raw);
  const report = validateChangeSet(changeSet, { inputPath, checkSources: true });
  if (!report.valid) throw new Error(`Invalid change set: ${report.errors.join('; ')}`);
  if (!changeSet.changes.length) throw new Error('No proposed changes to review');
  const wiki = readWiki(changeSet.wiki_dir, { allowEmpty: changeSet.route === 'isolated_bootstrap' });
  const moduleTargets = wiki.modules.map(module => ({ module_id: module.module_id, label_zh: module.title, target: module }));
  const lensTargets = wiki.modules.flatMap(module => module.lens_catalog.map(lens => ({
    module_id: module.module_id, module_title_zh: module.title, target_id: lens.lens_id,
    label_zh: `${module.title} / ${lens.name}`, question_zh: lens.question, target: lens,
  })));
  const recipeTargets = wiki.recipeCatalog.recipes.map(recipe => ({ module_id: null, target_id: recipe.recipe_id, label_zh: recipe.name, target: recipe }));
  const items = changeSet.changes.map(change => {
    const sourceId = change.object[change.method_kind === 'lens' ? 'lens_id' : 'recipe_id'];
    const module = changeSet.modules.find(module => module.module_id === change.source_module_id)
      || wiki.modules.find(module => module.module_id === change.source_module_id);
    const targets = change.method_kind === 'lens' ? lensTargets : recipeTargets;
    return {
      item_id: itemId(change.method_kind, sourceId), method_kind: change.method_kind, source_id: sourceId,
      source_module_id: change.source_module_id,
      module_meta: module ? { title_zh: module.title, stable_decision_zh: module.stable_decision,
        unified_preconditions_zh: module.unified_preconditions, page_expression_options: module.page_expression_options } : null,
      proposal: change.object, recommended_action: change.recommended_action,
      allowed_decisions: allowedDecisions(changeSet.route, change.method_kind),
      merge_targets: [...targets].sort((a, b) => Number(b.target_id === change.target_id) - Number(a.target_id === change.target_id)),
      module_targets: moduleTargets, comparison: change.comparison,
    };
  });
  const bundle = {
    contract_version: '1.0.0', route: changeSet.route, source_sha256: hash(raw),
    wiki_context: { wiki_dir: changeSet.wiki_dir, baseline_sha256: changeSet.baseline_sha256,
      source_index: changeSet.source_index, sources: changeSet.sources, modules: changeSet.modules,
      change_set_path: inputPath, change_set_sha256: hash(raw) }, items,
  };
  const check = validateBundle(bundle);
  if (!check.valid) throw new Error(`Invalid review bundle: ${check.errors.join('; ')}`);
  const target = resolve(output);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(bundle, null, 2)}\n`);
  return { valid: true, items: items.length, route: bundle.route, output: target, source_sha256: bundle.source_sha256 };
}

export function main(argv) {
  const args = argumentsOf(argv);
  if (args['--help']) return { usage: 'build-review-bundle.mjs --change-set <change-set.json> --output <review/review-bundle.json>' };
  if (!args['--change-set'] || !args['--output']) throw new Error('Missing --change-set or --output');
  return buildReviewBundle(args['--change-set'], args['--output']);
}
if (isMain(import.meta.url)) runCli(main);
