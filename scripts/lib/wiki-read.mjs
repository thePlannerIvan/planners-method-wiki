import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const statuses = new Set(['draft', 'active', 'deprecated', 'deleted']);
const emptyCatalog = () => ({ contract_version: '1.0.0', catalog_version: '0.0.0', updated_at: '1970-01-01T00:00:00.000Z', recipes: [] });

function fail(code, message, path = null) {
  const error = new Error(message);
  error.code = code;
  if (path !== null) error.path = path;
  throw error;
}

function assert(condition, message, path) {
  if (!condition) fail('WIKI_INVALID', message, path);
}

function strings(value, label, path, { unique = false } = {}) {
  assert(Array.isArray(value) && value.every(item => typeof item === 'string' && item.trim()), `${label} must be an array of nonempty strings`, path);
  if (unique) assert(new Set(value).size === value.length, `${label} contains duplicate IDs`, path);
}

function sourceIds(value, label, path) {
  strings(value, label, path, { unique: true });
  assert(value.every(item => /^mi_[a-f0-9]{24}$/.test(item)), `${label} contains an invalid source Module instance ID`, path);
}

function id(value, kind, path) {
  const patterns = {
    module: /^mod_[a-z0-9][a-z0-9-]{2,63}$/,
    lens: /^lens_[a-z0-9][a-z0-9_-]{2,63}$/,
    recipe: /^recipe_[a-z0-9][a-z0-9_-]{2,63}$/,
    variant: /^(variant|lens)_[a-z0-9][a-z0-9_-]{2,63}$/,
  };
  assert(typeof value === 'string' && patterns[kind].test(value), `Invalid ${kind} ID: ${String(value)}`, path);
}

