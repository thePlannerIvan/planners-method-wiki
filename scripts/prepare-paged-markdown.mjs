#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { argumentsOf, isMain, runCli } from './lib/cli.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
export function main(argv) {
  const args = argumentsOf(argv);
  if (args['--help']) return { usage: 'prepare-paged-markdown.mjs --text-root <Markdown directory> --corpus-id <id> --output-dir <directory>', boundary: 'Uses existing form-feed boundaries; unpaged material stays one text segment' };
  for (const key of ['--text-root', '--corpus-id', '--output-dir']) if (!args[key]) throw new Error(`Missing ${key}`);
  const root = resolve(args['--text-root']);
  const out = resolve(args['--output-dir']);
  if (out === root || out.startsWith(`${root}/`)) throw new Error('Output must be outside the input text tree');
  const files = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(path);
    }
  };
  walk(root);
  if (!files.length) throw new Error('No Markdown found; read original files with appropriate document tools first');
  const corpus = [], pages = [], warnings = [];
  for (const file of files.sort()) {
    const content = readFileSync(file, 'utf8');
    const rel = relative(root, file).split('\\').join('/');
    const parts = content.split('\f');
    const recordId = `cr_${hash(`${args['--corpus-id']}:${rel}:${hash(content)}`).slice(0, 24)}`;
    if (parts.length === 1 && Buffer.byteLength(content) > 12000) warnings.push(`${rel}: long unpaged material remains one segment; no source page numbers inferred`);
    corpus.push({ contract_version: '1.0.0', record_id: recordId, corpus_id: args['--corpus-id'], relative_path: rel, format: 'md', source_sha256: hash(content), page_count: parts.length, processing_state: 'ready' });
    parts.forEach((text, index) => pages.push({ contract_version: '1.0.0', page_id: `pg_${hash(`${recordId}:${index + 1}`).slice(0, 24)}`, corpus_id: args['--corpus-id'], source_record_id: recordId, source_sha256: hash(content), page_number: index + 1, page_count: parts.length, boundary_method: parts.length > 1 ? 'form_feed' : 'text_segment', text_path: rel, text_sha256: hash(text), char_count: text.length, visual_status: 'not_checked' }));
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'corpus-manifest.jsonl'), `${corpus.map(value => JSON.stringify(value)).join('\n')}\n`);
  writeFileSync(join(out, 'page-manifest.jsonl'), `${pages.map(value => JSON.stringify(value)).join('\n')}\n`);
  const report = { valid: true, files: files.length, pages: pages.length, warnings, output_dir: out };
  writeFileSync(join(out, 'preparation-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
if (isMain(import.meta.url)) runCli(main);
