import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { moduleScript } from './planners-modules.mjs';

const hash = raw => createHash('sha256').update(raw).digest('hex');

export function validateSourceReferences(sourceIndexPath, mappings) {
  const errors = [];
  const provenance = [];
  const indexPath = resolve(sourceIndexPath);
  const result = spawnSync(process.execPath, [moduleScript('planners-source-index', 'scripts/validate-source-index.mjs'), indexPath], { encoding: 'utf8' });
  if (result.status !== 0) return { valid: false, errors: [`Source index failed: ${(result.stdout || result.stderr).trim()}`], provenance };
  const raw = readFileSync(indexPath);
  const index = JSON.parse(raw);
  const root = resolve(dirname(indexPath), index.source_root);
  const sourceMap = new Map(index.sources.map(source => [source.source_id, source]));
  for (const mapping of mappings) {
    const source = sourceMap.get(mapping.source_id);
    if (!source) { errors.push(`Unregistered source: ${mapping.source_id}`); continue; }
    if (['unread', 'excluded'].includes(source.coverage.status)) { errors.push(`Source not read: ${mapping.source_id}`); continue; }
    const origin = resolve(root, source.origin.path);
    if (!existsSync(origin)) { errors.push(`Source file missing: ${origin}`); continue; }
    const originHash = hash(readFileSync(origin));
    if (originHash !== source.origin.sha256) errors.push(`Source changed: ${mapping.source_id}`);
    let audit = null;
    if (source.audit_layer.mode !== 'source_file') {
      const auditPath = source.audit_layer.path && resolve(dirname(indexPath), source.audit_layer.path);
      if (!auditPath || !existsSync(auditPath)) errors.push(`Audit source missing: ${mapping.source_id}`);
      else {
        const auditHash = hash(readFileSync(auditPath));
        if (source.audit_layer.sha256 && auditHash !== source.audit_layer.sha256) errors.push(`Audit source changed: ${mapping.source_id}`);
        audit = { path: auditPath, sha256: auditHash, mode: source.audit_layer.mode };
      }
    }
    provenance.push({ ...mapping, source_index: indexPath, source_index_sha256: hash(raw), origin: { path: origin, sha256: originHash }, audit_layer: audit, coverage: source.coverage });
  }
  return { valid: errors.length === 0, errors, provenance };
}
