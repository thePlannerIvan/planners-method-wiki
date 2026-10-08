#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { argumentsOf, isMain } from './lib/cli.mjs';
import { buildReviewBundle } from './build-review-bundle.mjs';
import { hash } from './lib/review-validation.mjs';
import { contextPath, surfaceOnly, openSurface } from './review-surface-support.mjs';

export async function startLibraryReview(argv) {
  const args = argumentsOf(argv, ['--surface-only', '--no-open']);
  if (args['--help']) return { usage: 'start-library-review.mjs --change-set <change-set.json> --review-dir <Run/review> [--surface-only] [--no-open]' };
  if (!args['--change-set'] || !args['--review-dir']) throw new Error('Missing --change-set or --review-dir');
  const reviewDir = resolve(args['--review-dir']);
  const bundlePath = join(reviewDir, 'review-bundle.json');
  const bundleReport = buildReviewBundle(args['--change-set'], bundlePath);
  const page = spawnSync(process.execPath, [join(import.meta.dirname, 'build-review-page.mjs'), '--bundle', bundlePath, '--output', join(reviewDir, 'index.html')], { encoding: 'utf8' });
  if (page.status !== 0) throw new Error(`Review page failed: ${page.stderr || page.stdout}`);
  const bundleRaw = readFileSync(bundlePath, 'utf8');
  writeFileSync(contextPath(reviewDir), `${JSON.stringify({ contract_version: 'method-wiki-review-context/1.0.0',
    bundle_path: bundlePath, review_bundle_sha256: hash(bundleRaw), change_set_path: resolve(args['--change-set']), source_sha256: bundleReport.source_sha256 }, null, 2)}\n`);
  const surface = surfaceOnly(reviewDir);
  if (args['--surface-only']) return { ok: true, ...surface, bundle: bundlePath, review_bundle_sha256: hash(bundleRaw) };
  const host = await openSurface(reviewDir, { open: !args['--no-open'] });
  return { ok: true, ...surface, ...host, host_started: true, bundle: bundlePath,
    review_bundle_sha256: hash(bundleRaw), feedback: join(reviewDir, 'review-feedback.json') };
}
export const main = startLibraryReview;
if (isMain(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(await startLibraryReview(process.argv.slice(2)), null, 2)}\n`); }
  catch (error) { process.stdout.write(`${JSON.stringify({ ok: false, error: error.message })}\n`); process.exitCode = 1; }
}
