import {
  catchUpConfigFrom,
  catchUpDecision,
  DEFAULT_CATCHUP_SPREAD_HOURS,
  DEFAULT_STALE_AFTER_HOURS,
  type CatchUpConfig,
} from './catch-up';

const H = 3600;
const cfg: CatchUpConfig = { staleAfterHours: 24, spreadHours: 24 };

describe('catchUpConfigFrom', () => {
  it('uses the defaults (24 h overdue, spread over 24 h) when nothing is set', () => {
    expect(catchUpConfigFrom(undefined, undefined)).toEqual({
      staleAfterHours: DEFAULT_STALE_AFTER_HOURS,
      spreadHours: DEFAULT_CATCHUP_SPREAD_HOURS,
    });
    expect(DEFAULT_STALE_AFTER_HOURS).toBe(24);
    expect(DEFAULT_CATCHUP_SPREAD_HOURS).toBe(24);
  });

  it('reads both settings, fractions included', () => {
    expect(catchUpConfigFrom('12', '6')).toEqual({
      staleAfterHours: 12,
      spreadHours: 6,
    });
    expect(catchUpConfigFrom('0.5', '1.5')).toEqual({
      staleAfterHours: 0.5,
      spreadHours: 1.5,
    });
  });

  it('0 turns the guard off for the stale setting', () => {
    expect(catchUpConfigFrom('0', undefined).staleAfterHours).toBe(0);
  });

  it.each([['abc'], [''], ['  '], ['NaN'], ['-5'], ['Infinity']])(
    'an unreadable or negative stale value (%j) falls back to the default',
    (bad) => {
      expect(catchUpConfigFrom(bad, undefined).staleAfterHours).toBe(
        DEFAULT_STALE_AFTER_HOURS,
      );
    },
  );

  it.each([['abc'], [''], ['0'], ['-1'], ['Infinity']])(
    'an unreadable, zero or negative spread value (%j) falls back to the default',
    (bad) => {
      expect(catchUpConfigFrom(undefined, bad).spreadHours).toBe(
        DEFAULT_CATCHUP_SPREAD_HOURS,
      );
    },
  );
});

describe('catchUpDecision', () => {
  it('a send that is only a little late is not touched', () => {
    expect(
      catchUpDecision({ overdueSeconds: 30, config: cfg, seed: 'a' }),
    ).toEqual({ stale: false });
    expect(
      catchUpDecision({ overdueSeconds: 2 * H, config: cfg, seed: 'a' }),
    ).toEqual({ stale: false });
  });

  it('exactly at the limit is not stale; one second past it is', () => {
    expect(
      catchUpDecision({ overdueSeconds: 24 * H, config: cfg, seed: 'a' }).stale,
    ).toBe(false);
    expect(
      catchUpDecision({ overdueSeconds: 24 * H + 1, config: cfg, seed: 'a' })
        .stale,
    ).toBe(true);
  });

  it('a send that is days overdue is moved to somewhere inside the next spread window', () => {
    const d = catchUpDecision({
      overdueSeconds: 3 * 24 * H,
      config: cfg,
      seed: 'lead-1:0',
    });
    expect(d.stale).toBe(true);
    if (!d.stale) return;
    expect(d.overdueHours).toBe(72);
    expect(d.delaySeconds).toBeGreaterThanOrEqual(0);
    expect(d.delaySeconds).toBeLessThan(24 * H);
  });

  it('the same lead and step always get the same point (a retry does not shuffle it)', () => {
    const a = catchUpDecision({
      overdueSeconds: 99 * H,
      config: cfg,
      seed: 's',
    });
    const b = catchUpDecision({
      overdueSeconds: 120 * H,
      config: cfg,
      seed: 's',
    });
    expect(a).toMatchObject({ stale: true });
    expect(b).toMatchObject({ stale: true });
    expect((a as { delaySeconds: number }).delaySeconds).toBe(
      (b as { delaySeconds: number }).delaySeconds,
    );
  });

  it('1,000 overdue sends are spread across the whole window, not bunched at the start', () => {
    const delays = Array.from({ length: 1000 }, (_, i) => {
      const d = catchUpDecision({
        overdueSeconds: 5 * 24 * H,
        config: cfg,
        seed: `lead-${i}:0`,
      });
      if (!d.stale) throw new Error('expected stale');
      return d.delaySeconds;
    });
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...delays)).toBeLessThan(24 * H);
    // roughly even over the 24 hours: every 4-hour slice gets a fair share (uniform = 167)
    for (let slice = 0; slice < 6; slice++) {
      const n = delays.filter(
        (s) => s >= slice * 4 * H && s < (slice + 1) * 4 * H,
      ).length;
      expect(n).toBeGreaterThan(110);
      expect(n).toBeLessThan(230);
    }
  });

  it('a shorter spread keeps the move inside that spread', () => {
    for (let i = 0; i < 100; i++) {
      const d = catchUpDecision({
        overdueSeconds: 10 * 24 * H,
        config: { staleAfterHours: 24, spreadHours: 2 },
        seed: `s${i}`,
      });
      if (!d.stale) throw new Error('expected stale');
      expect(d.delaySeconds).toBeLessThan(2 * H);
    }
  });

  it('a lower limit makes more things stale', () => {
    const c: CatchUpConfig = { staleAfterHours: 2, spreadHours: 6 };
    expect(
      catchUpDecision({ overdueSeconds: 3 * H, config: c, seed: 'a' }).stale,
    ).toBe(true);
    expect(
      catchUpDecision({ overdueSeconds: 1 * H, config: c, seed: 'a' }).stale,
    ).toBe(false);
  });

  it('staleAfterHours 0 turns the guard off, however overdue', () => {
    expect(
      catchUpDecision({
        overdueSeconds: 30 * 24 * H,
        config: { staleAfterHours: 0, spreadHours: 24 },
        seed: 'a',
      }),
    ).toEqual({ stale: false });
  });

  it('never moves a send on a nonsense value (NaN, negative): fail open, send as before', () => {
    expect(
      catchUpDecision({ overdueSeconds: Number.NaN, config: cfg, seed: 'a' }),
    ).toEqual({ stale: false });
    expect(
      catchUpDecision({ overdueSeconds: -50, config: cfg, seed: 'a' }),
    ).toEqual({ stale: false });
  });
});
