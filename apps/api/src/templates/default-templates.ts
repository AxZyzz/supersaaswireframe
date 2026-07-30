import type { PoolClient } from 'pg';

// Starter templates seeded into every new workspace so the library and the
// campaign builder aren't empty on day one. Tokens use the {var|fallback}
// syntax (see render.ts). Idempotent via the unique (org, lower(name)) guard is
// NOT available here (templates allow duplicate names), so seeding runs only at
// org creation.
export const DEFAULT_TEMPLATES: {
  name: string;
  subject: string;
  bodyHtml: string;
}[] = [
  {
    name: 'Cold intro',
    subject: 'Quick question, {first_name|there}',
    bodyHtml:
      '<p>Hi {first_name|there},</p><p>I came across {business_name|your company} and thought there might be a fit. We help teams like yours run outbound without the manual grind.</p><p>Open to a quick 15-min call this week?</p><p>Best,<br>{sender_name}</p>',
  },
  {
    name: 'Follow-up #1',
    subject: 'Re: Quick question, {first_name|there}',
    bodyHtml:
      '<p>Hi {first_name|there},</p><p>Floating this back to the top of your inbox. Worth a short chat?</p><p>Best,<br>{sender_name}</p>',
  },
  {
    name: 'Follow-up #2 (break-up)',
    subject: 'Should I close the loop?',
    bodyHtml:
      '<p>Hi {first_name|there},</p><p>Haven’t heard back, so I’ll assume the timing isn’t right. If that changes, just reply here.</p><p>All the best,<br>{sender_name}</p>',
  },
  {
    name: 'Meeting request',
    subject: '15 minutes, {first_name|there}?',
    bodyHtml:
      '<p>Hi {first_name|there},</p><p>Would Tuesday or Thursday work for a quick call? Happy to work around {business_name|your team}’s schedule.</p><p>Best,<br>{sender_name}</p>',
  },
  {
    name: 'Value / case study',
    subject: 'How teams like {business_name|yours} save hours weekly',
    bodyHtml:
      '<p>Hi {first_name|there},</p><p>A team similar to {business_name|yours} cut their outreach time in half last quarter. Happy to share how.</p><p>Interested?</p><p>Best,<br>{sender_name}</p>',
  },
];

// Must run inside an org-context transaction (RLS WITH CHECK needs
// app.current_org_id set to orgId).
export async function seedDefaultTemplates(
  client: PoolClient,
  orgId: string,
): Promise<void> {
  for (const t of DEFAULT_TEMPLATES) {
    await client.query(
      `INSERT INTO templates (org_id, name, subject, body_html)
       VALUES ($1, $2, $3, $4)`,
      [orgId, t.name, t.subject, t.bodyHtml],
    );
  }
}
