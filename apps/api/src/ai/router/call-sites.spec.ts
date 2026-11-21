import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { isAiTask } from './tasks';

const SRC = join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

describe('every AI call site states a task (T08)', () => {
  const files = walk(SRC).filter((f) =>
    /\bai\.generate\(/.test(readFileSync(f, 'utf8')),
  );

  it('finds the known call sites', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it.each(files.map((f) => [f.slice(SRC.length + 1).replace(/\\/g, '/'), f]))(
    '%s passes a valid task on each ai.generate call',
    (_name, file) => {
      const src = readFileSync(file, 'utf8');
      const calls = src.match(/\bai\.generate\(/g)?.length ?? 0;
      const tasks = [...src.matchAll(/\btask:\s*'([a-z_]+)'/g)].map(
        (m) => m[1],
      );
      expect(tasks.length).toBe(calls);
      for (const t of tasks) expect(isAiTask(t)).toBe(true);
    },
  );
});
