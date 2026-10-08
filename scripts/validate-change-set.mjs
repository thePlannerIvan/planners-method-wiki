#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { argumentsOf, isMain, runCli } from './lib/cli.mjs';
import { validateAgainstSchema } from './lib/contract-validation.mjs';
import { contract, methodSourceIds, validateMethod } from './lib/method-contracts.mjs';
import { validateSourceReferences } from './lib/source-provenance.mjs';
import { readWiki } from './lib/wiki-read.mjs';

export function validateChangeSet(value, { inputPath, checkSources = true } = {}) {
  const schema = contract('change-set.schema.json');
  const errors = validateAgainstSchema(value, schema, schema, '$', []);
  if (errors.length) return { valid: false, errors };
  for (const key of ['wiki_dir', 'source_index']) if (!isAbsolute(value[key])) errors.push(`${key} must be an absolute path`);
  if (value.route === 'isolated_bootstrap' && value.baseline_sha256 !== null) errors.push('New library requires a null baseline');
  if (value.route === 'upgrade_existing' && !value.baseline_sha256) errors.push('Existing library requires its baseline fingerprint');
  const sourceIds = new Set();
  for (const source of value.sources) {
    if (sourceIds.has(source.source_module_instance_id)) errors.push(`Duplicate source mapping: ${source.source_module_instance_id}`);
    sourceIds.add(source.source_module_instance_id);
  }
  const moduleIds = new Set();
  for (const module of value.modules) {
    if (moduleIds.has(module.module_id)) errors.push(`Duplicate module: ${module.module_id}`);
    moduleIds.add(module.module_id);
  }
  let wiki;
  try { wiki = readWiki(value.wiki_dir, { allowEmpty: value.route === 'isolated_bootstrap' }); }
  catch (error) { errors.push(error.message); }
  if (wiki && wiki.wiki_root_sha256 !== value.baseline_sha256) errors.push('Target library changed since baseline');
  const existingLenses = new Map((wiki?.modules || []).flatMap(module => module.lens_catalog.map(lens => [lens.lens_id, module.module_id])));
  const existingRecipes = new Set((wiki?.recipeCatalog.recipes || []).map(recipe => recipe.recipe_id));
  for (const definition of value.modules) {
    const existing = wiki?.modules.find(module => module.module_id === definition.module_id);
    if (existing && ['title', 'stable_decision', 'unified_preconditions', 'page_expression_options'].some(key => JSON.stringify(definition[key]) !== JSON.stringify(existing[key]))) errors.push(`${definition.module_id}: Existing Module metadata differs; use its current definition`);
  }
  const knownSources = new Set([...(wiki?.modules || []).flatMap(module => [ ...(module.source_module_instance_ids || []), ...module.lens_catalog.flatMap(methodSourceIds) ]), ...(wiki?.recipeCatalog.recipes || []).flatMap(methodSourceIds)]);
  const candidateIds = new Set();
  const changeIds = new Set();
  for (const change of value.changes) {
    if (changeIds.has(change.change_id)) errors.push(`Duplicate change ID: ${change.change_id}`);
    changeIds.add(change.change_id);
    errors.push(...validateMethod(change.object, change.method_kind, change.change_id));
    const id = change.object[change.method_kind === 'lens' ? 'lens_id' : 'recipe_id'];
    if (candidateIds.has(id)) errors.push(`Duplicate candidate ID: ${id}`);
    candidateIds.add(id);
    for (const sourceId of methodSourceIds(change.object)) if (!sourceIds.has(sourceId) && !knownSources.has(sourceId)) errors.push(`${id}: Source mapping missing: ${sourceId}`);
    if (!methodSourceIds(change.object).some(id => sourceIds.has(id))) errors.push(`${id}: No mapped evidence for this proposal`);
    if (change.method_kind === 'lens' && !moduleIds.has(change.source_module_id) && !wiki?.modules.some(module => module.module_id === change.source_module_id)) errors.push(`${id}: Unknown Module ${change.source_module_id}`);
    if (change.method_kind === 'recipe' && change.source_module_id !== null) errors.push(`${id}: Recipe belongs in the unified catalog`);
    if (value.route === 'isolated_bootstrap' && change.recommended_action !== 'new') errors.push(`${id}: New library has no existing target`);
    if (change.target_id) {
      if (change.method_kind === 'lens' && existingLenses.get(change.target_id) !== change.target_module_id) errors.push(`${id}: Invalid target Lens`);
      if (change.method_kind === 'recipe' && (!existingRecipes.has(change.target_id) || change.target_module_id !== null)) errors.push(`${id}: Invalid target Recipe`);
    }
    if (['merge', 'variant', 'revision', 'add_source', 'no_change'].includes(change.recommended_action) && !change.target_id) errors.push(`${id}: Recommendation requires an explicit target`);
    if (value.route === 'upgrade_existing' && !change.comparison) errors.push(`${id}: Missing comparison rationale`);
  }
  for (const change of value.changes.filter(change => change.method_kind === 'recipe')) {
    for (const lensId of [...change.object.required_lens_ids, ...change.object.optional_lens_ids, ...change.object.steps.map(step => step.lens_id)]) {
      if (!value.changes.some(item => item.method_kind === 'lens' && item.object.lens_id === lensId) && !existingLenses.has(lensId)) errors.push(`${change.change_id}: Unknown Recipe Lens ${lensId}`);
    }
  }
  let provenance = [];
  if (checkSources && !errors.length && value.changes.length) {
    const result = validateSourceReferences(value.source_index, value.sources);
    errors.push(...result.errors);
    provenance = result.provenance;
  }
  return { valid: errors.length === 0, errors, changes: value.changes.length, source_index: value.source_index, provenance, input: inputPath || null };
}

export function main(argv) {
  const args = argumentsOf(argv);
  if (args['--help']) return { usage: 'validate-change-set.mjs --input <change-set.json> [--source-index <same registered index>]' };
  if (!args['--input']) throw new Error('Missing --input');
  const value = JSON.parse(readFileSync(resolve(args['--input']), 'utf8'));
  if (args['--source-index'] && resolve(args['--source-index']) !== value.source_index) throw new Error('Provided source index differs from the change set');
  return validateChangeSet(value, { inputPath: resolve(args['--input']) });
}

if (isMain(import.meta.url)) runCli(main);
