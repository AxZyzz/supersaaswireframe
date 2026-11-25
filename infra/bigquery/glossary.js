#!/usr/bin/env node
/**
 * Learning Loop T07: the "Expelly metrics" business glossary in Knowledge Catalog
 * (Dataplex Universal Catalog) and its links to the BigQuery view columns.
 *
 *   PROJECT=supersaas-513613 node infra/bigquery/glossary.js
 *
 * Safe to run again: it creates only what is missing. A link to a view that does not
 * exist yet is skipped (run it again after `apply.sh` creates the view). Needs
 * `gcloud auth login` (it asks gcloud for a token) and Node 18+.
 *
 * Cost: Knowledge Catalog metadata is billed per GB stored per month; ten terms and a few
 * dozen links are far below one cent.
 */
const { execSync } = require('child_process');

const PROJECT = process.env.PROJECT || 'supersaas-513613';
const LOCATION = process.env.LOCATION || 'asia-south1';
const LEARN = process.env.LEARN || 'expelly_learning';
const GLOSSARY = 'expelly-metrics';
const API = 'https://dataplex.googleapis.com/v1';

// The definitions are copied from the Campaign Review Build Brief (2026-11-20).
const TERMS = {
  'reached-company': [
    'Reached company',
    'A company that was contacted (its first first-touch email was sent) and did not bounce. Reached companies are the base of every rate in Review and Insights. A company counts once, however many people at it were contacted.',
  ],
  'eligible-company': [
    'Eligible company',
    'A Discover prospect, checked on its own website, that has a real email address which accepts mail, so it can be contacted. It is a stage of the discovery funnel: discovered, eligible, reached, qualified. The reply window starts at a company first eligible send. In BigQuery no email addresses are stored, so the views show the nearest stand-in, became_lead: the prospect was imported as a lead with a usable contact.',
  ],
  'qualified-reply': [
    'Qualified reply (verified)',
    'A reply from a company that a person confirmed is a real, interested lead. An AI label alone is only provisional; it becomes verified when an agent, manager or admin confirms it. This is the primary outcome of every test. Counted once per company, inside its response window.',
  ],
  'booked-call': [
    'Booked call',
    'A verified booked call, recorded by the converted mark in the inbox (un-marking records a correction). It is the secondary outcome. Counted once per company.',
  ],
  'response-window': [
    'Response window',
    'How long after a company first eligible send its outcomes still count: 14 days by default, editable per test. A test cannot reach a decision until every company has had its full window.',
  ],
  'baseline-rate': [
    'Baseline rate',
    'The expected qualified-reply rate used to plan a test: the workspace own rate if it has at least 200 reached companies, otherwise 3 percent. Editable per test.',
  ],
  'minimum-worthwhile-lift': [
    'Minimum worthwhile lift',
    'The smallest improvement worth acting on: +2 percentage points by default, editable per test. A version is recommended only if the lower end of its 95 percent confidence interval for the lift is at least this, and its guardrails pass.',
  ],
  guardrail: [
    'Guardrail',
    'A deliverability limit a version must stay inside: bounce rate under 5 percent, unsubscribe rate under 2 percent, complaint rate under 0.3 percent. A breach is a deliverability warning routed to the send controls, not a loss in the experiment.',
  ],
  'search-preference': [
    'Search preference',
    'A bounded, expiring, reversible request to find more of one kind of company (a city, industry or trigger) in the next Discover runs of one offer. It reserves at most 20 percent of a batch, expires after 14 days, only one is active per workspace and offer, and ending it restores the previous search profile. Needs a manager approval.',
  ],
  'exploratory-insight': [
    'Exploratory insight',
    'An observation among contacted companies about what looks different by factor (location, industry, trigger, send time and so on). Scanning many factors always finds some that look good by chance, so an insight is an idea to test, never a verdict and never applied automatically.',
  ],
};

