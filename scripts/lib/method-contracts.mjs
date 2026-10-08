import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateAgainstSchema } from './contract-validation.mjs';

export const contract = name => JSON.parse(readFileSync(resolve(import.meta.dirname, '../../contracts', name), 'utf8'));

export function validateMethod(value, kind, path = '$') {
  const root = contract(kind === 'lens' ? 'wiki-module.schema.json' : 'wiki-recipe-catalog.schema.json');
  const schema = kind === 'lens' ? root.properties.lens_catalog.items : root.properties.recipes.items;
  const errors = validateAgainstSchema(value, schema, root, path, []);
  if (kind === 'recipe' && Array.isArray(value?.steps)) {
    const members = new Set([...(value.required_lens_ids || []), ...(value.optional_lens_ids || [])]);
    const steps = new Set();
    const required = new Set(value.required_lens_ids || []);
    for (const id of value.optional_lens_ids || []) if (required.has(id)) errors.push(`${path}: Required and optional members overlap: ${id}`);
    for (const [offset, step] of value.steps.entries()) {
      if (!Number.isInteger(step.step_index) || step.step_index < 1 || steps.has(step.step_index)) errors.push(`${path}: Recipe step_index must be positive and unique`);
      if (step.step_index !== offset + 1) errors.push(`${path}: Recipe step_index must be contiguous from 1`);
      steps.add(step.step_index);
      if (!members.has(step.lens_id)) errors.push(`${path}: Recipe step references a non-member Lens ${step.lens_id}`);
      for (const key of ['role', 'input', 'output', 'dependency']) if (typeof step[key] !== 'string') errors.push(`${path}: Recipe step missing ${key}`);
      for (const key of ['depends_on', 'depends_on_steps', 'depends_on_step_indices']) {
        if (step[key] !== undefined && (!Array.isArray(step[key]) || new Set(step[key]).size !== step[key].length || step[key].some(index => !Number.isInteger(index) || index < 1 || index >= step.step_index))) errors.push(`${path}: Invalid ${key} dependency`);
      }
    }
    for (const id of value.required_lens_ids || []) if (!value.steps.some(step => step.lens_id === id)) errors.push(`${path}: Required Lens ${id} has no step`);
  }
  return errors;
}

export function methodSourceIds(object) {
  return [...new Set([...(object?.source_module_instance_ids || []), ...(object?.variants || []).flatMap(value => value.source_module_instance_ids || [])])];
}
