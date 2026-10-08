#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { argumentsOf, isMain, runCli } from './lib/cli.mjs';
import { validateAgainstSchema } from './lib/contract-validation.mjs';
import { contract, methodSourceIds, validateMethod } from './lib/method-contracts.mjs';
import { validateFeedback } from './lib/review-validation.mjs';
import { validateSourceReferences } from './lib/source-provenance.mjs';
import { validateWikiGraph } from './lib/wiki-integrity.mjs';
import { readWiki } from './lib/wiki-read.mjs';

const hash = raw => createHash('sha256').update(raw).digest('hex');
const bytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const unique = values => [...new Set(values)];
const writesContent = action => !['reject', 'defer', 'no_change'].includes(action);

function checkedPath(root, suffix) {
  const path = resolve(root, suffix);
  const rel = relative(root, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Unsafe installation path: ${suffix}`);
  let ancestor = path;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const actual = realpathSync(ancestor);
  const actualRoot = existsSync(root) ? realpathSync(root) : resolve(root);
  if (existsSync(root) && actual !== actualRoot && !actual.startsWith(`${actualRoot}/`)) throw new Error(`Installation path escapes via symlink: ${suffix}`);
  return path;
}

function bump(version) {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some(part => !Number.isInteger(part) || part < 0)) throw new Error(`Invalid library version: ${version}`);
  return version === '0.0.0' ? '1.0.0' : `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

function assertContract(value, schemaName) {
  const schema = contract(schemaName);
  const errors = validateAgainstSchema(value, schema, schema, '$', []);
  if (errors.length) throw new Error(`${schemaName}: ${errors.join('; ')}`);
}

function applyDecisions(bundle, feedback, wiki) {
  const modules = new Map(structuredClone(wiki.modules).map(module => [module.module_id, module]));
  const catalog = structuredClone(wiki.recipeCatalog);
  const decisions = new Map(feedback.decisions.map(decision => [decision.item_id, decision]));
  const touched = new Set();
  const changedTargets = new Set();
  const resolution = new Map();
  const changed = [];
  const activeItems = bundle.items.filter(item => decisions.has(item.item_id));
  const definitions = new Map(bundle.wiki_context.modules.map(module => [module.module_id, module]));
  const locate = id => {
    for (const module of modules.values()) {
      const index = module.lens_catalog.findIndex(lens => lens.lens_id === id);
      if (index >= 0) return { module, index, lens: module.lens_catalog[index] };
    }
    return null;
  };
  const ensureModule = id => {
    if (modules.has(id)) return modules.get(id);
    const meta = definitions.get(id);
    if (!meta) throw new Error(`Missing new Module definition: ${id}`);
    const module = {
      contract_version: '1.0.0', wiki_module_id: `wm_${hash(id).slice(0, 24)}`, module_id: id,
      title: meta.title, stable_decision: meta.stable_decision, unified_preconditions: meta.unified_preconditions,
      lens_catalog: [], recipes: [], page_expression_options: meta.page_expression_options,
      source_module_instance_ids: [], wiki_version: '0.0.0', status: 'active',
      approval: { human_approved: true, reviewer_note: '', approved_at: feedback.saved_at },
      deletion: { deleted: false, reason: null, replaced_by: null }, created_from_hash: bundle.source_sha256,
    };
    modules.set(id, module);
    return module;
  };
  for (const item of activeItems.filter(item => item.method_kind === 'lens')) {
    const decision = decisions.get(item.item_id);
    if (['reject', 'defer'].includes(decision.decision)) continue;
    const proposal = structuredClone(decision.edited_proposal || item.proposal);
    const target = decision.target_id && locate(decision.target_id);
    if (decision.decision === 'no_change') {
      if (!target) throw new Error(`Missing existing Lens: ${decision.target_id}`);
      resolution.set(item.source_id, { lens_id: target.lens.lens_id });
      continue;
    }
    const targetKey = decision.target_id || proposal.lens_id;
    if (changedTargets.has(targetKey)) throw new Error(`Multiple mutations of ${targetKey}; combine into one reviewed final object`);
    changedTargets.add(targetKey);
    let module;
    let variantId;
    if (['merge', 'revision'].includes(decision.decision)) {
      if (!target) throw new Error(`Missing existing Lens: ${decision.target_id}`);
      module = target.module;
      target.module.lens_catalog[target.index] = { ...proposal, lens_id: target.lens.lens_id };
    } else if (decision.decision === 'add_source') {
      if (!target) throw new Error(`Missing existing Lens: ${decision.target_id}`);
      module = target.module;
      target.lens.source_module_instance_ids = unique([...target.lens.source_module_instance_ids, ...proposal.source_module_instance_ids]);
    } else if (decision.decision === 'variant') {
      if (!target) throw new Error(`Missing existing Lens: ${decision.target_id}`);
      module = target.module;
      variantId = `variant_${hash(item.source_id).slice(0, 24)}`;
      if (target.lens.variants.some(variant => variant.variant_id === variantId)) throw new Error(`Variant already exists: ${variantId}`);
      const { lens_id, variants, abstraction_self_check, evidence, member_analysis_unit_ids, _needs_human_review, _extracted_note, ...variant } = proposal;
      target.lens.variants.push({ ...variant, variant_id: variantId });
    } else if (decision.decision === 'reroute') {
      const current = locate(proposal.lens_id);
      module = ensureModule(decision.target_module_id);
      if (current) {
        if (current.module.module_id === module.module_id) throw new Error('Reroute requires a different Module');
        touched.add(current.module.module_id);
        current.module.lens_catalog.splice(current.index, 1);
      }
      module.lens_catalog.push(proposal);
    } else if (['new', 'approve', 'revise'].includes(decision.decision)) {
      if (locate(proposal.lens_id)) throw new Error(`Lens ID already exists: ${proposal.lens_id}`);
      module = ensureModule(item.source_module_id);
      module.lens_catalog.push(proposal);
    } else throw new Error(`Unsupported Lens action: ${decision.decision}`);
    touched.add(module.module_id);
    resolution.set(item.source_id, { lens_id: ['merge', 'revision', 'add_source', 'variant'].includes(decision.decision) ? decision.target_id : proposal.lens_id, ...(variantId ? { variant_id: variantId } : {}) });
    changed.push({ item_id: item.item_id, method_kind: 'lens', action: decision.decision, target_module_id: module.module_id, ...resolution.get(item.source_id) });
  }
  const candidateLenses = new Set(bundle.items.filter(item => item.method_kind === 'lens').map(item => item.source_id));
  const resolveLens = id => {
    if (resolution.has(id)) return resolution.get(id);
    if (candidateLenses.has(id)) return null;
    return locate(id) ? { lens_id: id } : null;
  };
  let recipesTouched = false;
  for (const item of activeItems.filter(item => item.method_kind === 'recipe')) {
    const decision = decisions.get(item.item_id);
    if (!writesContent(decision.decision)) continue;
    const proposal = structuredClone(decision.edited_proposal || item.proposal);
    const targetId = decision.target_id || proposal.recipe_id;
    if (changedTargets.has(targetId)) throw new Error(`Multiple mutations of ${targetId}`);
    changedTargets.add(targetId);
    const targetIndex = catalog.recipes.findIndex(recipe => recipe.recipe_id === decision.target_id);
    if (decision.decision === 'add_source') {
      if (targetIndex < 0) throw new Error(`Missing existing Recipe: ${decision.target_id}`);
      catalog.recipes[targetIndex].source_module_instance_ids = unique([...catalog.recipes[targetIndex].source_module_instance_ids, ...proposal.source_module_instance_ids]);
    } else {
      const resolveRequired = id => {
        const result = resolveLens(id);
        if (!result) throw new Error(`Recipe dependency not approved: ${id}`);
        return result;
      };
      proposal.required_lens_ids = unique(proposal.required_lens_ids.map(id => resolveRequired(id).lens_id));
      proposal.optional_lens_ids = unique(proposal.optional_lens_ids.map(id => resolveLens(id)?.lens_id).filter(Boolean));
      proposal.steps = proposal.steps.map(step => {
        const resolved = resolveRequired(step.lens_id);
        return { ...step, lens_id: resolved.lens_id, ...(resolved.variant_id ? { variant_id: resolved.variant_id } : {}) };
      });
      if (decision.decision === 'revision') {
        if (targetIndex < 0) throw new Error(`Missing existing Recipe: ${decision.target_id}`);
        catalog.recipes[targetIndex] = { ...proposal, recipe_id: decision.target_id };
      } else if (['new', 'approve', 'revise'].includes(decision.decision)) {
        if (catalog.recipes.some(recipe => recipe.recipe_id === proposal.recipe_id)) throw new Error(`Recipe ID already exists: ${proposal.recipe_id}`);
        catalog.recipes.push(proposal);
      } else throw new Error(`Unsupported Recipe action: ${decision.decision}`);
    }
    recipesTouched = true;
    changed.push({ item_id: item.item_id, method_kind: 'recipe', action: decision.decision, recipe_id: targetId });
  }
  for (const moduleId of touched) {
    const module = modules.get(moduleId);
    module.wiki_version = bump(module.wiki_version);
    module.source_module_instance_ids = unique([...module.source_module_instance_ids, ...module.lens_catalog.flatMap(methodSourceIds)]);
    // Approving new methods does not retroactively approve legacy contents.
    module.approval = { ...module.approval, reviewer_note: `Method review: ${feedback.reviewer}; ${changed.filter(change => change.target_module_id === moduleId).length} approved changes`, approved_at: feedback.saved_at };
    assertContract(module, 'wiki-module.schema.json');
  }
  if (recipesTouched) {
    catalog.catalog_version = bump(catalog.catalog_version);
    catalog.updated_at = feedback.saved_at;
    assertContract(catalog, 'wiki-recipe-catalog.schema.json');
    for (const recipe of catalog.recipes) {
      const errors = validateMethod(recipe, 'recipe', recipe.recipe_id);
      if (errors.length) throw new Error(errors.join('; '));
    }
  }
  return { modules: [...modules.values()], catalog, touched: [...touched], recipesTouched, changed };
}

function transact(writes, { failAfter } = {}) {
  const original = new Map();
  const completed = [];
  const temporaries = [];
  try {
    for (const write of writes) {
      if (write.exclusive && existsSync(write.path)) throw new Error(`Revision already exists: ${write.path}`);
      original.set(write.path, existsSync(write.path) ? readFileSync(write.path) : null);
      mkdirSync(dirname(write.path), { recursive: true });
      const temporary = `${write.path}.tmp-${process.pid}`;
      temporaries.push(temporary);
      writeFileSync(temporary, write.content, { flag: 'wx' });
      renameSync(temporary, write.path);
      completed.push(write.path);
      if (failAfter && completed.length === failAfter) throw new Error('Injected transaction failure');
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const path of completed.reverse()) {
      try {
        const raw = original.get(path);
        if (raw !== null) writeFileSync(path, raw);
        else unlinkSync(path);
      } catch (rollbackError) { rollbackErrors.push(`${path}: ${rollbackError.message}`); }
    }
    throw new Error(`${rollbackErrors.length ? 'Rollback incomplete' : 'Rolled back all covered files'}: ${error.message}${rollbackErrors.length ? `; ${rollbackErrors.join('; ')}` : ''}`);
  } finally {
    for (const path of temporaries) if (existsSync(path)) unlinkSync(path);
  }
}

export function install(bundlePath, feedbackPath, wikiDir, { dryRun = false, approvedOnly = false, reportOutput, failAfter } = {}) {
  const bundleRaw = readFileSync(bundlePath);
  const feedbackRaw = readFileSync(feedbackPath);
  const bundle = JSON.parse(bundleRaw);
  const feedback = JSON.parse(feedbackRaw);
  assertContract(bundle, 'review-bundle.schema.json');
  const review = validateFeedback(bundle, feedback, bundleRaw.toString('utf8'), { approvedOnly });
  if (!review.valid) throw new Error(`Review invalid: ${review.errors.join('; ')}`);
  const root = resolve(wikiDir);
  if (root !== bundle.wiki_context.wiki_dir) throw new Error('Installation target differs from the reviewed library');
  if (reportOutput) {
    const output = resolve(reportOutput), rel = relative(root, output);
    if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error('Report output must be outside the target library');
  }
  const approvalId = hash(`${hash(bundleRaw)}:${hash(feedbackRaw)}:${approvedOnly}`);
  const priorPath = checkedPath(root, `revisions/install-reports/${approvalId}.json`);
  if (existsSync(priorPath)) {
    const prior = JSON.parse(readFileSync(priorPath));
    if (prior.approval_id !== approvalId || prior.wiki_dir !== root) throw new Error('Invalid existing install receipt');
    const result = { ...prior, status: 'already_installed', dry_run: dryRun };
    if (reportOutput && !dryRun) {
      mkdirSync(dirname(resolve(reportOutput)), { recursive: true });
      writeFileSync(resolve(reportOutput), bytes(result));
    }
    return result;
  }
  const changeSetPath = bundle.wiki_context.change_set_path;
  if (!existsSync(changeSetPath) || hash(readFileSync(changeSetPath)) !== bundle.source_sha256) throw new Error('Change set changed after review; regenerate and approve the new review');
  if (bundle.wiki_context.change_set_sha256 !== bundle.source_sha256) throw new Error('Bundle has inconsistent change-set hashes');
  const mappings = bundle.wiki_context.sources;
  const sources = validateSourceReferences(bundle.wiki_context.source_index, mappings);
  if (!sources.valid) throw new Error(sources.errors.join('; '));
  const wiki = readWiki(root, { allowEmpty: bundle.route === 'isolated_bootstrap' });
  if (wiki.wiki_root_sha256 !== bundle.wiki_context.baseline_sha256) throw new Error('Target library changed since human review; compare and review again');
  const availableSources = new Set([...mappings.map(mapping => mapping.source_module_instance_id), ...wiki.modules.flatMap(module => module.lens_catalog.flatMap(methodSourceIds)), ...wiki.recipeCatalog.recipes.flatMap(methodSourceIds)]);
  for (const item of bundle.items) {
    const decision = feedback.decisions.find(decision => decision.item_id === item.item_id);
    if (!decision || !writesContent(decision.decision)) continue;
    for (const id of methodSourceIds(decision.edited_proposal || item.proposal)) if (!availableSources.has(id)) throw new Error(`Edited object has unmapped source ${id}`);
  }
  const plan = applyDecisions(bundle, feedback, wiki);
  const paths = new Map(wiki.artifacts.filter(artifact => artifact.content.module_id).map(artifact => [artifact.content.module_id, artifact.path]));
  const index = {
    index_version: '3.0.0', generated_at: feedback.saved_at,
    modules: plan.modules.sort((a, b) => a.module_id.localeCompare(b.module_id)).map(module => ({
      wiki_module_id: module.wiki_module_id, module_id: module.module_id, title: module.title, wiki_version: module.wiki_version,
      path: paths.get(module.module_id) || `modules/${module.module_id}.json`, stable_decision: module.stable_decision,
      lenses: module.lens_catalog.map(lens => ({ lens_id: lens.lens_id, name: lens.name, question: lens.question, use_conditions: lens.use_conditions })),
    })), recipe_catalog: 'wiki-recipes.json',
  };
  const integrity = validateWikiGraph(plan.modules, plan.catalog, index);
  if (!integrity.valid) throw new Error(integrity.errors.join('; '));
  const nextArtifacts = new Map(wiki.artifacts.map(artifact => [artifact.path, { sha256: artifact.sha256 }]));
  const writes = [];
  const add = (path, content, exclusive = false) => writes.push({ path: checkedPath(root, path), content, exclusive });
  for (const id of plan.touched) {
    const suffix = paths.get(id) || `modules/${id}.json`;
    const content = bytes(plan.modules.find(module => module.module_id === id));
    const original = wiki.artifacts.find(artifact => artifact.path === suffix);
    if (original) add(`revisions/${approvalId}/previous/${suffix}`, readFileSync(join(root, suffix)), true);
    add(suffix, content);
    nextArtifacts.set(suffix, { sha256: hash(content) });
  }
  if (plan.recipesTouched || !wiki.artifacts.some(artifact => artifact.path === 'wiki-recipes.json')) {
    if (existsSync(join(root, 'wiki-recipes.json'))) add(`revisions/${approvalId}/previous/wiki-recipes.json`, readFileSync(join(root, 'wiki-recipes.json')), true);
    const content = bytes(plan.catalog);
    add('wiki-recipes.json', content);
    nextArtifacts.set('wiki-recipes.json', { sha256: hash(content) });
  }
  const indexContent = bytes(index);
  if (existsSync(join(root, 'wiki-index.json'))) add(`revisions/${approvalId}/previous/wiki-index.json`, readFileSync(join(root, 'wiki-index.json')), true);
  add('wiki-index.json', indexContent);
  nextArtifacts.set('wiki-index.json', { sha256: hash(indexContent) });
  const afterHash = hash([...nextArtifacts].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, artifact]) => `${path}:${artifact.sha256}`).join('\n'));
  const report = {
    contract_version: 'method-install-report/1.0.0', valid: true, status: plan.changed.length ? 'installed' : 'no_changes',
    approval_id: approvalId, installed_at: feedback.saved_at, reviewer: feedback.reviewer, wiki_dir: root,
    review_bundle_sha256: hash(bundleRaw), feedback_sha256: hash(feedbackRaw), baseline_sha256: wiki.wiki_root_sha256,
    wiki_root_sha256: plan.changed.length ? afterHash : wiki.wiki_root_sha256, touched_modules: plan.touched,
    recipes_touched: plan.recipesTouched, changes: plan.changed, integrity,
  };
  assertContract(report, 'install-report.schema.json');
  if (dryRun) return { ...report, status: plan.changed.length ? 'preflight_ok' : 'no_changes', dry_run: true };
  if (!plan.changed.length) return { ...report, dry_run: false };
  add(`revisions/${approvalId}/provenance.json`, bytes({ source_index: bundle.wiki_context.source_index, mappings: sources.provenance }), true);
  add(`revisions/${approvalId}/review-bundle.json`, bundleRaw, true);
  add(`revisions/${approvalId}/review-feedback.json`, feedbackRaw, true);
  add(`revisions/install-reports/${approvalId}.json`, bytes(report), true);
  if (reportOutput) {
    const output = resolve(reportOutput);
    if (writes.some(write => write.path === output) || (relative(root, output) && !relative(root, output).startsWith('..'))) throw new Error('Report output must be outside the target library');
    writes.push({ path: output, content: bytes(report) });
  }
  mkdirSync(root, { recursive: true });
  const lockPath = checkedPath(root, '.wiki-install.lock');
  let lock;
  try { lock = openSync(lockPath, 'wx'); }
  catch (error) { throw new Error(`Library has an active installation lock: ${error.message}`); }
  try {
    const current = readWiki(root, { allowEmpty: bundle.route === 'isolated_bootstrap' });
    if (current.wiki_root_sha256 !== wiki.wiki_root_sha256) throw new Error('Target library changed before commit');
    transact(writes, { failAfter });
  } finally {
    closeSync(lock);
    unlinkSync(lockPath);
  }
  return { ...report, dry_run: false, report: priorPath };
}

export function main(argv) {
  const args = argumentsOf(argv, ['--dry-run', '--approved-only']);
  if (args['--help']) return { usage: 'install-wiki-module.mjs --bundle <review-bundle.json> --feedback <review-feedback.json> --wiki-dir <Wiki> [--report-output <path outside Wiki>] [--dry-run] [--approved-only]', dry_run: 'No directories, files, reports or approvals are changed' };
  for (const key of ['--bundle', '--feedback', '--wiki-dir']) if (!args[key]) throw new Error(`Missing ${key}`);
  return install(resolve(args['--bundle']), resolve(args['--feedback']), resolve(args['--wiki-dir']), { dryRun: Boolean(args['--dry-run']), approvedOnly: Boolean(args['--approved-only']), reportOutput: args['--report-output'] });
}

if (isMain(import.meta.url)) runCli(main);
