#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { argumentsOf, isMain, runCli } from './lib/cli.mjs';
import { parseArtifact, validateAgainstSchema } from './lib/contract-validation.mjs';
import { contract } from './lib/method-contracts.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
export function main(argv) {
  const args = argumentsOf(argv);
  if (args['--help']) return { usage: 'materialize-semantic-units.mjs --plans <plans.jsonl> --page-manifest <manifest.jsonl> --text-root <directory> --output-dir <directory>', plan_contract: 'contracts/semantic-unit-plan.schema.json' };
  for (const key of ['--plans', '--page-manifest', '--text-root', '--output-dir']) if (!args[key]) throw new Error(`Missing ${key}`);
  const root = realpathSync(resolve(args['--text-root']));
  const out = resolve(args['--output-dir']);
  if (out === root || out.startsWith(`${root}/`)) throw new Error('Output must be outside the input text tree');
  const pages = parseArtifact(resolve(args['--page-manifest'])).records;
  const plans = parseArtifact(resolve(args['--plans'])).records;
  const schema = contract('semantic-unit-plan.schema.json');
  const units = [], discards = [], ids = new Set();
  for (const plan of plans) {
    const errors = validateAgainstSchema(plan, schema, schema, '$', []);
    if (errors.length) throw new Error(errors.join('; '));
    const source = pages.filter(page => page.source_record_id === plan.source_record_id);
    if (!source.length) throw new Error(`Source record missing: ${plan.source_record_id}`);
    const path = realpathSync(resolve(root, source[0].text_path));
    const rel = relative(root, path);
    if (rel.startsWith('..')) throw new Error('Source reference escapes text root');
    const text = readFileSync(path, 'utf8');
    if (hash(text) !== plan.source_sha256) throw new Error(`Source hash mismatch: ${plan.source_record_id}`);
    const chunks = text.split('\f');
    if (plan.page_count !== chunks.length) throw new Error('Page count differs from actual source segments');
    const pageRecord = (id, number) => {
      const meta = source.find(page => page.page_id === id && (number === undefined || page.page_number === number));
      if (!meta || meta.text_path !== source[0].text_path || hash(chunks[meta.page_number - 1] || '') !== meta.text_sha256) throw new Error(`Page mismatch: ${id}`);
      return { page_id: id, page_number: meta.page_number, text: chunks[meta.page_number - 1] };
    };
    for (const unit of plan.units) {
      if (ids.has(unit.unit_id)) throw new Error(`Duplicate semantic unit: ${unit.unit_id}`);
      ids.add(unit.unit_id);
      if (unit.page_ids.length !== unit.page_numbers.length) throw new Error('Page IDs and numbers differ in length');
      units.push({ ...unit, source_record_id: plan.source_record_id, pages: unit.page_ids.map((id, i) => pageRecord(id, unit.page_numbers[i])), support_pages: (unit.support_page_ids || []).map(id => pageRecord(id)) });
    }
    for (const discarded of plan.discarded_pages) { pageRecord(discarded.page_id, discarded.page_number); discards.push({ ...discarded, source_record_id: plan.source_record_id }); }
  }
  mkdirSync(join(out, 'units'), { recursive: true });
  for (const unit of units) writeFileSync(join(out, 'units', `${unit.unit_id}.json`), `${JSON.stringify(unit, null, 2)}\n`);
  writeFileSync(join(out, 'semantic-units.jsonl'), units.map(value => JSON.stringify(value)).join('\n') + (units.length ? '\n' : ''));
  writeFileSync(join(out, 'discarded-pages.jsonl'), discards.map(value => JSON.stringify(value)).join('\n') + (discards.length ? '\n' : ''));
  return { valid: true, units: units.length, discarded_pages: discards.length, source_text_hash_verified: true, output_dir: out };
}
if (isMain(import.meta.url)) runCli(main);
