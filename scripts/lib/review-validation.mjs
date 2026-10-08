import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { validateAgainstSchema } from './contract-validation.mjs';
import { contract, validateMethod, methodSourceIds } from './method-contracts.mjs';

export const hash = raw => createHash('sha256').update(raw).digest('hex');
export const itemId = (kind, id) => `review_${hash(`${kind}:${id}`).slice(0, 24)}`;
export const targetDecisions = ['merge', 'variant', 'revision', 'add_source', 'no_change'];
export const editedDecisions = ['revise', 'merge', 'revision'];
export const acceptedDecisions = ['approve', 'revise', 'new', 'merge', 'variant', 'revision', 'add_source', 'reroute', 'no_change'];
export function allowedDecisions(route, kind) {
  if (route === 'isolated_bootstrap') return ['approve', 'revise', 'reject', 'defer'];
  return kind === 'lens' ? ['new', 'merge', 'variant', 'revision', 'add_source', 'reroute', 'no_change', 'reject', 'defer']
    : ['new', 'revision', 'add_source', 'no_change', 'reject', 'defer'];
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unique = (values, label, errors) => { if (new Set(values).size !== values.length) errors.push(`Duplicate ${label}`); };

export function existingLenses(bundle) {
  const lenses = new Map();
  for (const item of bundle.items) {
    if (item.method_kind === 'lens') for (const target of item.merge_targets) lenses.set(target.target_id, target.target);
    for (const module of item.module_targets) for (const lens of module.target?.lens_catalog || []) lenses.set(lens.lens_id, lens);
  }
  return lenses;
}

export function validateBundle(bundle) {
  const schema = contract('review-bundle.schema.json');
  const errors = validateAgainstSchema(bundle, schema, schema, '$', []);
  if (errors.length) return { valid: false, errors };
  // Check canonical shapes before walking their arrays and IDs.
  for (const item of bundle.items) {
    try { errors.push(...validateMethod(item.proposal, item.method_kind, `${item.item_id}.proposal`)); }
    catch (error) { errors.push(`${item.item_id}.proposal: ${error.message}`); }
    for (const target of item.merge_targets) {
      try { errors.push(...validateMethod(target.target, item.method_kind, `${item.item_id}.target.${target.target_id}`)); }
      catch (error) { errors.push(`${item.item_id}.target: ${error.message}`); }
    }
    for (const target of item.module_targets) {
      const moduleSchema = contract('wiki-module.schema.json');
      validateAgainstSchema(target.target, moduleSchema, moduleSchema, `${item.item_id}.module.${target.module_id}`, errors);
    }
  }
  if (errors.length) return { valid: false, errors };
  const context = bundle.wiki_context;
  for (const key of ['wiki_dir', 'source_index', 'change_set_path']) if (!isAbsolute(context[key])) errors.push(`wiki_context.${key} must be absolute`);
  if (context.change_set_sha256 !== bundle.source_sha256) errors.push('Source and change-set hashes differ');
  if ((bundle.route === 'isolated_bootstrap') !== (context.baseline_sha256 === null)) errors.push('Baseline does not match route');
  unique(context.sources.map(source => source.source_module_instance_id), 'source mapping', errors);
  unique(context.modules.map(module => module.module_id), 'module', errors);
  unique(bundle.items.map(item => item.item_id), 'item_id', errors);
  unique(bundle.items.map(item => item.source_id), 'source_id', errors);
  const mappedSources = new Set(context.sources.map(source => source.source_module_instance_id));
  let changes;
  try {
    const raw = readFileSync(context.change_set_path, 'utf8');
    if (hash(raw) !== bundle.source_sha256) errors.push('Change set changed since review bundle was built');
    const source = JSON.parse(raw);
    if (source.route !== bundle.route) errors.push('Bundle route differs from change set');
    for (const key of ['wiki_dir', 'baseline_sha256', 'source_index', 'sources', 'modules']) if (!same(source[key], context[key])) errors.push(`Readonly wiki_context.${key} differs from change set`);
    changes = source.changes;
    if (!Array.isArray(changes) || changes.length !== bundle.items.length) errors.push('Bundle must cover exactly the proposed changes');
  } catch (error) { errors.push(`Cannot verify change set: ${error.message}`); }
  const targetCopies = new Map();
  const moduleCopies = new Map();
  for (const item of bundle.items) {
    const key = item.method_kind === 'lens' ? 'lens_id' : 'recipe_id';
    if (item.item_id !== itemId(item.method_kind, item.source_id) || item.proposal[key] !== item.source_id) errors.push(`${item.item_id}: Inconsistent candidate ID`);
    if (!methodSourceIds(item.proposal).some(id => mappedSources.has(id))) errors.push(`${item.item_id}: Proposal needs a mapped source`);
    if (!same(item.allowed_decisions, allowedDecisions(bundle.route, item.method_kind))) errors.push(`${item.item_id}: Invalid allowed decisions`);
    const module = context.modules.find(module => module.module_id === item.source_module_id)
      || item.module_targets.find(module => module.module_id === item.source_module_id)?.target;
    const expectedMeta = module ? { title_zh: module.title, stable_decision_zh: module.stable_decision, unified_preconditions_zh: module.unified_preconditions, page_expression_options: module.page_expression_options } : null;
    if (item.method_kind === 'lens' && !module) errors.push(`${item.item_id}: Unknown source Module`);
    if (item.method_kind === 'recipe' && item.source_module_id !== null) errors.push(`${item.item_id}: Recipe is catalog-level`);
    if (!same(item.module_meta, expectedMeta)) errors.push(`${item.item_id}: Module metadata differs from source`);
    if (Array.isArray(changes)) {
      const change = changes.find(change => change.method_kind === item.method_kind && change.object?.[key] === item.source_id);
      if (!change || !same(change.object, item.proposal) || change.source_module_id !== item.source_module_id || change.recommended_action !== item.recommended_action || !same(change.comparison, item.comparison)) errors.push(`${item.item_id}: Proposal is not a readonly projection of the change set`);
    }
    unique(item.merge_targets.map(target => target.target_id), `${item.item_id} target`, errors);
    unique(item.module_targets.map(target => target.module_id), `${item.item_id} module target`, errors);
    for (const target of item.merge_targets) {
      if (target.target[key] !== target.target_id) errors.push(`${item.item_id}: Inconsistent target ID`);
      if (item.method_kind === 'lens' && !item.module_targets.some(module => module.module_id === target.module_id && module.target.lens_catalog.some(lens => same(lens, target.target)))) errors.push(`${item.item_id}: Target Lens not in opened Module`);
      if (item.method_kind === 'recipe' && target.module_id !== null) errors.push(`${item.item_id}: Recipe target cannot have Module`);
      if (targetCopies.has(target.target_id) && !same(targetCopies.get(target.target_id), target)) errors.push(`Conflicting target ${target.target_id}`);
      targetCopies.set(target.target_id, target);
    }
    for (const target of item.module_targets) {
      if (target.module_id !== target.target.module_id) errors.push(`${item.item_id}: Inconsistent Module ID`);
      if (moduleCopies.has(target.module_id) && !same(moduleCopies.get(target.module_id), target)) errors.push(`Conflicting Module ${target.module_id}`);
      moduleCopies.set(target.module_id, target);
    }
    if (bundle.route === 'isolated_bootstrap' && (item.merge_targets.length || item.module_targets.length)) errors.push(`${item.item_id}: New library cannot expose existing targets`);
  }
  return { valid: errors.length === 0, errors };
}

export function validateFeedback(bundle, feedback, bundleRaw, { approvedOnly = false } = {}) {
  const errors = [...validateBundle(bundle).errors];
  const schema = contract('review-feedback.schema.json');
  validateAgainstSchema(feedback, schema, schema, '$', errors);
  if (errors.length) return { valid: false, errors };
  let rawMatches = false;
  try { rawMatches = typeof bundleRaw === 'string' && same(JSON.parse(bundleRaw), bundle); } catch {}
  if (!rawMatches) return { valid: false, errors: ['bundleRaw does not match bundle'] };
  if (feedback.review_bundle_sha256 !== hash(bundleRaw)) errors.push('review_bundle_sha256 does not match current bundle');
  if (feedback.route !== bundle.route) errors.push('Feedback route differs from bundle');
  if (!Number.isFinite(Date.parse(feedback.saved_at))) errors.push('Invalid saved_at');
  const byId = new Map();
  const items = new Map(bundle.items.map(item => [item.item_id, item]));
  const existing = existingLenses(bundle);
  const knownSources = new Set([...bundle.wiki_context.sources.map(source => source.source_module_instance_id),
    ...bundle.items.flatMap(item => methodSourceIds(item.proposal)),
    ...bundle.items.flatMap(item => item.merge_targets.flatMap(target => methodSourceIds(target.target))),
    ...[...existing.values()].flatMap(methodSourceIds)]);
  const mappedSources = new Set(bundle.wiki_context.sources.map(source => source.source_module_instance_id));
  for (const decision of feedback.decisions) {
    if (byId.has(decision.item_id)) errors.push(`Duplicate item_id: ${decision.item_id}`);
    byId.set(decision.item_id, decision);
    const item = items.get(decision.item_id);
    if (!item) { errors.push(`Unknown item_id: ${decision.item_id}`); continue; }
    const prefix = item.item_id;
    if (!item.allowed_decisions.includes(decision.decision)) errors.push(`${prefix}: Decision not allowed on this route`);
    if (targetDecisions.includes(decision.decision)) {
      if (!item.merge_targets.some(target => target.target_id === decision.target_id && target.module_id === decision.target_module_id)) errors.push(`${prefix}: Target not in opened bundle`);
    } else if (decision.target_id !== null) errors.push(`${prefix}: Unexpected target_id`);
    if (decision.decision === 'reroute') {
      if (!item.module_targets.some(target => target.module_id === decision.target_module_id)) errors.push(`${prefix}: Unknown target Module`);
    } else if (!targetDecisions.includes(decision.decision) && decision.target_module_id !== null) errors.push(`${prefix}: Unexpected target_module_id`);
    if (editedDecisions.includes(decision.decision) && !decision.edited_proposal) errors.push(`${prefix}: Complete edited_proposal required`);
    if (decision.edited_proposal) {
      let canonicalErrors;
      try { canonicalErrors = validateMethod(decision.edited_proposal, item.method_kind, `${prefix}.edited_proposal`); }
      catch (error) { canonicalErrors = [`${prefix}.edited_proposal: ${error.message}`]; }
      if (canonicalErrors.length) { errors.push(...canonicalErrors); continue; }
      const key = item.method_kind === 'lens' ? 'lens_id' : 'recipe_id';
      if (decision.edited_proposal[key] !== item.source_id) errors.push(`${prefix}: Edited ${key} must preserve source_id`);
      const ids = methodSourceIds(decision.edited_proposal);
      if (!ids.some(id => mappedSources.has(id))) errors.push(`${prefix}: Edited proposal needs a mapped source`);
      for (const id of ids) if (!knownSources.has(id)) errors.push(`${prefix}: Unknown source mapping ${id}`);
      if (['reject', 'defer', 'add_source', 'no_change'].includes(decision.decision)) errors.push(`${prefix}: Edited object cannot be used by this decision`);
    }
  }
  if (!approvedOnly) for (const item of bundle.items) if (!byId.has(item.item_id)) errors.push(`Missing decision: ${item.item_id}`);
  if (errors.length) return { valid: false, errors };
  const resolution = new Map();
  for (const item of bundle.items.filter(item => item.method_kind === 'lens')) {
    const decision = byId.get(item.item_id);
    if (!decision || !acceptedDecisions.includes(decision.decision)) continue;
    resolution.set(item.source_id, targetDecisions.includes(decision.decision) ? decision.target_id : item.source_id);
  }
  const candidates = new Set(bundle.items.filter(item => item.method_kind === 'lens').map(item => item.source_id));
  for (const item of bundle.items.filter(item => item.method_kind === 'recipe')) {
    const decision = byId.get(item.item_id);
    if (!decision || !['approve', 'revise', 'new', 'revision'].includes(decision.decision)) continue;
    const object = decision.edited_proposal || item.proposal;
    const executed = new Set([...(object.required_lens_ids || []), ...(object.steps || []).map(step => step.lens_id)]);
    for (const id of [...executed, ...(object.optional_lens_ids || [])]) {
      if (!candidates.has(id) && !existing.has(id)) errors.push(`${item.item_id}: Unknown Lens ${id}`);
      else if (executed.has(id) && !resolution.has(id) && !(existing.has(id) && !candidates.has(id))) errors.push(`${item.item_id}: Executed Lens ${id} not approved`);
    }
  }
  return { valid: errors.length === 0, errors };
}
