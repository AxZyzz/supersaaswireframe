import {
  aggregate,
  type CompanyRow,
  type Slice,
  type VariantInfo,
} from './review-aggregate';
import { POLICY_VERSION, type ReviewInput } from './policy';

/**
 * "Try simulation" (Learning Loop T05). Builds a fake, clearly labelled
 * dataset in memory with a fixed seed and runs it through the SAME aggregation
 * and policy as real results. Nothing here touches the database.
 */

export const SCENARIOS = [
  {
    id: 'valid_winner',
    label: 'A clear winner',
    blurb:
      'Version B gets about 3x the confirmed qualified replies, with healthy delivery.',
  },
  {
    id: 'inconclusive_small',
    label: 'Too close to call',
    blurb:
      'A promising lift on a small sample: the range is still too wide to decide.',
  },
  {
    id: 'high_open_low_conv',
    label: 'High opens, low conversion',
    blurb:
      'Version B is opened twice as often but converts far worse. Opens never decide.',
  },
  {
    id: 'delivery_imbalance',
    label: 'Delivery imbalance',
    blurb:
      'One version reached far fewer inboxes, so the wording cannot be judged fairly yet.',
  },
  {
    id: 'misleading_city',
    label: 'Misleading city effect',
    blurb:
      'Pune looks strong, but the effect disappears once the buying trigger is held constant.',
  },
] as const;

export type ScenarioId = (typeof SCENARIOS)[number]['id'];
export const isScenario = (v: unknown): v is ScenarioId =>
  SCENARIOS.some((s) => s.id === v);

const SEED = 20261121;
const NOW = new Date('2026-12-20T00:00:00Z');
const FIRST_SENT = new Date('2026-11-20T10:00:00Z');

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VARIANTS: VariantInfo[] = [
  { id: 'sim-a', label: 'A', isControl: true },
  { id: 'sim-b', label: 'B', isControl: false },
];

interface ArmSpec {
  n: number;
  qualified: number;
  opened: number;
  bounced: number;
  undelivered?: number;
  replied: number;
  booked: number;
  unsubscribed: number;
}

const CITIES = ['Pune', 'Mumbai', 'Bengaluru', 'Delhi', 'Hyderabad'];
const INDUSTRIES = [
  'saas',
  'agency_marketing',
  'ecommerce',
  'healthcare_clinic',
];
const TRIGGERS: Array<string | null> = ['hiring', 'expansion', 'funding', null];

/** Which `k` of `n` rows get a flag: a seeded shuffle, so effects are not tied to row order. */
function pick(n: number, k: number, rng: () => number): Set<number> {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return new Set(idx.slice(0, k));
}

function armRows(
  variantId: string,
  prefix: string,
  spec: ArmSpec,
  rng: () => number,
  attrs?: (i: number) => Pick<CompanyRow, 'city' | 'industry' | 'trigger'>,
): CompanyRow[] {
  const q = pick(spec.n, spec.qualified, rng);
  const o = pick(spec.n, spec.opened, rng);
  const b = pick(spec.n, spec.bounced, rng);
  const u = pick(spec.n, spec.undelivered ?? 0, rng);
  const r = pick(spec.n, spec.replied, rng);
  const bk = pick(spec.n, spec.booked, rng);
  const un = pick(spec.n, spec.unsubscribed, rng);
  return Array.from({ length: spec.n }, (_, i) => {
    const bounced = b.has(i);
    return {
      variantId,
      companyKey: `${prefix}-${String(i + 1).padStart(4, '0')}.example`,
      firstSentAt: FIRST_SENT,
      opened: o.has(i),
      bounced,
      undelivered: !bounced && u.has(i),
      replied: r.has(i) || q.has(i),
      qualifiedVerified: q.has(i),
      qualifiedProvisional: false,
      booked: bk.has(i),
      unsubscribed: un.has(i),
      complaint: false,
      ...(attrs
        ? attrs(i)
        : {
            city: CITIES[Math.floor(rng() * CITIES.length)],
            industry: INDUSTRIES[Math.floor(rng() * INDUSTRIES.length)],
            trigger: TRIGGERS[Math.floor(rng() * TRIGGERS.length)],
          }),
    };
  });
}

interface Cell {
  city: string;
  trigger: string | null;
  n: number;
  q: number;
}

/** Rows built from exact (city, trigger) cells, so the effect is known by construction. */
function cellRows(
  variantId: string,
  prefix: string,
  cells: Cell[],
  rng: () => number,
): CompanyRow[] {
  const rows: CompanyRow[] = [];
  for (const c of cells) {
    const q = pick(c.n, c.q, rng);
    for (let i = 0; i < c.n; i++) {
      rows.push({
        variantId,
        companyKey: `${prefix}-${String(rows.length + 1).padStart(4, '0')}.example`,
        firstSentAt: FIRST_SENT,
        opened: rng() < 0.3,
        bounced: rng() < 0.02,
        replied: q.has(i),
        qualifiedVerified: q.has(i),
        qualifiedProvisional: false,
        booked: false,
        unsubscribed: false,
        complaint: false,
        city: c.city,
        industry: INDUSTRIES[Math.floor(rng() * INDUSTRIES.length)],
        trigger: c.trigger,
      });
    }
  }
  return rows;
}

