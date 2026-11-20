/**
 * Seeds a FRESH workspace whose running A/B test already has a clear winner,
 * so the Review actions (pause, resume, challenger) can be clicked through
 * without sending any email. Every run makes a new workspace.
 *
 *   npm run seed:review-actions -w apps/api
 *
 * Prints one JSON line: {"email": "...", "password": "...", "campaign": "..."}.
 * Local development only: it writes straight to the database.
 *
 * What it creates: 80 companies, 40 per version, sent 20 days ago (every
 * 14-day window is closed). Version A (control) has 2 confirmed qualified
 * replies, version B has 9, and none are waiting for a person to confirm, so
 * the policy's answer is "keep B" and the actions on offer are "pause A" and
 * "draft a new challenger".
 */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { seedDefaultTags } from '../src/leads/default-tags';
import { seedDefaultTemplates } from '../src/templates/default-templates';
import { withOrgContext } from '../src/db/tenant-context';

const PASSWORD = 'review-actions-123';
const COMPANIES = 80;
const QUALIFIED_A = [4, 22];
const QUALIFIED_B = [1, 9, 15, 29, 47, 63, 71, 75, 79];

async function main() {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://supersaas_app:supersaas_app@localhost:5432/supersaas',
  });
  const tag = randomUUID().slice(0, 8);
  const email = `review-actions-${tag}@supersaas.local`;
  const campaignName = `Actions demo ${tag}: clinic follow-up`;

  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name, email_verified_at)
     VALUES ($1, $2, 'Actions Demo', now()) RETURNING id`,
    [email, await bcrypt.hash(PASSWORD, 12)],
  );
  const userId = user.rows[0].id;
  const orgId = randomUUID();

  await withOrgContext(pool, orgId, async (c) => {
    await c.query(
      `INSERT INTO orgs (id, name, slug, onboarded_at, plan)
       VALUES ($1, 'Actions Demo', $2, now(), 'internal')`,
      [orgId, `actions-demo-${tag}`],
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
       VALUES ($1, $2, 'active', $3, now() - interval '21 days') RETURNING id`,
      [orgId, campaignName, offer.rows[0].id],
    );
    const campaignId = camp.rows[0].id;
    const step = await c.query<{ id: string }>(
      `INSERT INTO campaign_steps (org_id, campaign_id, step_order, template_id, delay_hours)
       VALUES ($1, $2, 0, $3, 0) RETURNING id`,
      [orgId, campaignId, tpl.rows[0]?.id ?? null],
    );
    const stepId = step.rows[0].id;
    const exp = await c.query<{ id: string }>(
      `INSERT INTO experiments
         (org_id, campaign_id, step_id, status, baseline_rate, min_lift_pp,
          target_n_per_arm, response_window_days, decision_date, offer_ref,
          created_by, started_at)
       VALUES ($1,$2,$3,'running',0.03,2,30,14, now() - interval '2 days', $4, $5,
               now() - interval '21 days')
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
    for (let n = 0; n < COMPANIES; n++) {
      const arm = n % 2;
      const domain = `actions-${tag}-${String(n + 1).padStart(3, '0')}.example`;
      await c.query(
        `INSERT INTO experiment_assignments (org_id, experiment_id, company_key, variant_id, hash)
         VALUES ($1,$2,$3,$4,$5)`,
        [orgId, experimentId, domain, variants[arm], `seed-${n}`],
      );
      const lead = await c.query<{ id: string }>(
        `INSERT INTO leads (org_id, email, first_name, company, source, company_key)
         VALUES ($1,$2,'Owner',$3,'seed',$4) RETURNING id`,
        [orgId, `owner@${domain}`, `Clinic ${n + 1}`, domain],
      );
      const cl = await c.query<{ id: string }>(
        `INSERT INTO campaign_leads (org_id, campaign_id, lead_id, current_step, status, snapshot)
         VALUES ($1,$2,$3,1,'active',$4::jsonb) RETURNING id`,
        [
          orgId,
          campaignId,
          lead.rows[0].id,
          JSON.stringify({ company_key: domain, primary_trigger: 'unknown' }),
        ],
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
          `owner@${domain}`,
          arm === 0
            ? 'Quick question about missed calls'
            : 'Are you losing patients to voicemail?',
          arm,
          experimentId,
          variants[arm],
          sentAt,
        ],
      );
      const qualified = (arm === 0 ? QUALIFIED_A : QUALIFIED_B).includes(n);
      if (!qualified) continue;
      for (const type of ['reply', 'qualified_reply']) {
        await c.query(
          `INSERT INTO outcome_events
             (org_id, campaign_lead_id, lead_id, company_key, experiment_id, variant_id,
              sent_email_id, type, source, verification, occurred_at, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual','verified',$9,$10)`,
          [
            orgId,
            cl.rows[0].id,
            lead.rows[0].id,
            domain,
            experimentId,
            variants[arm],
            se.rows[0].id,
            type,
            new Date(sentAt.getTime() + 2 * 86_400_000),
            `seed:${tag}:${type}:${n}`,
          ],
        );
      }
    }
  });

  await pool.end();
  console.log(
    JSON.stringify({ email, password: PASSWORD, campaign: campaignName }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
