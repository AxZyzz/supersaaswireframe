import {
  type AssignableVariant,
  assignmentHash,
  pickExperimentVariant,
} from './experiment-assignment';
import { buildEnrollmentSnapshot, roleBucket } from './snapshot';

describe('Experiment company-level hash assignment (T02)', () => {
  const expId = '11111111-2222-3333-4444-555555555555';
  const variants: AssignableVariant[] = [
    {
      id: 'aaaa0000-0000-0000-0000-000000000001',
      label: 'A',
      subject: 'Control subject',
      status: 'active',
      is_control: true,
    },
    {
      id: 'bbbb0000-0000-0000-0000-000000000002',
      label: 'B',
      subject: 'Challenger subject',
      status: 'active',
      is_control: false,
    },
  ];

  it('is deterministic for a given (experiment_id, company_key)', () => {
    const first = pickExperimentVariant(expId, 'acme.com', variants);
    for (let i = 0; i < 50; i++) {
      const again = pickExperimentVariant(expId, 'acme.com', variants);
      expect(again).toEqual(first);
    }
    const h = assignmentHash(expId, 'acme.com');
    expect(h.hex).toHaveLength(16);
    expect(h.uniform).toBeGreaterThanOrEqual(0);
    expect(h.uniform).toBeLessThan(1);
  });

  it('splits ~50/50 across 10,000 synthetic companies (within +-2%)', () => {
    let countA = 0;
    let countB = 0;
    const total = 10_000;
    for (let i = 0; i < total; i++) {
      const pick = pickExperimentVariant(
        expId,
        `company-${i}.example.com`,
        variants,
      );
      if (pick.variant.label === 'A') countA++;
      else countB++;
    }
    expect(countA + countB).toBe(total);
    const shareA = countA / total;
    expect(shareA).toBeGreaterThanOrEqual(0.48);
    expect(shareA).toBeLessThanOrEqual(0.52);
  });

  it('excludes paused variants for new assignments while preserving active picks and original variantIndex', () => {
    const withPaused: AssignableVariant[] = [
      variants[0],
      {
        id: 'cccc0000-0000-0000-0000-000000000003',
        label: 'C',
        subject: 'Paused variant',
        status: 'paused',
      },
      variants[1],
    ];
    for (let i = 0; i < 200; i++) {
      const domain = `firm-${i}.io`;
      const basePick = pickExperimentVariant(expId, domain, variants);
      const withPausedPick = pickExperimentVariant(expId, domain, withPaused);
      // Never picks the paused variant C
      expect(withPausedPick.variant.label).not.toBe('C');
      // Same active variant chosen because cumulative 50/50 over active [A, B] is identical
      expect(withPausedPick.variant.id).toBe(basePick.variant.id);
      // variantIndex reflects position in full ordered list (0 for A, 2 for B)
      expect(withPausedPick.variantIndex).toBe(
        withPausedPick.variant.label === 'A' ? 0 : 2,
      );
    }
  });
});

describe('Enrollment snapshot & roleBucket (T02)', () => {
  it('maps job titles to the 6 role buckets', () => {
    expect(roleBucket('Co-Founder & CEO')).toBe('founder_owner');
    expect(roleBucket('Founder')).toBe('founder_owner');
    expect(roleBucket('Business Owner')).toBe('founder_owner');
    expect(roleBucket('Chief Technology Officer')).toBe('c_level');
    expect(roleBucket('CMO')).toBe('c_level');
    expect(roleBucket('VP of Sales')).toBe('vp_head_director');
    expect(roleBucket('Head of Growth')).toBe('vp_head_director');
    expect(roleBucket(' Engineering Director ')).toBe('vp_head_director');
    expect(roleBucket('Product Manager')).toBe('manager');
    expect(roleBucket('QA Lead')).toBe('manager');
    expect(roleBucket('Account Executive')).toBe('individual');
    expect(roleBucket('Software Engineer')).toBe('individual');
    expect(roleBucket('')).toBe('unknown');
    expect(roleBucket(null)).toBe('unknown');
  });

  it('builds a frozen snapshot with all 19 keys and explicit unknown/null defaults', () => {
    const snap = buildEnrollmentSnapshot({
      email: 'alex@acme.com',
      title: 'VP of Marketing',
      source: 'csv',
    });
    expect(snap).toEqual({
      company_key: 'acme.com',
      city: 'unknown',
      region: 'unknown',
      country: 'unknown',
      timezone: 'unknown',
      industry: 'unknown',
      size_band: 'unknown',
      triggers: [],
      primary_trigger: 'unknown',
      mail_provider: 'unknown',
      role_bucket: 'vp_head_director',
      stars: null,
      fit_score: null,
      prospect_id: null,
      discovery_run_id: null,
      preference_id: null,
      preference_revision: null,
      source: 'csv',
      offer_id: null,
      snapshot_version: 1,
    });
  });

  it('includes Discover prospect attributes and triggers when linked', () => {
    const snap = buildEnrollmentSnapshot({
      email: 'dr@clinic.in',
      title: 'Founder',
      source: 'expelly',
      company_key: 'clinic.in',
      city: 'Pune',
      region: 'Maharashtra',
      country: 'IN',
      timezone: 'Asia/Kolkata',
      mail_provider: 'google',
      prospect_id: 'p-1',
      discovery_run_id: 'r-1',
      prospect_industry: 'healthcare_clinic',
      prospect_size_band: '11-50',
      prospect_triggers: [
        {
          type: 'expansion',
          quote: 'Opening our second clinic in Baner this month',
          url: 'https://clinic.in/about',
          observed_at: null,
        },
      ],
      prospect_stars: 5,
      prospect_fit_score: 88,
      offer_id: 'o-1',
    });
    expect(snap.company_key).toBe('clinic.in');
    expect(snap.city).toBe('Pune');
    expect(snap.industry).toBe('healthcare_clinic');
    expect(snap.size_band).toBe('11-50');
    expect(snap.primary_trigger).toBe('expansion');
    expect(snap.triggers).toHaveLength(1);
    expect(snap.role_bucket).toBe('founder_owner');
    expect(snap.stars).toBe(5);
    expect(snap.fit_score).toBe(88);
    expect(snap.prospect_id).toBe('p-1');
    expect(snap.discovery_run_id).toBe('r-1');
    expect(snap.offer_id).toBe('o-1');
    expect(snap.snapshot_version).toBe(1);
  });
});
