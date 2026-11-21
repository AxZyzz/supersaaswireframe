/**
 * Seeds a demo workspace with a RUNNING A/B experiment and results, so the
 * Review tab can be seen and tested without sending any email.
 *
 *   npm run seed:experiment -w apps/api
 *
 * Login: review-demo@supersaas.local / review-demo-123
 * Idempotent: running it again does nothing if the demo user already exists.
 * Local development only: it writes straight to the database.
 *
 * What it creates: 80 companies (10 with two contacts) split 40 / 40 between
 * two subject lines, a step-1 send for each (sent 20 days ago, so every
 * 14-day window is closed), some opens, bounces, replies, verified qualified
 * replies (B is better) and 2 AI-labelled replies still waiting for a person,
 * so the Review shows a real "confirm 2 more replies" check.
 */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { seedDefaultTags } from '../src/leads/default-tags';
import { seedDefaultTemplates } from '../src/templates/default-templates';
import { withOrgContext } from '../src/db/tenant-context';

const EMAIL = 'review-demo@supersaas.local';
const PASSWORD = 'review-demo-123';
const COMPANIES = 80;
const CITIES = ['Pune', 'Mumbai', 'Bengaluru', 'Delhi'];
const INDUSTRIES = [
  'saas',
  'agency_marketing',
  'ecommerce',
  'healthcare_clinic',
];
const TRIGGERS = ['hiring', 'expansion', 'funding', 'unknown'];