export interface Simulation {
  scenario: ScenarioId;
  label: string;
  note: string;
  input: ReviewInput;
  slices: Slice[];
}

const base = (
  scenario: ScenarioId,
  rows: CompanyRow[],
  targetNPerArm: number,
): Pick<Simulation, 'input' | 'slices'> => {
  const agg = aggregate(rows, VARIANTS, NOW, 14);
  return {
    slices: agg.slices,
    input: {
      experimentId: `simulation:${scenario}`,
      policyVersion: POLICY_VERSION,
      now: NOW,
      decisionDate: new Date('2026-12-05T00:00:00Z'),
      earliestFullRead: agg.earliestFullRead,
      baselineRate: 0.03,
      minLiftPp: 2,
      targetNPerArm,
      guardrails: { bounce: 0.05, unsub: 0.02, complaint: 0.003 },
      coverageGate: 0.9,
      outcomeCoverage: 1,
      arms: agg.arms,
      flags: {
        unattributedReplies: 0,
        ambiguousAttribution: 0,
        variantEditedWhileRunning: false,
      },
      simulated: true,
    },
  };
};

/** Build the fake dataset for a scenario. Same scenario, same numbers, every time. */
export function simulate(scenario: ScenarioId): Simulation {
  const rng = mulberry32(SEED);
  const meta = SCENARIOS.find((s) => s.id === scenario)!;
  let rows: CompanyRow[];
  let target = 800;

  switch (scenario) {
    case 'valid_winner':
      rows = [
        ...armRows(
          'sim-a',
          'a',
          {
            n: 1000,
            qualified: 20,
            opened: 300,
            bounced: 20,
            replied: 40,
            booked: 5,
            unsubscribed: 3,
          },
          rng,
        ),
        ...armRows(
          'sim-b',
          'b',
          {
            n: 1000,
            qualified: 60,
            opened: 310,
            bounced: 20,
            replied: 80,
            booked: 15,
            unsubscribed: 3,
          },
          rng,
        ),
      ];
      break;
    case 'inconclusive_small':
      target = 150;
      rows = [
        ...armRows(
          'sim-a',
          'a',
          {
            n: 200,
            qualified: 6,
            opened: 60,
            bounced: 4,
            replied: 10,
            booked: 1,
            unsubscribed: 1,
          },
          rng,
        ),
        ...armRows(
          'sim-b',
          'b',
          {
            n: 200,
            qualified: 18,
            opened: 62,
            bounced: 4,
            replied: 24,
            booked: 4,
            unsubscribed: 1,
          },
          rng,
        ),
      ];
      break;
    case 'high_open_low_conv':
      target = 1500;
      rows = [
        ...armRows(
          'sim-a',
          'a',
          {
            n: 2000,
            qualified: 80,
            opened: 600,
            bounced: 40,
            replied: 150,
            booked: 20,
            unsubscribed: 10,
          },
          rng,
        ),
        ...armRows(
          'sim-b',
          'b',
          {
            n: 2000,
            qualified: 20,
            opened: 1200,
            bounced: 40,
            replied: 60,
            booked: 5,
            unsubscribed: 10,
          },
          rng,
        ),
      ];
      break;
    case 'delivery_imbalance':
      rows = [
        ...armRows(
          'sim-a',
          'a',
          {
            n: 1000,
            qualified: 20,
            opened: 300,
            bounced: 20,
            replied: 40,
            booked: 5,
            unsubscribed: 3,
          },
          rng,
        ),
        ...armRows(
          'sim-b',
          'b',
          {
            n: 1000,
            qualified: 40,
            opened: 250,
            bounced: 20,
            undelivered: 160,
            replied: 60,
            booked: 8,
            unsubscribed: 3,
          },
          rng,
        ),
      ];
      break;
    case 'misleading_city': {
      // Both versions behave the same. The buying trigger drives replies
      // (hiring ~9%, none ~2%) and most Pune companies happen to be hiring,
      // so Pune LOOKS strong. Within a trigger there is no city effect.
      const cells = (q: number[]): Cell[] => [
        { city: 'Pune', trigger: 'hiring', n: 160, q: q[0] },
        { city: 'Pune', trigger: null, n: 40, q: q[1] },
        { city: 'Delhi', trigger: 'hiring', n: 40, q: q[2] },
        { city: 'Mumbai', trigger: 'hiring', n: 40, q: q[3] },
        { city: 'Delhi', trigger: null, n: 160, q: q[4] },
        { city: 'Mumbai', trigger: null, n: 160, q: q[5] },
      ];
      rows = [
        ...cellRows('sim-a', 'a', cells([14, 1, 4, 3, 3, 3]), rng),
        ...cellRows('sim-b', 'b', cells([15, 1, 4, 4, 3, 3]), rng),
      ];
      target = 500;
      break;
    }
  }

  const note =
    scenario === 'misleading_city'
      ? 'Looking only at city, Pune seems to reply 2x more. Look at the trigger table: hiring companies reply more everywhere, and most Pune companies were hiring. Treat slices as hints to test, never as a decision.'
      : meta.blurb;
  return { scenario, label: meta.label, note, ...base(scenario, rows, target) };
}
