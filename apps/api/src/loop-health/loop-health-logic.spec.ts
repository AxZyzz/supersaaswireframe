import {
  buildProblems,
  isoWeek,
  type LoopHealth,
  loopHealthLogLine,
  overallStatus,
} from './loop-health-logic';

const healthy = (over: Partial<LoopHealth> = {}): LoopHealth => ({
  generatedAt: '2026-11-21T00:00:00.000Z',
  experiments: [
    {
      experimentId: 'e1',
      campaignId: 'c1',
      campaignName: 'Clinic follow-up',
      assigned: [
        { variantId: 'a', label: 'A', companies: 40 },
        { variantId: 'b', label: 'B', companies: 41 },
      ],
      srmP: 0.9,
      srmNote: null,
      coverage: 1,
      replyingCompanies: 12,
      failedGates: [],
    },
  ],
  unattributed7d: 0,
  gateFailures: {},
  stuckActions: 0,
  allocation: { runs: 3, avgFill: 0.8 },
  preferencesExpiringSoon: [],
  ...over,
});

describe('loop health rules (T13)', () => {
  it('a healthy loop has no problems and status ok', () => {
    const p = buildProblems(healthy());
    expect(p).toEqual([]);
    expect(overallStatus(p)).toBe('ok');
  });

  it('coverage under 90% is red, with a link to the replies to confirm', () => {
    const h = healthy();
    h.experiments[0].coverage = 0.85;
    const [p] = buildProblems(h);
    expect(p).toMatchObject({ severity: 'bad', link: '/review/outcomes' });
    expect(p.message).toMatch(/85%/);
    expect(overallStatus([p])).toBe('bad');
    // exactly at the gate is fine; no replies yet is nothing to measure
    h.experiments[0].coverage = 0.9;
    expect(buildProblems(h)).toEqual([]);
    h.experiments[0].coverage = null;
    expect(buildProblems(h)).toEqual([]);
  });

  it('a skewed split (SRM p under 0.001) is red; a paused version is not checked', () => {
    const h = healthy();
    h.experiments[0].assigned = [
      { variantId: 'a', label: 'A', companies: 90 },
      { variantId: 'b', label: 'B', companies: 10 },
    ];
    h.experiments[0].srmP = 0.0000001;
    const [p] = buildProblems(h);
    expect(p.severity).toBe('bad');
    expect(p.message).toMatch(/A 90 \/ B 10/);
    h.experiments[0].srmP = null; // paused: the planned split no longer applies
    expect(buildProblems(h)).toEqual([]);
  });

  it('stuck actions are red, and unattributed replies are amber', () => {
    const stuck = buildProblems(healthy({ stuckActions: 2 }));
    expect(stuck[0]).toMatchObject({ id: 'stuck_actions', severity: 'bad' });
    expect(stuck[0].message).toMatch(/2 review actions are stuck/);
    const un = buildProblems(healthy({ unattributed7d: 3 }));
    expect(un[0]).toMatchObject({ id: 'unattributed', severity: 'warn' });
    expect(overallStatus(un)).toBe('warn');
  });

  it('a preference that rarely finds its reserved share is amber; one ending soon is info', () => {
    const p = buildProblems(
      healthy({
        allocation: { runs: 4, avgFill: 0.25 },
        preferencesExpiringSoon: [
          {
            id: 'p1',
            label: 'City: Pune',
            expiresAt: '2026-11-22T00:00:00.000Z',
          },
        ],
      }),
    );
    expect(p.map((x) => x.severity)).toEqual(['warn', 'info']);
    expect(overallStatus(p)).toBe('warn');
  });

  it('worst problems come first', () => {
    const h = healthy({ stuckActions: 1, unattributed7d: 4 });
    h.experiments[0].coverage = 0.5;
    expect(buildProblems(h).map((x) => x.severity)).toEqual([
      'bad',
      'bad',
      'warn',
    ]);
  });

  it('writes one JSON line with the fields the alerts count', () => {
    const h = healthy({
      stuckActions: 1,
      gateFailures: { outcome_coverage: 1 },
    });
    h.experiments[0].coverage = 0.7;
    const line = JSON.parse(
      loopHealthLogLine('org-1', h, buildProblems(h)),
    ) as Record<string, unknown>;
    expect(line).toMatchObject({
      event: 'loop_health',
      org_id: 'org-1',
      severity: 'WARNING',
      status: 'bad',
      experiments_running: 1,
      coverage_min: 0.7,
      stuck_actions: 1,
      unattributed_7d: 0,
      gate_failures_total: 1,
      allocation_fill: 0.8,
    });
    const ok = JSON.parse(loopHealthLogLine('org-1', healthy(), [])) as Record<
      string,
      unknown
    >;
    expect(ok.severity).toBe('INFO');
    expect(ok.coverage_min).toBe(1);
  });

  it('names the ISO week the way the Monday summary does', () => {
    expect(isoWeek(new Date('2026-11-21T10:00:00Z'))).toBe('2026-W47');
    expect(isoWeek(new Date('2026-11-23T00:30:00Z'))).toBe('2026-W48'); // Monday
    expect(isoWeek(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53'); // belongs to 2026
  });
});