async function main() {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://supersaas_app:supersaas_app@localhost:5432/supersaas',
  });

  const existing = await pool.query(`SELECT 1 FROM users WHERE email = $1`, [
    EMAIL,
  ]);
  if ((existing.rowCount ?? 0) > 0) {
    // the Review demo exists; make sure the Insights demo (T06) does too
    const u = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1`,
      [EMAIL],
    );
    const m = await pool.query<{ org_id: string }>(
      `SELECT org_id FROM user_memberships($1)`,
      [u.rows[0].id],
    );
    const added = m.rows[0]
      ? await seedInsights(pool, m.rows[0].org_id)
      : false;
    console.log(
      added
        ? `Seed: ${EMAIL} already existed; added the Insights demo campaign.`
        : `Seed: ${EMAIL} already exists, nothing to do.`,
    );
    await pool.end();
    return;
  }

  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name, email_verified_at)
     VALUES ($1, $2, 'Review Demo', now()) RETURNING id`,
    [EMAIL, await bcrypt.hash(PASSWORD, 12)],
  );
  const userId = user.rows[0].id;
  const orgId = randomUUID();

  await withOrgContext(pool, orgId, async (c) => {
    await c.query(
      `INSERT INTO orgs (id, name, slug, onboarded_at) VALUES ($1, 'Review Demo', $2, now())`,
      [orgId, `review-demo-${orgId.slice(0, 8)}`],
    );
    await c.query(
      `INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [orgId, userId],
    );
    await seedDefaultTags(c, orgId);
    await seedDefaultTemplates(c, orgId);

    const tpl = await c.query<{ id: string }>(
      `SELECT id FROM templates ORDER BY created_at LIMIT 1`,
    );
    const offer = await c.query<{ id: string }>(
      `INSERT INTO offers (org_id, name, description)
       VALUES ($1, 'Missed-call follow-up for clinics', 'Automated callback within 30 seconds')
       RETURNING id`,
      [orgId],
    );
    const camp = await c.query<{ id: string }>(
      `INSERT INTO campaigns (org_id, name, status, offer_id, started_at)
       VALUES ($1, 'Review demo: clinic follow-up', 'active', $2, now() - interval '21 days')
       RETURNING id`,
      [orgId, offer.rows[0].id],
    );
    const campaignId = camp.rows[0].id;
    const step = await c.query<{ id: string }>(
      `INSERT INTO campaign_steps (org_id, campaign_id, step_order, template_id, delay_hours)
       VALUES ($1, $2, 1, $3, 0) RETURNING id`,
      [orgId, campaignId, tpl.rows[0]?.id ?? null],
    );
    const stepId = step.rows[0].id;

    const exp = await c.query<{ id: string }>(
      `INSERT INTO experiments
         (org_id, campaign_id, step_id, kind, status, unit, primary_metric,
          secondary_metric, baseline_rate, min_lift_pp, target_n_per_arm,
          response_window_days, decision_date, guardrails, allocation,
          policy_version, offer_ref, created_by, started_at)
       VALUES ($1,$2,$3,'subject','running','company','qualified_reply','booked_call',
               0.03, 2, 30, 14, now() - interval '2 days',
               '{"bounce":0.05,"unsubscribe":0.02,"complaint":0.003}'::jsonb,
               '{"weights":[0.5,0.5]}'::jsonb, 'v1', $4, $5, now() - interval '21 days')
       RETURNING id`,
      [orgId, campaignId, stepId, offer.rows[0].id, userId],
    );
    const experimentId = exp.rows[0].id;
    const variants: string[] = [];
    for (const [i, subject] of [
      'Quick question about missed calls',
      'Are you losing patients to voicemail?',
    ].entries()) {
      const v = await c.query<{ id: string }>(
        `INSERT INTO experiment_variants
           (org_id, experiment_id, label, subject, template_id, is_control, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'active',$7) RETURNING id`,
        [
          orgId,
          experimentId,
          i === 0 ? 'A' : 'B',
          subject,
          tpl.rows[0]?.id ?? null,
          i === 0,
          userId,
        ],
      );
      variants.push(v.rows[0].id);
    }

    const sentAt = new Date(Date.now() - 20 * 86_400_000);
    let provisionalLeft = 2;
    for (let n = 0; n < COMPANIES; n++) {
      const arm = n % 2; // 0 = A (control), 1 = B
      const domain = `clinic-${String(n + 1).padStart(3, '0')}.example`;
      const city = CITIES[n % CITIES.length];
      const industry = INDUSTRIES[n % INDUSTRIES.length];
      const trigger = TRIGGERS[(n * 7) % TRIGGERS.length];
      const contacts = n < 10 ? 2 : 1;

      await c.query(
        `INSERT INTO experiment_assignments (org_id, experiment_id, company_key, variant_id, hash)
         VALUES ($1,$2,$3,$4,$5)`,
        [orgId, experimentId, domain, variants[arm], `seed-${n}`],
      );

      for (let k = 0; k < contacts; k++) {
        const email = `${k === 0 ? 'owner' : 'manager'}@${domain}`;
        const lead = await c.query<{ id: string }>(
          `INSERT INTO leads (org_id, email, first_name, company, source, company_key, city, country)
           VALUES ($1,$2,$3,$4,'seed',$5,$6,'IN') RETURNING id`,
          [
            orgId,
            email,
            k === 0 ? 'Owner' : 'Manager',
            `Clinic ${n + 1}`,
            domain,
            city,
          ],
        );
        const snapshot = {
          company_key: domain,
          city,
          country: 'IN',
          industry,
          size_band: '11-50',
          primary_trigger: trigger,
          triggers: trigger === 'unknown' ? [] : [{ type: trigger }],
          offer_id: offer.rows[0].id,
          snapshot_version: 1,
        };
        const cl = await c.query<{ id: string }>(
          `INSERT INTO campaign_leads (org_id, campaign_id, lead_id, current_step, status, snapshot)
           VALUES ($1,$2,$3,1,'active',$4::jsonb) RETURNING id`,
          [orgId, campaignId, lead.rows[0].id, JSON.stringify(snapshot)],
        );
        const se = await c.query<{ id: string }>(
          `INSERT INTO sent_emails
             (org_id, campaign_id, campaign_lead_id, lead_id, step_id, to_email, subject,
              status, variant_index, experiment_id, variant_id, sent_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'sent',$8,$9,$10,$11) RETURNING id`,
          [
            orgId,
            campaignId,
            cl.rows[0].id,
            lead.rows[0].id,
            stepId,
            email,
            arm === 0
              ? 'Quick question about missed calls'
              : 'Are you losing patients to voicemail?',
            arm,
            experimentId,
            variants[arm],
            sentAt,
          ],
        );

        if (k > 0) continue; // outcomes belong to the company: record them once
        const out = async (
          type: string,
          verification: string,
          source: string,
          daysAfter: number,
        ) =>
          c.query(
            `INSERT INTO outcome_events
               (org_id, campaign_lead_id, lead_id, company_key, experiment_id, variant_id,
                sent_email_id, type, source, verification, occurred_at, idempotency_key)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              orgId,
              cl.rows[0].id,
              lead.rows[0].id,
              domain,
              experimentId,
              variants[arm],
              se.rows[0].id,
              type,
              source,
              verification,
              new Date(sentAt.getTime() + daysAfter * 86_400_000),
              `seed:${type}:${n}`,
            ],
          );

        // ~35% real opens (B a little higher), 2 bounces (one per version, 2.5% each)
        if ((n * 13) % 100 < (arm === 0 ? 33 : 38)) {
          await c.query(
            `INSERT INTO email_events (org_id, sent_email_id, campaign_id, lead_id, type)
             VALUES ($1,$2,$3,$4,'open')`,
            [orgId, se.rows[0].id, campaignId, lead.rows[0].id],
          );
        }
        if (n === 5 || n === 40)
          await out('bounce', 'verified', 'gmail_sync', 0);
        // B is genuinely better: A ~2/40 qualified, B ~7/40
        const qualified =
          arm === 0
            ? [4, 22].includes(n)
            : [1, 9, 15, 29, 47, 63, 71].includes(n);
        const replied = qualified || (n * 11) % 9 === 0;
        if (replied) await out('reply', 'verified', 'system', 2);
        if (qualified) {
          await out('qualified_reply', 'verified', 'manual', 2);
          if (n % 3 === 0) await out('booked_call', 'verified', 'manual', 5);
        } else if (replied && provisionalLeft > 0 && n % 2 === 1) {
          provisionalLeft--;
          await out('qualified_reply', 'provisional', 'inbox_ai', 3);
        }
      }
    }
  });

  await seedInsights(pool, orgId);
  console.log(
    `Seed: created ${EMAIL} / ${PASSWORD} with a running experiment ("Review demo: clinic follow-up").`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Insights demo (Learning Loop T06): a second campaign with ~400 companies
 * across 4 cities and 3 industries, sent on varied days and hours, with effects
 * built in so the Insights page has something true to find:
 *  - Pune replies far more, but mostly because most Pune companies are hiring
 *    (a confounded city effect: the page should say so);
 *  - Tue-Thu mornings reply more;
 *  - founders reply about twice as often as managers;
 *  - the fit score (stars) is random, so the "fit score isn't predicting
 *    replies" warning shows.
 * Deterministic (fixed seed). Returns false if it already exists.
 */
async function seedInsights(pool: Pool, orgId: string): Promise<boolean> {
  let seed = 20261121;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

  return withOrgContext(pool, orgId, async (c) => {
    const have = await c.query(
      `SELECT 1 FROM campaigns WHERE name = 'Insights demo: clinic outreach'`,
    );
    if ((have.rowCount ?? 0) > 0) return false;

    const offer = await c.query<{ id: string }>(
      `SELECT id FROM offers ORDER BY created_at LIMIT 1`,
    );
    const camp = await c.query<{ id: string }>(
      `INSERT INTO campaigns (org_id, name, status, offer_id, started_at)
       VALUES ($1, 'Insights demo: clinic outreach', 'completed', $2, now() - interval '30 days')
       RETURNING id`,
      [orgId, offer.rows[0]?.id ?? null],
    );
    const step = await c.query<{ id: string }>(
      `INSERT INTO campaign_steps (org_id, campaign_id, step_order, delay_hours)
       VALUES ($1, $2, 1, 0) RETURNING id`,
      [orgId, camp.rows[0].id],
    );

    const cities = ['Pune', 'Mumbai', 'Bengaluru', 'Delhi'];
    const industries = ['saas', 'agency_marketing', 'healthcare_clinic'];
    const titles = ['Founder', 'Manager', 'Director', 'Manager'];
    const roleOf: Record<string, string> = {
      Founder: 'founder_owner',
      Manager: 'manager',
      Director: 'vp_head_director',
    };
    const base = Date.UTC(2026, 10, 2); // Monday 2 Nov 2026, 00:00 UTC

    for (let n = 0; n < 400; n++) {
      const city = pick(cities);
      const industry = pick(industries);
      // most Pune companies are hiring; other cities mostly are not
      const trigger =
        rnd() < (city === 'Pune' ? 0.8 : 0.25)
          ? 'hiring'
          : pick(['expansion', 'funding', 'unknown']);
      const title = pick(titles);
      const stars = 1 + Math.floor(rnd() * 5); // random: no relation to replies
      const tz = rnd() < 0.85 ? 'Asia/Kolkata' : null; // some recipient zones unknown
      const dayOffset = Math.floor(rnd() * 21);
      const localHour = 8 + Math.floor(rnd() * 11); // 08:00-18:59 local
      const sentAt = new Date(
        base +
          dayOffset * 86_400_000 +
          (localHour * 60 - 330 + Math.floor(rnd() * 60)) * 60_000,
      );
      const weekday =
        (new Date(sentAt.getTime() + 330 * 60_000).getUTCDay() + 6) % 7; // 0 = Mon

      let p = 0.05;
      if (city === 'Pune' && trigger === 'hiring') p = 0.16;
      else if (trigger === 'hiring') p = 0.13; // hiring replies more everywhere
      if (weekday >= 1 && weekday <= 3 && localHour >= 9 && localHour < 12)
        p *= 1.5;
      if (title === 'Founder') p *= 2;
      const replied = rnd() < Math.min(p, 0.6);
      const bounced = rnd() < 0.03;
      const domain = `insights-${String(n + 1).padStart(3, '0')}.example`;

      const lead = await c.query<{ id: string }>(
        `INSERT INTO leads (org_id, email, first_name, company, title, source, company_key, city, country)
         VALUES ($1,$2,'Contact',$3,$4,'expelly',$5,$6,'IN') RETURNING id`,
        [orgId, `contact@${domain}`, `Company ${n + 1}`, title, domain, city],
      );
      const snapshot = {
        company_key: domain,
        city,
        country: 'IN',
        timezone: tz,
        industry,
        size_band: pick(['1-10', '11-50', '51-200']),
        primary_trigger: trigger,
        mail_provider: pick(['google', 'google', 'microsoft', 'other']),
        role_bucket: roleOf[title],
        stars,
        source: 'expelly',
        snapshot_version: 1,
      };
      const cl = await c.query<{ id: string }>(
        `INSERT INTO campaign_leads (org_id, campaign_id, lead_id, current_step, status, snapshot)
         VALUES ($1,$2,$3,1,'completed',$4::jsonb) RETURNING id`,
        [orgId, camp.rows[0].id, lead.rows[0].id, JSON.stringify(snapshot)],
      );
      const se = await c.query<{ id: string }>(
        `INSERT INTO sent_emails
           (org_id, campaign_id, campaign_lead_id, lead_id, step_id, to_email, subject,
            status, sent_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'sent',$8) RETURNING id`,
        [
          orgId,
          camp.rows[0].id,
          cl.rows[0].id,
          lead.rows[0].id,
          step.rows[0].id,
          `contact@${domain}`,
          n % 2
            ? 'Quick question about missed calls'
            : 'Missed calls at {company}',
          sentAt,
        ],
      );
      const out = (type: string, verification: string, hours: number) =>
        c.query(
          `INSERT INTO outcome_events
             (org_id, campaign_lead_id, lead_id, company_key, sent_email_id, type, source,
              verification, occurred_at, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,'manual',$7,$8,$9)`,
          [
            orgId,
            cl.rows[0].id,
            lead.rows[0].id,
            domain,
            se.rows[0].id,
            type,
            verification,
            new Date(sentAt.getTime() + hours * 3_600_000),
            `seed-ins:${type}:${n}`,
          ],
        );
      if (rnd() < 0.35) {
        await c.query(
          `INSERT INTO email_events (org_id, sent_email_id, campaign_id, lead_id, type)
           VALUES ($1,$2,$3,$4,'open')`,
          [orgId, se.rows[0].id, camp.rows[0].id, lead.rows[0].id],
        );
      }
      if (bounced) {
        await out('bounce', 'verified', 0);
        continue;
      }
      if (replied) {
        const hours = 2 + Math.floor(rnd() * 70);
        await out('reply', 'verified', hours);
        if (rnd() < 0.6) {
          const verified = rnd() < 0.8;
          await out(
            'qualified_reply',
            verified ? 'verified' : 'provisional',
            hours,
          );
          if (verified && rnd() < 0.25)
            await out('booked_call', 'verified', hours + 24);
        }
      }
    }
    return true;
  });
}
