#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argumentsOf, isMain, runCli } from './lib/cli.mjs';
import { validateFeedback } from './lib/review-validation.mjs';
export { validateFeedback } from './lib/review-validation.mjs';

export function main(argv) {
  const args = argumentsOf(argv, ['--approved-only']);
  if (args['--help']) return { usage: 'validate-review-feedback.mjs --feedback <review-feedback.json> --bundle <review-bundle.json> [--approved-only]' };
  if (!args['--feedback'] || !args['--bundle']) throw new Error('Missing --feedback or --bundle');
  const raw = readFileSync(resolve(args['--bundle']), 'utf8');
  return validateFeedback(JSON.parse(raw), JSON.parse(readFileSync(resolve(args['--feedback']), 'utf8')), raw, { approvedOnly: !!args['--approved-only'] });
}
if (isMain(import.meta.url)) runCli(main);
