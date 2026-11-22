/* eslint-disable @typescript-eslint/no-require-imports */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Learning Loop T16: the Looker Studio dashboard reads ONLY the demo views in
 * `expelly_demo`. Each one is hard-wired to a single workspace, so no other
 * customer's numbers can ever appear on a dashboard that gets shared. These
 * tests make that something CI enforces.
 */
const DIR = join(__dirname, '..', '..', '..', '..', 'infra', 'bigquery');
const read = (...p: string[]) => readFileSync(join(DIR, ...p), 'utf8');
const lf = (s: string) => s.replace(/\r\n/g, '\n');
const demoFiles = readdirSync(join(DIR, 'demo')).filter((f) =>
  f.endsWith('.sql'),
);
const learnViews = readdirSync(join(DIR, 'views'))
  .filter((f) => f.endsWith('.sql'))
  .map((f) => {
    const m = /CREATE OR REPLACE VIEW `\$\{PROJECT\}\.\$\{LEARN\}\.(\w+)`/.exec(
      read('views', f),
    );
    return m?.[1];
  })
  .filter((n): n is string => !!n);
const { addAuthorizedDataset } = require(join(DIR, 'demo', 'authorize.js')) as {
  addAuthorizedDataset: (
    d: { access?: unknown[]; [k: string]: unknown },
    project: string,
    dataset: string,
  ) => { access: unknown[]; [k: string]: unknown };
};

describe('demo views (T16): the dashboard can only ever show the demo workspace', () => {
  it('has the five views the dashboard needs', () => {
    expect(demoFiles.map((f) => f.replace(/^\d+_|\.sql$/g, ''))).toEqual([
      'demo_factor_funnel',
      'demo_send_time_grid',
      'demo_review_history',
      'demo_search_policy_compare',
      'demo_data_freshness',
    ]);
  });

  it.each(demoFiles)(
    '%s filters on the demo workspace id and nothing else',
    (f) => {
      const sql = lf(read('demo', f));
      // the one place the workspace id appears, and the only filter
      expect(sql).toMatch(/\bWHERE org_id = '\$\{DEMO_ORG_ID\}';\s*$/);
      expect(sql.match(/\$\{DEMO_ORG_ID\}/g)?.length).toBe(
        1 + (sql.match(/^-- .*\$\{DEMO_ORG_ID\}/gm)?.length ?? 0),
      );
      // no real workspace id is ever written into git
      expect(sql).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
    },
  );

  it.each(demoFiles)(
    '%s is one view over one expelly_learning view, and writes nothing',
    (f) => {
      const sql = lf(read('demo', f));
      const created = [
        ...sql.matchAll(
          /CREATE OR REPLACE VIEW `\$\{PROJECT\}\.\$\{DEMO\}\.(\w+)`/g,
        ),
      ];
      expect(created).toHaveLength(1);
      expect(created[0][1]).toBe(f.replace(/^\d+_|\.sql$/g, ''));
      // exactly one source: a view that exists in expelly_learning, never the raw dataset
      const sources = [
        ...sql.matchAll(/FROM `\$\{PROJECT\}\.\$\{(\w+)\}\.(\w+)`/g),
      ];
      expect(sources).toHaveLength(1);
      expect(sources[0][1]).toBe('LEARN');
      expect(learnViews).toContain(sources[0][2]);
      expect(sql).not.toMatch(/\$\{RAW\}|expelly_raw/);
      expect(sql).not.toMatch(
        /\b(INSERT|UPDATE|DELETE|DROP|MERGE|TRUNCATE)\b/i,
      );
      expect(sql).not.toMatch(/CREATE (OR REPLACE )?TABLE/i);
    },
  );

  it.each(demoFiles)('%s hides the workspace id column', (f) => {
    expect(lf(read('demo', f))).toMatch(/SELECT\s+\*\s+EXCEPT \(org_id\)/);
  });

  it('keeps the demo views out of the normal apply.sh run', () => {
    // apply.sh loops over views/*.sql only
    expect(read('apply.sh')).toMatch(/for f in views\/\*\.sql/);
    expect(readdirSync(join(DIR, 'views')).some((f) => /demo/.test(f))).toBe(
      false,
    );
  });

  it('apply-demo.sh refuses anything but a workspace id, and does not hard-code one', () => {
    const sh = lf(read('apply-demo.sh'));
    expect(sh).toMatch(/DEMO_ORG_ID="\$\{DEMO_ORG_ID:\?/);
    expect(sh).toMatch(/\[0-9a-fA-F\]\{8\}-/); // UUID check before any SQL
    expect(sh).not.toMatch(
      /DEMO_ORG_ID="[0-9a-f]{8}-[0-9a-f]{4}/i, // no default id
    );
  });
});

describe('authorized dataset helper', () => {
  const base = {
    access: [
      { role: 'OWNER', userByEmail: 'owner@example.com' },
      {
        view: {
          projectId: 'p',
          datasetId: 'expelly_learning',
          tableId: 'v',
        },
      },
    ],
    location: 'asia-south1',
  };

  it('adds expelly_demo once, for views only, and keeps every existing grant', () => {
    const once = addAuthorizedDataset(base, 'p', 'expelly_demo');
    expect(once.access).toHaveLength(3);
    expect(once.access.slice(0, 2)).toEqual(base.access);
    expect(once.access[2]).toEqual({
      dataset: {
        dataset: { projectId: 'p', datasetId: 'expelly_demo' },
        targetTypes: ['VIEWS'],
      },
    });
    expect(once.location).toBe('asia-south1');
  });

  it('is idempotent and does not touch its input', () => {
    const once = addAuthorizedDataset(base, 'p', 'expelly_demo');
    const twice = addAuthorizedDataset(once, 'p', 'expelly_demo');
    expect(twice.access).toHaveLength(3);
    expect(base.access).toHaveLength(2);
  });

  it('works when the dataset has no access list yet', () => {
    expect(addAuthorizedDataset({}, 'p', 'expelly_demo').access).toHaveLength(
      1,
    );
  });
});