function contained(root, target) {
  const path = relative(root, target);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

function emptyNewDirectory(root) {
  const emptyTree = directory => readdirSync(directory, { withFileTypes: true })
    .every(entry => entry.isDirectory() && emptyTree(join(directory, entry.name)));
  return readdirSync(root, { withFileTypes: true }).every(entry => {
    if (entry.name === '.wiki-install.lock') return entry.isFile();
    return ['modules', 'revisions'].includes(entry.name) && entry.isDirectory() && emptyTree(join(root, entry.name));
  });
}

function safePath(root, rootReal, path) {
  assert(typeof path === 'string' && path.trim(), 'Wiki reference must be a nonempty path', path);
  if (isAbsolute(path) || /^[a-z]:/i.test(path) || path.includes('\\') || path.includes('\0') || path.split('/').some(part => part === '..' || part === 'revisions')) {
    fail('WIKI_PATH_ESCAPE', `Unsafe Wiki reference: ${path}`, path);
  }
  const target = resolve(root, path);
  if (!contained(root, target)) fail('WIKI_PATH_ESCAPE', `Wiki reference escapes root: ${path}`, path);
  let actual;
  try { actual = realpathSync(target); }
  catch (error) { fail('WIKI_FILE_MISSING', `Cannot resolve Wiki reference ${path}: ${error.message}`, path); }
  if (!contained(rootReal, actual)) fail('WIKI_PATH_ESCAPE', `Wiki symlink escapes root: ${path}`, path);
  return { target, actual, path: relative(root, target).split(sep).join('/') };
}

// Approval is diagnostic, not a filter: historical active methods remain visible.
export function wikiEligibility(value, module = null) {
  const hasStatus = Object.hasOwn(value, 'status');
  const rawStatus = hasStatus ? value.status : null;
  const status = hasStatus ? value.status : (module?.status ?? 'active');
  const approval = value.approval ?? null;
  const approvalScope = approval !== null ? 'object' : module?.approval ? 'module' : 'unrecorded';
  const effectiveApproval = approval !== null ? approval : module?.approval ?? null;
  const eligible = status === 'active' && value.deletion?.deleted !== true
    && (module === null || (module.status === 'active' && module.deletion?.deleted !== true));
  return {
    eligible, status, recorded_status: rawStatus,
    status_scope: hasStatus ? 'object' : module ? 'module' : 'legacy-unrecorded',
    approval, human_approved: approval?.human_approved ?? null,
    approval_scope: approvalScope, module_approval: module?.approval ?? null,
    human_approval_confirmed: effectiveApproval?.human_approved === true,
    requires_human_review: effectiveApproval?.human_approved !== true,
    deletion: value.deletion ?? null,
  };
}

function lifecycle(value, label, warnings, module = null) {
  const state = wikiEligibility(value, module);
  const add = (code, message) => warnings.push({ code, id: label, message });
  if (value.status !== undefined && !statuses.has(value.status)) add('UNKNOWN_STATUS', `Unrecognized status ${String(value.status)}; excluded from default query`);
  if (state.status_scope === 'legacy-unrecorded') add('UNRECORDED_STATUS', 'Legacy object has no recorded status; query compatibility treats it as active, without changing the object');
  if (value.approval !== undefined) assert(object(value.approval), `${label}.approval must be an object`, label);
  if (value.deletion !== undefined) {
    assert(object(value.deletion), `${label}.deletion must be an object`, label);
    assert(typeof value.deletion.deleted === 'boolean', `${label}.deletion.deleted must be boolean`, label);
  }
  if (state.eligible && value.approval?.human_approved !== true) {
    add('ITEM_APPROVAL_NOT_TRUE', state.approval_scope === 'module'
      ? 'No true object-level approval recorded; Module approval is reported separately'
      : 'Active historical object lacks true human approval; no approval has been inferred');
  }
  if (value.approval && typeof value.approval.human_approved !== 'boolean') add('INVALID_APPROVAL_VALUE', 'human_approved is not a boolean; only literal true confirms approval');
  if (value.status === 'active' && value.deletion?.deleted === true) add('STATUS_DELETION_CONFLICT', 'Active object is marked deleted; excluded from default query');
  return state;
}

export function readWiki(wikiDir, { allowEmpty = false } = {}) {
  assert(typeof allowEmpty === 'boolean', 'allowEmpty must be a boolean');
  const root = resolve(wikiDir);
  const empty = () => ({ wikiDir: root, index: null, modules: [], recipeCatalog: emptyCatalog(), artifacts: [], wiki_root_sha256: null,
    warnings: [], legacy_recipes: [], audit: { modules: 0, lenses: 0, recipes: 0, legacy_module_recipes: 0, legacy_recipe_conflicts: 0 } });
  let rootStat;
  try { rootStat = lstatSync(root); }
  catch (error) {
    if (allowEmpty && error.code === 'ENOENT') return empty();
    fail('WIKI_UNREADABLE', `Cannot read Wiki directory ${root}: ${error.message}`);
  }
  assert(rootStat.isDirectory() || rootStat.isSymbolicLink(), 'Wiki root must be a directory', root);
  const rootReal = realpathSync(root);
  assert(statSync(rootReal).isDirectory(), 'Wiki root must resolve to a directory', root);
  // Recheck NEW baselines under the installer's existing lock, including empty rollback directories.
  if (allowEmpty && emptyNewDirectory(root)) return empty();

  const artifacts = [];
  const realFiles = new Set();
  const warnings = [];
  function load(path) {
    const checked = safePath(root, rootReal, path);
    assert(checked.path.endsWith('.json') && statSync(checked.target).isFile(), `Wiki artifact must be a JSON file: ${path}`, path);
    assert(!realFiles.has(checked.actual), `Duplicate Wiki artifact reference: ${path}`, path);
    realFiles.add(checked.actual);
    let bytes;
    try { bytes = readFileSync(checked.target); }
    catch (error) { fail('WIKI_UNREADABLE', `Cannot read ${path}: ${error.message}`, path); }
    let content;
    try { content = JSON.parse(bytes.toString('utf8')); }
    catch (error) { fail('WIKI_INVALID_JSON', `Invalid JSON in ${path}: ${error.message}`, path); }
    assert(object(content), `Wiki artifact must contain a JSON object: ${path}`, path);
    artifacts.push({ path: checked.path, sha256: hash(bytes), content });
    return content;
  }
  const index = load('wiki-index.json');
  assert(Array.isArray(index.modules), 'wiki-index.modules must be an array', 'wiki-index.json');
  const moduleIds = new Set();
  const wikiModuleIds = new Set();
  const lensIds = new Set();
  const lensesById = new Map();
  const variantIds = new Set();
  const indexedPaths = new Set();
  const modules = [];
  for (const entry of index.modules) {
    assert(object(entry), 'Indexed Module reference must be an object', 'wiki-index.json');
    id(entry.module_id, 'module', 'wiki-index.json');
    assert(!moduleIds.has(entry.module_id), `Duplicate Module ID: ${entry.module_id}`, 'wiki-index.json');
    moduleIds.add(entry.module_id);
    for (const key of ['path', 'file']) if (entry[key] !== undefined) assert(typeof entry[key] === 'string' && entry[key].trim(), `Invalid indexed Module ${key}`, 'wiki-index.json');
    assert(entry.path === undefined || entry.file === undefined || entry.path === entry.file, `Conflicting path/file for ${entry.module_id}`, 'wiki-index.json');
    const ref = entry.path ?? entry.file ?? `modules/${entry.module_id}.json`;
    const module = load(ref);
    const path = artifacts.at(-1).path;
    indexedPaths.add(path);
    assert(module.module_id === entry.module_id, `Indexed Module ID does not match ${path}`, path);
    assert(typeof module.title === 'string' && module.title.trim(), 'Module title is required', path);
    assert(typeof module.stable_decision === 'string' && module.stable_decision.trim(), 'Module stable_decision is required', path);
    strings(module.unified_preconditions, 'Module unified_preconditions', path);
    sourceIds(module.source_module_instance_ids, 'Module source_module_instance_ids', path);
    assert(Array.isArray(module.page_expression_options), 'Module page_expression_options must be an array', path);
    assert(typeof module.wiki_version === 'string' && /^\d+\.\d+\.\d+$/.test(module.wiki_version), 'Invalid Module wiki_version', path);
    assert(Array.isArray(module.lens_catalog), 'Module lens_catalog must be an array', path);
    assert(module.status !== undefined, 'Module status is required', path);
    if (module.wiki_module_id !== undefined) {
      assert(/^wm_[a-f0-9]{24}$/.test(module.wiki_module_id), 'Invalid wiki_module_id', path);
      assert(!wikiModuleIds.has(module.wiki_module_id), `Duplicate wiki_module_id: ${module.wiki_module_id}`, path);
      wikiModuleIds.add(module.wiki_module_id);
      if (entry.wiki_module_id !== undefined) assert(entry.wiki_module_id === module.wiki_module_id, 'Indexed wiki_module_id mismatch', path);
    }
    lifecycle(module, module.module_id, warnings);
    for (const lens of module.lens_catalog) {
      assert(object(lens), 'Lens must be an object', path);
      id(lens.lens_id, 'lens', path);
      assert(!lensIds.has(lens.lens_id), `Duplicate Lens ID: ${lens.lens_id}`, path);
      lensIds.add(lens.lens_id);
      lensesById.set(lens.lens_id, lens);
      for (const key of ['name', 'question']) assert(typeof lens[key] === 'string' && lens[key].trim(), `${lens.lens_id}.${key} is required`, path);
      for (const key of ['aliases', 'use_conditions', 'skip_conditions', 'required_inputs', 'analysis_operations', 'output_types', 'failure_modes', 'boundaries']) strings(lens[key], `${lens.lens_id}.${key}`, path);
      sourceIds(lens.source_module_instance_ids, `${lens.lens_id}.source_module_instance_ids`, path);
      assert(Array.isArray(lens.variants), `${lens.lens_id}.variants must be an array`, path);
      for (const variant of lens.variants) {
        assert(object(variant), 'Lens variant must be an object', path);
        id(variant.variant_id, 'variant', path);
        assert(!variantIds.has(variant.variant_id), `Duplicate variant ID: ${variant.variant_id}`, path);
        variantIds.add(variant.variant_id);
        assert(typeof variant.name === 'string' && variant.name.trim(), 'Variant name is required', path);
        for (const key of ['use_conditions', 'analysis_operations']) strings(variant[key], `${variant.variant_id}.${key}`, path);
        sourceIds(variant.source_module_instance_ids, `${variant.variant_id}.source_module_instance_ids`, path);
      }
      lifecycle(lens, lens.lens_id, warnings, module);
    }
    if (entry.lenses !== undefined) {
      assert(Array.isArray(entry.lenses), 'Indexed lenses must be an array', 'wiki-index.json');
      const expected = new Set(module.lens_catalog.map(lens => lens.lens_id));
      const listed = new Set();
      for (const lens of entry.lenses) {
        assert(object(lens), 'Indexed Lens must be an object', 'wiki-index.json');
        id(lens.lens_id, 'lens', 'wiki-index.json');
        assert(!listed.has(lens.lens_id), `Duplicate indexed Lens ID: ${lens.lens_id}`, 'wiki-index.json');
        listed.add(lens.lens_id);
      }
      assert(listed.size === expected.size && [...listed].every(value => expected.has(value)), `Indexed Lens IDs do not match ${module.module_id}`, 'wiki-index.json');
    }
    modules.push(module);
  }

  function scanModules(path, ancestors = new Set()) {
    const checked = safePath(root, rootReal, path);
    assert(!ancestors.has(checked.actual), `Symlink directory cycle at ${path}`, path);
    const next = new Set([...ancestors, checked.actual]);
    for (const entry of readdirSync(checked.target, { withFileTypes: true })) {
      const child = `${checked.path}/${entry.name}`;
      const target = safePath(root, rootReal, child);
      const stat = statSync(target.target);
      if (stat.isDirectory()) scanModules(child, next);
      else if (entry.name.endsWith('.json') && !indexedPaths.has(target.path)) fail('WIKI_UNINDEXED_MODULE', `Unindexed Module file: ${target.path}`, target.path);
    }
  }
  function present(path) {
    try { lstatSync(join(root, path)); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  if (present('modules')) scanModules('modules');

  if (index.recipe_catalog !== undefined) assert(index.recipe_catalog === 'wiki-recipes.json', 'Unified recipe_catalog authority must be wiki-recipes.json', 'wiki-index.json');
  let recipeCatalog;
  if (present('wiki-recipes.json')) recipeCatalog = load('wiki-recipes.json');
  else {
    if (index.recipe_catalog !== undefined) fail('WIKI_FILE_MISSING', 'Indexed recipe catalog is missing: wiki-recipes.json', 'wiki-recipes.json');
    recipeCatalog = emptyCatalog();
    warnings.push({ code: 'RECIPE_CATALOG_ABSENT', message: 'No unified Recipe catalog recorded; Module recipes are not promoted' });
  }
  assert(recipeCatalog.contract_version === '1.0.0', 'Invalid Recipe catalog contract_version', 'wiki-recipes.json');
  assert(typeof recipeCatalog.catalog_version === 'string' && /^\d+\.\d+\.\d+$/.test(recipeCatalog.catalog_version), 'Invalid Recipe catalog_version', 'wiki-recipes.json');
  assert(typeof recipeCatalog.updated_at === 'string' && recipeCatalog.updated_at.length >= 10, 'Recipe catalog updated_at is required', 'wiki-recipes.json');
  assert(Array.isArray(recipeCatalog.recipes), 'wiki-recipes.recipes must be an array', 'wiki-recipes.json');
  const recipeIds = new Set();
  for (const recipe of recipeCatalog.recipes) {
    assert(object(recipe), 'Recipe must be an object', 'wiki-recipes.json');
    id(recipe.recipe_id, 'recipe', 'wiki-recipes.json');
    assert(!recipeIds.has(recipe.recipe_id), `Duplicate Recipe ID: ${recipe.recipe_id}`, 'wiki-recipes.json');
    recipeIds.add(recipe.recipe_id);
    for (const key of ['name', 'purpose']) assert(typeof recipe[key] === 'string' && recipe[key].trim(), `${recipe.recipe_id}.${key} is required`, 'wiki-recipes.json');
    for (const key of ['use_conditions', 'skip_conditions']) strings(recipe[key], `${recipe.recipe_id}.${key}`, 'wiki-recipes.json');
    sourceIds(recipe.source_module_instance_ids, `${recipe.recipe_id}.source_module_instance_ids`, 'wiki-recipes.json');
    for (const key of ['required_lens_ids', 'optional_lens_ids']) {
      strings(recipe[key], `${recipe.recipe_id}.${key}`, 'wiki-recipes.json', { unique: true });
      for (const member of recipe[key]) id(member, 'lens', 'wiki-recipes.json');
    }
    assert(recipe.required_lens_ids.length > 0, `${recipe.recipe_id} needs required Lens members`, 'wiki-recipes.json');
    const required = new Set(recipe.required_lens_ids);
    const optional = new Set(recipe.optional_lens_ids);
    assert([...optional].every(member => !required.has(member)), `${recipe.recipe_id} has overlapping required/optional members`, 'wiki-recipes.json');
    for (const member of required) assert(lensIds.has(member), `${recipe.recipe_id} references missing required Lens ${member}`, 'wiki-recipes.json');
    for (const member of optional) if (!lensIds.has(member)) warnings.push({ code: 'OPTIONAL_LENS_UNRESOLVED', id: recipe.recipe_id, lens_id: member, message: 'Optional Lens not present; no object or path has been fabricated' });
    assert(Array.isArray(recipe.steps) && recipe.steps.length >= 2, `${recipe.recipe_id}.steps must contain at least two steps`, 'wiki-recipes.json');
    const executed = new Set();
    for (const [offset, step] of recipe.steps.entries()) {
      assert(object(step) && step.step_index === offset + 1, `${recipe.recipe_id}: step_index must be contiguous from 1`, 'wiki-recipes.json');
      assert(required.has(step.lens_id) || optional.has(step.lens_id), `${recipe.recipe_id}: step ${step.step_index} references nonmember Lens ${step.lens_id}`, 'wiki-recipes.json');
      executed.add(step.lens_id);
      if (step.variant_id !== undefined) {
        id(step.variant_id, 'variant', 'wiki-recipes.json');
        const lens = lensesById.get(step.lens_id);
        if (lens) assert(lens.variants.some(variant => variant.variant_id === step.variant_id), `${recipe.recipe_id}: step ${step.step_index} references a missing or unrelated variant ${step.variant_id}`, 'wiki-recipes.json');
      }
      // Existing catalogs describe dependencies in prose; only explicit references can be graph-checked.
      if (step.dependency !== undefined) assert(typeof step.dependency === 'string', `${recipe.recipe_id}: dependency must be prose`, 'wiki-recipes.json');
      for (const key of ['depends_on', 'depends_on_steps', 'depends_on_step_indices']) if (step[key] !== undefined) {
        assert(Array.isArray(step[key]) && new Set(step[key]).size === step[key].length, `${recipe.recipe_id}: ${key} must be a unique array of step indices`, 'wiki-recipes.json');
        for (const dependency of step[key]) assert(Number.isInteger(dependency) && dependency > 0 && dependency < step.step_index, `${recipe.recipe_id}: step ${step.step_index} has missing, self, forward or cyclic dependency ${dependency}`, 'wiki-recipes.json');
      }
      for (const key of ['input', 'output']) if (step[key] !== undefined && typeof step[key] !== 'string') strings(step[key], `${recipe.recipe_id}.steps.${key}`, 'wiki-recipes.json');
    }
    for (const member of required) assert(executed.has(member), `${recipe.recipe_id}: required Lens ${member} has no step`, 'wiki-recipes.json');
    lifecycle(recipe, recipe.recipe_id, warnings);
  }
  const legacyRecipes = [];
  const legacyIds = new Set();
  for (const module of modules) {
    assert(module.recipes === undefined || Array.isArray(module.recipes), 'Module recipes must be an array', module.module_id);
    for (const recipe of module.recipes || []) {
      assert(object(recipe), 'Legacy Recipe must be an object', module.module_id);
      id(recipe.recipe_id, 'recipe', module.module_id);
      const authoritative = recipeCatalog.recipes.find(item => item.recipe_id === recipe.recipe_id);
      const conflict = authoritative !== undefined && !isDeepStrictEqual(recipe, authoritative);
      const duplicate = legacyIds.has(recipe.recipe_id);
      legacyIds.add(recipe.recipe_id);
      const sourcePath = artifacts.find(item => item.content === module).path;
      legacyRecipes.push({ module_id: module.module_id, source_path: sourcePath, recipe_id: recipe.recipe_id, conflict, duplicate_legacy_id: duplicate, authority: 'wiki-recipes.json', canonical_present: authoritative !== undefined, content: recipe });
      warnings.push({ code: conflict ? 'LEGACY_RECIPE_CONFLICT' : 'LEGACY_MODULE_RECIPE', id: recipe.recipe_id, source_path: sourcePath, message: 'Module-local Recipe retained for audit only; unified catalog is authoritative' });
    }
  }
  for (const variantId of variantIds) assert(!lensIds.has(variantId), `Variant ID collides with Lens ID: ${variantId}`, 'wiki-index.json');
  const allLenses = modules.flatMap(module => module.lens_catalog.map(lens => ({ lens, module })));
  const audit = {
    modules: modules.length, lenses: lensIds.size, recipes: recipeIds.size,
    active_modules: modules.filter(module => wikiEligibility(module).eligible).length,
    eligible_lenses: allLenses.filter(({ lens, module }) => wikiEligibility(lens, module).eligible).length,
    eligible_recipes: recipeCatalog.recipes.filter(recipe => wikiEligibility(recipe).eligible).length,
    module_human_approved_true: modules.filter(module => module.approval?.human_approved === true).length,
    module_human_approval_not_true: modules.filter(module => module.approval?.human_approved !== true).length,
    lens_item_human_approved_true: allLenses.filter(({ lens }) => lens.approval?.human_approved === true).length,
    lens_item_human_approval_not_true: allLenses.filter(({ lens }) => lens.approval?.human_approved !== true).length,
    active_lenses_without_confirmed_approval: allLenses.filter(({ lens, module }) => { const state = wikiEligibility(lens, module); return state.eligible && !state.human_approval_confirmed; }).length,
    recipe_human_approved_true: recipeCatalog.recipes.filter(recipe => recipe.approval?.human_approved === true).length,
    recipe_human_approval_not_true: recipeCatalog.recipes.filter(recipe => recipe.approval?.human_approved !== true).length,
    legacy_module_recipes: legacyRecipes.length,
    legacy_recipe_conflicts: legacyRecipes.filter(recipe => recipe.conflict).length,
    unresolved_optional_lenses: warnings.filter(warning => warning.code === 'OPTIONAL_LENS_UNRESOLVED').length,
  };
  artifacts.sort((a, b) => compare(a.path, b.path));
  return { wikiDir: root, index, modules, recipeCatalog, artifacts,
    wiki_root_sha256: hash(artifacts.map(item => `${item.path}:${item.sha256}`).join('\n')),
    warnings, legacy_recipes: legacyRecipes, audit };
}
