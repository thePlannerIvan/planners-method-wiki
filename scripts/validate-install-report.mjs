#!/usr/bin/env node
import { resolve } from 'node:path';
import { argumentsOf, isMain, runCli } from './lib/cli.mjs';
import { validateFile } from './lib/contract-validation.mjs';

export function main(argv) {
  const args = argv[0] && !argv[0].startsWith('--') ? { '--input': argv[0] } : argumentsOf(argv);
  if (args['--help']) return { usage: 'validate-install-report.mjs <install-report.json>' };
  if (!args['--input']) throw new Error('Missing report path');
  return validateFile(resolve(args['--input']), resolve(import.meta.dirname, '../contracts/install-report.schema.json'));
}
if (isMain(import.meta.url)) runCli(main);
