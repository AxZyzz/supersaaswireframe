import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// Shared contract fixtures (packages/shared/src/agents): the SAME files the Python tests read.
export const SHARED_AGENTS_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'shared',
  'src',
  'agents',
);

export function fixture<T = unknown>(name: string): T {
  return JSON.parse(
    readFileSync(join(SHARED_AGENTS_DIR, 'fixtures', `${name}.json`), 'utf8'),
  ) as T;
}

export function sharedSchemaFiles(): string[] {
  return readdirSync(SHARED_AGENTS_DIR).filter((f) =>
    f.endsWith('.schema.json'),
  );
}
