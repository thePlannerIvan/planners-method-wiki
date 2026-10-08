import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function argumentsOf(argv, flags = []) {
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    if (Object.hasOwn(values, key)) throw new Error(`Repeated argument: ${key}`);
    if (key === '--help' || flags.includes(key)) values[key] = true;
    else {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value: ${key}`);
      values[key] = argv[++i];
    }
  }
  return values;
}

export function isMain(url) {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(url);
}

export function runCli(main) {
  try {
    const report = main(process.argv.slice(2));
    if (report !== undefined) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report?.valid === false || report?.ok === false) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, valid: false, error: error.message }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
