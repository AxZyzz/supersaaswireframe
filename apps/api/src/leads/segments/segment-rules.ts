import { BadRequestException } from '@nestjs/common';

/**
 * Smart-segment rule engine. Translates a validated rule set into a
 * parameterized WHERE clause over the `leads` table (alias `l`). Everything is
 * whitelisted (fields + ops) and every value is a bind parameter — no user
 * string ever reaches the SQL text, so this is injection-safe.
 *
 * Engagement predicates (T2.7) read sent_emails / email_events, so smart
 * segments like "emailed but never opened" refresh as tracking lands.
 */

export interface Condition {
  field: string;
  op: string;
  value?: string | number;
}

export interface RuleSet {
  match: 'all' | 'any';
  conditions: Condition[];
}

type Builder = (cond: Condition, bind: (v: unknown) => string) => string;

const hasEvent = (type: string) =>
  `EXISTS (SELECT 1 FROM email_events ev WHERE ev.lead_id = l.id AND ev.type = '${type}')`;
const wasEmailed = `EXISTS (SELECT 1 FROM sent_emails se WHERE se.lead_id = l.id AND se.status = 'sent')`;

const BUILDERS: Record<string, Record<string, Builder>> = {
  status: { eq: (c, b) => `l.status = ${b(String(c.value))}` },
  score: {
    eq: (c, b) => {
      if (!['hot', 'warm', 'cold'].includes(String(c.value))) {
        throw new BadRequestException('Invalid score value');
      }
      return `l.score = ${b(String(c.value))}`;
    },
  },
  source: {
    eq: (c, b) => `l.source = ${b(String(c.value))}`,
    contains: (c, b) => `l.source ILIKE ${b(`%${String(c.value)}%`)}`,
  },
  company: {
    contains: (c, b) => `l.company ILIKE ${b(`%${String(c.value)}%`)}`,
  },
  email: {
    present: () => `l.email IS NOT NULL`,
    absent: () => `l.email IS NULL`,
  },
  tag: {
    has: (c, b) =>
      `EXISTS (SELECT 1 FROM lead_tags lt WHERE lt.lead_id = l.id AND lt.tag_id = ${b(String(c.value))}::uuid)`,
    not_has: (c, b) =>
      `NOT EXISTS (SELECT 1 FROM lead_tags lt WHERE lt.lead_id = l.id AND lt.tag_id = ${b(String(c.value))}::uuid)`,
  },
  // value-less: the op is the whole predicate. Types are literals, never input.
  engagement: {
    emailed: () => wasEmailed,
    never_emailed: () => `NOT ${wasEmailed}`,
    opened: () => hasEvent('open'),
    never_opened: () => `${wasEmailed} AND NOT ${hasEvent('open')}`,
    clicked: () => hasEvent('click'),
    replied: () => hasEvent('reply'),
    not_replied: () => `${wasEmailed} AND NOT ${hasEvent('reply')}`,
  },
  created: {
    within_days: (c, b) => {
      const n = Number(c.value);
      if (!Number.isFinite(n) || n <= 0 || n > 3650) {
        throw new BadRequestException('within_days must be 1..3650');
      }
      return `l.created_at >= now() - make_interval(days => ${b(n)})`;
    },
  },
};

/** Returns a WHERE fragment (without the WHERE keyword) + its bind params. */
export function buildWhere(
  rules: RuleSet,
  startIndex = 0,
): { clause: string; params: unknown[] } {
  if (!rules || !Array.isArray(rules.conditions)) {
    throw new BadRequestException('rules.conditions must be an array');
  }
  if (rules.conditions.length === 0) {
    // Empty rule set matches everything (a segment of all leads).
    return { clause: 'TRUE', params: [] };
  }
  if (rules.match !== 'all' && rules.match !== 'any') {
    throw new BadRequestException('rules.match must be "all" or "any"');
  }

  const params: unknown[] = [];
  const bind = (v: unknown) => {
    params.push(v);
    return `$${startIndex + params.length}`;
  };

  const parts = rules.conditions.map((cond) => {
    const byOp = BUILDERS[cond.field];
    if (!byOp) throw new BadRequestException(`Unknown field: ${cond.field}`);
    const builder = byOp[cond.op];
    if (!builder) {
      throw new BadRequestException(
        `Unknown op "${cond.op}" for field "${cond.field}"`,
      );
    }
    return `(${builder(cond, bind)})`;
  });

  const joiner = rules.match === 'all' ? ' AND ' : ' OR ';
  return { clause: parts.join(joiner), params };
}
