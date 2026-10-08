#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readWiki, wikiEligibility } from './lib/wiki-read.mjs';

const HELP = `Usage: query-wiki.mjs --query <keywords> [--wiki-dir <Wiki>] [--type lens|recipe|all] [--limit 5]
Defaults: --type lens, --limit 5 (1-12), --wiki-dir <Skill>/base-wiki.
Returns canonical objects, Module context, source paths, token/field occurrence counts and the exact Wiki fingerprint.
Matching counts case-insensitive keyword/alias substrings; Chinese text also uses Intl.Segmenter word tokens.
No score represents semantic confidence.
Active, nondeleted historical assets remain visible with their recorded approval and warnings.
Unified wiki-recipes.json is the only Recipe query authority; legacy Module recipes are audit-only.
Success (including zero matches): exit 0, ok=true. Invalid arguments or Wiki: exit 2, ok=false.
--help  Show this help without reading a Wiki.\n`;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!['--wiki-dir', '--query', '--type', '--limit'].includes(key)) throw new Error(`Unknown option: ${key}`);
    if (Object.hasOwn(args, key)) throw new Error(`Duplicate option: ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    args[key] = value;
  }
  return args;
}

export function queryTerms(query) {
  const chunks = query.toLowerCase().split(/[\s,，、；;|/。！？!?：:（）()]+/u).filter(Boolean);
  const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
  const stopwords = new Set(['如何', '怎么', '怎样', '什么', '需要', '可以', '一个', '我们', '进行', '通过', '找到']);
  const words = chunks.filter(chunk => /\p{Script=Han}/u.test(chunk))
    .flatMap(chunk => [...segmenter.segment(chunk)].filter(part => part.isWordLike && part.segment.length > 1).map(part => part.segment));
  return [...new Set([...chunks, ...words].filter(term => !stopwords.has(term)))];
}

function textLeaves(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(textLeaves);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(textLeaves);
  return [];
}

function matchFields(fields, terms) {
  const matches = [];
  for (const [field, value] of Object.entries(fields)) {
    const text = textLeaves(value).join('\n').toLowerCase();
    for (const term of terms) {
      const occurrences = text.split(term).length - 1;
      if (occurrences > 0) matches.push({ field, term, occurrences });
    }
  }
  return { score: matches.reduce((sum, match) => sum + match.occurrences, 0),
    matched_terms: terms.filter(term => matches.some(match => match.term === term)), matched_fields: matches };
}

const lensFields = ['lens_id', 'name', 'aliases', 'question', 'use_conditions', 'skip_conditions', 'required_inputs', 'analysis_operations', 'output_types', 'failure_modes', 'boundaries', 'variants', 'page_structure'];
const recipeFields = ['recipe_id', 'name', 'aliases', 'purpose', 'required_lens_ids', 'optional_lens_ids', 'steps', 'use_conditions', 'skip_conditions', 'required_inputs', 'output_types', 'failure_modes', 'boundaries', 'variants'];
const selected = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
function moduleDetails(module) {
  const { lens_catalog, recipes, ...details } = module;
  return details;
}

export function queryWiki(wiki, { query, type = 'lens', limit = 5 }) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('--query requires nonempty keywords');
  if (!['lens', 'recipe', 'all'].includes(type)) throw new Error('--type must be lens, recipe or all');
  if (!Number.isInteger(limit) || limit < 1 || limit > 12) throw new Error('--limit must be an integer from 1 to 12');
  const terms = queryTerms(query);
  if (!terms.length) throw new Error('--query contains no searchable tokens');
  const lensById = new Map();
  for (const module of wiki.modules) {
    const sourcePath = wiki.artifacts.find(artifact => artifact.content === module)?.path;
    for (const lens of module.lens_catalog) lensById.set(lens.lens_id, { lens, module, source_path: sourcePath });
  }
  const results = [];
  if (type !== 'recipe') for (const { lens, module, source_path } of lensById.values()) {
    const eligibility = wikiEligibility(lens, module);
    if (!eligibility.eligible) continue;
    const match = matchFields({ ...selected(lens, lensFields), 'module.module_id': module.module_id, 'module.title': module.title }, terms);
    if (!match.score) continue;
    results.push({ ...lens, type: 'lens', id: lens.lens_id, canonical: lens, ...match,
      source_path, source_absolute_path: resolve(wiki.wikiDir, source_path),
      module_id: module.module_id, module_name_zh: module.title, module_details: moduleDetails(module),
      name_zh: lens.name, question_zh: lens.question, eligibility,
      warnings: wiki.warnings.filter(warning => warning.id === lens.lens_id || warning.id === module.module_id) });
  }
  if (type !== 'lens') for (const recipe of wiki.recipeCatalog.recipes) {
    const eligibility = wikiEligibility(recipe);
    if (!eligibility.eligible) continue;
    const members = [...recipe.required_lens_ids, ...recipe.optional_lens_ids];
    const lensContext = members.map(lensId => {
      const found = lensById.get(lensId);
      return found ? { lens_id: lensId, optional: recipe.optional_lens_ids.includes(lensId), resolved: true,
        source_path: found.source_path, source_absolute_path: resolve(wiki.wikiDir, found.source_path),
        canonical: found.lens, module_id: found.module.module_id, module_details: moduleDetails(found.module),
        eligibility: wikiEligibility(found.lens, found.module) }
        : { lens_id: lensId, optional: true, resolved: false, source_path: null, canonical: null, eligibility: null };
    });
    const match = matchFields(selected(recipe, recipeFields), terms);
    if (!match.score) continue;
    const unavailable = lensContext.filter(context => !context.resolved || !context.eligibility.eligible);
    const requiredUnavailable = unavailable.filter(context => !context.optional);
    const stepContext = recipe.steps.map(step => ({ ...step, lens_context: lensContext.find(context => context.lens_id === step.lens_id) }));
    const relatedIds = new Set([recipe.recipe_id, ...members, ...lensContext.map(context => context.module_id)]);
    results.push({ ...recipe, type: 'recipe', id: recipe.recipe_id, canonical: recipe, ...match,
      source_path: 'wiki-recipes.json', source_absolute_path: resolve(wiki.wikiDir, 'wiki-recipes.json'),
      module_details: [...new Map(lensContext.filter(context => context.resolved).map(context => [context.module_id, context.module_details])).values()],
      lens_context: lensContext, step_context: stepContext, eligibility,
      dependency_status: { required_available: requiredUnavailable.length === 0,
        all_steps_available: stepContext.every(step => step.lens_context.resolved && step.lens_context.eligibility.eligible),
        unavailable_lens_ids: unavailable.map(context => context.lens_id),
        human_approval_confirmed: eligibility.human_approval_confirmed && lensContext.filter(context => !context.optional).every(context => context.eligibility?.human_approval_confirmed === true),
        dependency_validation: 'explicit step indices only; prose dependencies require human inspection' },
      warnings: [...wiki.warnings.filter(warning => relatedIds.has(warning.id)),
        ...unavailable.filter(context => context.resolved).map(context => ({ code: 'RECIPE_LENS_INELIGIBLE', id: recipe.recipe_id, lens_id: context.lens_id, message: 'Referenced Lens is inactive or deleted; not currently usable' }))] });
  }
  results.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { ok: true, wiki_dir: wiki.wikiDir, wiki_root_sha256: wiki.wiki_root_sha256,
    query, terms, type, limit, total_matches: results.length, returned: Math.min(limit, results.length), results: results.slice(0, limit),
    matching: { algorithm: 'case-insensitive keyword substring occurrences by field',
      tokenizer: 'delimiter chunks plus Intl.Segmenter zh words, excluding common question words',
      score_meaning: 'occurrence count, not applicability or semantic confidence' },
    audit: wiki.audit, warnings: wiki.warnings, legacy_recipes: wiki.legacy_recipes,
    note_zh: '只读检索结果用于刺激问题定义或论述结构；不得替代项目资料生成答案。' };
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) { process.stdout.write(HELP); return; }
  let wikiDir = null;
  try {
    const args = parseArgs(argv);
    wikiDir = resolve(args['--wiki-dir'] || resolve(import.meta.dirname, '../base-wiki'));
    const query = args['--query'];
    const type = args['--type'] ?? 'lens';
    const limit = args['--limit'] === undefined ? 5 : Number(args['--limit']);
    if (!query?.trim() || !queryTerms(query).length) throw new Error('--query requires nonempty keywords');
    if (!['lens', 'recipe', 'all'].includes(type)) throw new Error('--type must be lens, recipe or all');
    if (!Number.isInteger(limit) || limit < 1 || limit > 12) throw new Error('--limit must be an integer from 1 to 12');
    process.stdout.write(`${JSON.stringify(queryWiki(readWiki(wikiDir), { query, type, limit }), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, wiki_dir: wikiDir, error: { code: error.code || 'QUERY_ERROR', message: error.message, path: error.path ?? null } }, null, 2)}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
