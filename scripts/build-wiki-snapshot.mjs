#!/usr/bin/env node
import { existsSync, lstatSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readWiki } from './lib/wiki-read.mjs';

const HELP = `Usage: build-wiki-snapshot.mjs --wiki-dir <Wiki> --output <snapshot.json> [--allow-empty]
Read and validate the whole indexed Wiki before writing a snapshot. Revisions are excluded.
Write snapshots outside the source Wiki directory; source files and symlink outputs cannot be overwritten.
The fingerprint is SHA-256 of sorted path:sha256 lines joined by LF (no final LF), using original file bytes.
--allow-empty  Permit a nonexistent or empty NEW directory (null fingerprint), ignoring only a regular
               installer .wiki-install.lock and recursively empty modules/revisions directories.
--help         Show help without reading or writing any files.
Success: exit 0, ok=true. Invalid arguments or Wiki: exit 2, ok=false; no snapshot is written.\n`;

export function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) { process.stdout.write(HELP); return; }
  try {
    const args = {};
    for (let offset = 0; offset < argv.length; offset += 1) {
      const key = argv[offset];
      if (!['--wiki-dir', '--output', '--allow-empty'].includes(key)) throw new Error(`Unknown option: ${key}`);
      if (Object.hasOwn(args, key)) throw new Error(`Duplicate option: ${key}`);
      if (key === '--allow-empty') args[key] = true;
      else {
        const value = argv[++offset];
        if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
        args[key] = value;
      }
    }
    if (!args['--wiki-dir'] || !args['--output']) throw new Error('--wiki-dir and --output are required');
    const wiki = readWiki(args['--wiki-dir'], { allowEmpty: args['--allow-empty'] === true });
    const output = resolve(args['--output']);
    const outputRelative = relative(wiki.wikiDir, output);
    const within = path => path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
    if (within(outputRelative)) throw new Error('Snapshot output must be outside the source Wiki directory');
    let outputStat;
    try { outputStat = lstatSync(output); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (outputStat?.isSymbolicLink()) throw new Error('Snapshot output cannot be a symlink');
    if (existsSync(wiki.wikiDir)) {
      const outputReal = join(realpathSync(dirname(output)), basename(output));
      if (within(relative(realpathSync(wiki.wikiDir), outputReal))) throw new Error('Snapshot output resolves inside the source Wiki directory');
      if (existsSync(output)) {
        const target = statSync(output);
        if (wiki.artifacts.some(artifact => { const source = statSync(resolve(wiki.wikiDir, artifact.path)); return target.dev === source.dev && target.ino === source.ino; })) throw new Error('Snapshot output is linked to a Wiki artifact');
      }
    }
    const snapshot = { contract_version: '1.0.0', wiki_dir: wiki.wikiDir, wiki_root_sha256: wiki.wiki_root_sha256,
      artifacts: wiki.artifacts, audit: wiki.audit, warnings: wiki.warnings, legacy_recipes: wiki.legacy_recipes };
    writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ok: true, valid: true, files: wiki.artifacts.length, output,
      wiki_dir: wiki.wikiDir, wiki_root_sha256: wiki.wiki_root_sha256, audit: wiki.audit, warnings: wiki.warnings })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, valid: false, error: { code: error.code || 'SNAPSHOT_ERROR', message: error.message, path: error.path ?? null } }, null, 2)}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
