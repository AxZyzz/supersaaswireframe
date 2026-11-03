import { effectiveDailyLimit, warmupDay } from './warmup';

const DAY = 86_400_000;
const start = new Date('2026-11-01T09:00:00Z');
const at = (days: number) => new Date(start.getTime() + days * DAY);
const sender = (daily_limit: number, warmup_enabled = true) => ({
  daily_limit,
  warmup_enabled,
  warmup_started_at: start,
});

describe('warm-up ramp', () => {
  it('follows the 20 → 50 → 100 schedule over the first month', () => {
    expect(effectiveDailyLimit(sender(500), at(0))).toBe(20); // day 1
    expect(effectiveDailyLimit(sender(500), at(6.9))).toBe(20); // day 7
    expect(effectiveDailyLimit(sender(500), at(7))).toBe(50); // day 8
    expect(effectiveDailyLimit(sender(500), at(14))).toBe(100); // day 15
    expect(effectiveDailyLimit(sender(500), at(29.9))).toBe(100); // day 30
    expect(effectiveDailyLimit(sender(500), at(30))).toBe(500); // ramp done
  });

  it('never exceeds the configured daily limit', () => {
    expect(effectiveDailyLimit(sender(10), at(0))).toBe(10);
    expect(effectiveDailyLimit(sender(40), at(20))).toBe(40);
  });

  it('can be switched off per sender', () => {
    expect(effectiveDailyLimit(sender(300, false), at(0))).toBe(300);
    expect(warmupDay(false, start, at(0))).toBeNull();
  });

  it('reports the warm-up day, then null', () => {
    expect(warmupDay(true, start, at(0))).toBe(1);
    expect(warmupDay(true, start, at(9.5))).toBe(10);
    expect(warmupDay(true, start, at(31))).toBeNull();
  });
});