// term -> [view, column | null (whole view)]
const LINKS = {
  'reached-company': [
    ['company_reach', 'delivered'],
    ['factor_funnel', 'reached'],
    ['send_time_grid', 'reached'],
    ['discovery_funnel', 'reached'],
    ['search_policy_compare', 'reached'],
  ],
  'eligible-company': [
    ['discovery_funnel', 'became_lead'],
    ['search_policy_compare', 'became_lead'],
  ],
  'qualified-reply': [
    ['company_reach', 'qualified_verified'],
    ['factor_funnel', 'qualified'],
    ['send_time_grid', 'qualified'],
    ['discovery_funnel', 'qualified'],
    ['search_policy_compare', 'qualified'],
  ],
  'booked-call': [
    ['company_reach', 'booked'],
    ['factor_funnel', 'booked'],
  ],
  'response-window': [['company_reach', 'first_sent_at']],
  'baseline-rate': [],
  'minimum-worthwhile-lift': [['review_history', 'lift']],
  guardrail: [
    ['company_reach', 'bounced'],
    ['company_reach', 'unsubscribed'],
    ['factor_funnel', 'bounced'],
    ['factor_funnel', 'unsubscribed'],
  ],
  'search-preference': [
    ['discovery_funnel', 'via_preference'],
    ['search_policy_compare', 'preference_id'],
  ],
  'exploratory-insight': [
    ['factor_funnel', null],
    ['send_time_grid', null],
  ],
};

const token = () =>
  execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
let TOKEN = token();

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function main() {
  // Dataplex addresses the project by NUMBER inside entry names
  const proj = await fetch(
    `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } },
  ).then((r) => r.json());
  const NUMBER = proj.projectNumber;
  if (!NUMBER) throw new Error(`cannot read project number: ${JSON.stringify(proj).slice(0, 200)}`);

  const parent = `projects/${PROJECT}/locations/${LOCATION}`;
  const gName = `${parent}/glossaries/${GLOSSARY}`;

  // 1. glossary
  let r = await call('GET', `${API}/${gName}`);
  if (r.status === 404) {
    r = await call('POST', `${API}/${parent}/glossaries?glossary_id=${GLOSSARY}`, {
      displayName: 'Expelly metrics',
      description:
        "What the numbers in Expelly's Review and Insights mean. Definitions are copied from the Campaign Review Build Brief (2026-11-20); the BigQuery views in expelly_learning link to these terms.",
    });
    console.log('glossary created', r.status);
  } else console.log('glossary exists');

  // 2. terms
  for (const [id, [displayName, description]] of Object.entries(TERMS)) {
    const t = await call('GET', `${API}/${gName}/terms/${id}`);
    if (t.status === 404) {
      const c = await call('POST', `${API}/${gName}/terms?term_id=${id}`, {
        displayName,
        description,
        parent: gName,
      });
      console.log(`term ${id}: created (${c.status})`);
    } else console.log(`term ${id}: exists`);
  }

  // 3. links (a term can be attached to a view column, or to a whole view)
  const group = `projects/${NUMBER}/locations/${LOCATION}/entryGroups/@bigquery`;
  const entryOf = (view) =>
    `${group}/entries/bigquery.googleapis.com/projects/${PROJECT}/datasets/${LEARN}/tables/${view}`;
  const termEntry = (id) =>
    `projects/${NUMBER}/locations/${LOCATION}/entryGroups/@dataplex/entries/projects/${NUMBER}/locations/${LOCATION}/glossaries/${GLOSSARY}/terms/${id}`;
  const seen = new Map();
  let made = 0;
  let had = 0;
  const waiting = [];
  for (const [term, targets] of Object.entries(LINKS)) {
    for (const [view, column] of targets) {
      if (!seen.has(view)) {
        seen.set(view, (await call('GET', `${API}/${entryOf(view)}`)).status === 200);
      }
      if (!seen.get(view)) {
        waiting.push(`${term} -> ${view}${column ? '.' + column : ''}`);
        continue;
      }
      const id = `${term}--${view}--${column || 'view'}`.replace(/_/g, '-');
      const ref = { name: entryOf(view), type: 'SOURCE' };
      if (column) ref.path = `Schema.${column}`;
      const c = await call(
        'POST',
        `${API}/${group}/entryLinks?entry_link_id=${id}`,
        {
          entryLinkType:
            'projects/dataplex-types/locations/global/entryLinkTypes/definition',
          entryReferences: [ref, { name: termEntry(term), type: 'TARGET' }],
        },
      );
      if (c.status === 200 || c.status === 201) made++;
      else if (c.status === 409) had++;
      else {
        console.log(`LINK FAILED ${id}: ${c.status} ${JSON.stringify(c.json).slice(0, 300)}`);
        process.exitCode = 1;
      }
    }
  }
  console.log(`links: ${made} created, ${had} already there`);
  if (waiting.length) {
    console.log(`waiting for a view that does not exist yet (run again after apply.sh):\n  ${waiting.join('\n  ')}`);
  }
}

main().catch((e) => {
  console.error('glossary.js failed:', e.message);
  process.exit(1);
});
