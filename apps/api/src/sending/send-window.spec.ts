import {
  describeSendWindow,
  isInsideWindow,
  parseSendWindow,
  resolveWindowZone,
  sameSendWindow,
  scheduleInWindow,
  sendWindowError,
  slotAtOrAfter,
  spreadFraction,
  zonedWallToUtc,
  type SendWindow,
} from './send-window';

const iso = (d: Date | number) => new Date(d).toISOString();

const TUE_THU_9_11: SendWindow = {
  days: [2, 3, 4],
  startHour: 9,
  endHour: 11,
  tzBasis: 'recipient',
};
const MON_FRI_9_17: SendWindow = {
  days: [1, 2, 3, 4, 5],
  startHour: 9,
  endHour: 17,
  tzBasis: 'recipient',
};

describe('sendWindowError / parseSendWindow', () => {
  it('accepts a normal window and sorts the days', () => {
    expect(sendWindowError(TUE_THU_9_11)).toBeNull();
    expect(parseSendWindow({ ...TUE_THU_9_11, days: [4, 2, 3] })?.days).toEqual(
      [2, 3, 4],
    );
  });

  it.each([
    ['no days', { ...TUE_THU_9_11, days: [] }],
    ['day 0', { ...TUE_THU_9_11, days: [0, 2] }],
    ['day 8', { ...TUE_THU_9_11, days: [8] }],
    ['a repeated day', { ...TUE_THU_9_11, days: [2, 2] }],
    ['a fractional hour', { ...TUE_THU_9_11, startHour: 9.5 }],
    ['start hour 24', { ...TUE_THU_9_11, startHour: 24, endHour: 24 }],
    ['end hour 0', { ...TUE_THU_9_11, endHour: 0 }],
    [
      'end before start (overnight)',
      { ...TUE_THU_9_11, startHour: 22, endHour: 6 },
    ],
    ['end equal to start', { ...TUE_THU_9_11, startHour: 9, endHour: 9 }],
    ['a bad basis', { ...TUE_THU_9_11, tzBasis: 'sender' }],
    ['not an object', 'Tue-Thu'],
    ['null', null],
  ])('rejects %s', (_label, bad) => {
    expect(sendWindowError(bad)).not.toBeNull();
    expect(parseSendWindow(bad)).toBeNull();
  });

  it('accepts a window that runs to the end of the day (endHour 24)', () => {
    expect(
      sendWindowError({ ...TUE_THU_9_11, startHour: 20, endHour: 24 }),
    ).toBeNull();
  });
});

describe('describeSendWindow / sameSendWindow', () => {
  it('writes days as runs and hours as clock times', () => {
    expect(describeSendWindow(TUE_THU_9_11)).toBe(
      'Tue-Thu 09:00-11:00 (recipient time)',
    );
    expect(describeSendWindow({ ...MON_FRI_9_17, tzBasis: 'workspace' })).toBe(
      'Mon-Fri 09:00-17:00 (workspace time)',
    );
    expect(describeSendWindow({ ...TUE_THU_9_11, days: [1, 3, 5] })).toBe(
      'Mon, Wed, Fri 09:00-11:00 (recipient time)',
    );
    expect(describeSendWindow({ ...TUE_THU_9_11, days: [1, 2, 4] })).toBe(
      'Mon, Tue, Thu 09:00-11:00 (recipient time)',
    );
  });

  it('compares windows by schedule', () => {
    expect(sameSendWindow(TUE_THU_9_11, { ...TUE_THU_9_11 })).toBe(true);
    expect(
      sameSendWindow(TUE_THU_9_11, {
        ...TUE_THU_9_11,
        startHour: 14,
        endHour: 16,
      }),
    ).toBe(false);
    expect(
      sameSendWindow(TUE_THU_9_11, { ...TUE_THU_9_11, tzBasis: 'workspace' }),
    ).toBe(false);
  });
});

describe('resolveWindowZone', () => {
  it('uses the recipient zone when it is real', () => {
    expect(resolveWindowZone('recipient', 'Asia/Kolkata', 'UTC')).toEqual({
      tz: 'Asia/Kolkata',
      usedWorkspaceFallback: false,
    });
  });
  it('falls back to the workspace zone when the recipient has none or a bad one', () => {
    expect(resolveWindowZone('recipient', null, 'America/New_York')).toEqual({
      tz: 'America/New_York',
      usedWorkspaceFallback: true,
    });
    expect(
      resolveWindowZone('recipient', 'Mars/Olympus', 'America/New_York').tz,
    ).toBe('America/New_York');
  });
  it('falls back to UTC when the workspace zone is bad too', () => {
    expect(resolveWindowZone('recipient', null, 'nope').tz).toBe('UTC');
    expect(resolveWindowZone('workspace', null, undefined).tz).toBe('UTC');
  });
  it('workspace basis ignores the recipient entirely', () => {
    expect(
      resolveWindowZone('workspace', 'Asia/Kolkata', 'America/New_York'),
    ).toEqual({ tz: 'America/New_York', usedWorkspaceFallback: false });
  });
});

describe('zonedWallToUtc (wall clock -> instant)', () => {
  it('Asia/Kolkata has no DST: 09:00 is always 03:30 UTC', () => {
    expect(iso(zonedWallToUtc('Asia/Kolkata', 2026, 1, 15, 9))).toBe(
      '2026-01-15T03:30:00.000Z',
    );
    expect(iso(zonedWallToUtc('Asia/Kolkata', 2026, 7, 15, 9))).toBe(
      '2026-07-15T03:30:00.000Z',
    );
  });

  it('America/New_York: 09:00 is 14:00 UTC in winter and 13:00 UTC in summer', () => {
    expect(iso(zonedWallToUtc('America/New_York', 2026, 3, 6, 9))).toBe(
      '2026-03-06T14:00:00.000Z',
    );
    expect(iso(zonedWallToUtc('America/New_York', 2026, 3, 9, 9))).toBe(
      '2026-03-09T13:00:00.000Z',
    );
  });

  it('spring forward (2026-03-08, 02:00 does not exist): shifted to 03:00', () => {
    expect(iso(zonedWallToUtc('America/New_York', 2026, 3, 8, 2))).toBe(
      '2026-03-08T07:00:00.000Z', // 03:00 EDT
    );
    expect(iso(zonedWallToUtc('America/New_York', 2026, 3, 8, 1))).toBe(
      '2026-03-08T06:00:00.000Z', // 01:00 EST, still before the change
    );
  });

  it('fall back (2026-11-01, 01:00 happens twice): the FIRST one', () => {
    expect(iso(zonedWallToUtc('America/New_York', 2026, 11, 1, 1))).toBe(
      '2026-11-01T05:00:00.000Z', // 01:00 EDT, not 01:00 EST (06:00Z)
    );
    expect(iso(zonedWallToUtc('America/New_York', 2026, 11, 1, 2))).toBe(
      '2026-11-01T07:00:00.000Z', // 02:00 EST
    );
  });

  it('southern hemisphere DST too (Australia/Sydney, clocks forward 2026-10-04)', () => {
    expect(iso(zonedWallToUtc('Australia/Sydney', 2026, 10, 3, 9))).toBe(
      '2026-10-02T23:00:00.000Z', // +10
    );
    expect(iso(zonedWallToUtc('Australia/Sydney', 2026, 10, 5, 9))).toBe(
      '2026-10-04T22:00:00.000Z', // +11
    );
  });
});

describe('isInsideWindow', () => {
  it('Asia/Kolkata, Tue-Thu 9-11: inside from 09:00 IST up to (not including) 11:00 IST', () => {
    const tz = 'Asia/Kolkata';
    // Tuesday 2026-11-24, 09:00 IST = 03:30Z
    expect(
      isInsideWindow(TUE_THU_9_11, new Date('2026-11-24T03:29:59Z'), tz),
    ).toBe(false);
    expect(
      isInsideWindow(TUE_THU_9_11, new Date('2026-11-24T03:30:00Z'), tz),
    ).toBe(true);
    expect(
      isInsideWindow(TUE_THU_9_11, new Date('2026-11-24T05:29:59Z'), tz),
    ).toBe(true);
    expect(
      isInsideWindow(TUE_THU_9_11, new Date('2026-11-24T05:30:00Z'), tz),
    ).toBe(false);
  });

  it('America/New_York: the same 09:30 local time is a different UTC time in winter and summer', () => {
    const tz = 'America/New_York';
    const w: SendWindow = { ...TUE_THU_9_11, days: [1, 2, 3, 4, 5] };
    expect(isInsideWindow(w, new Date('2026-11-24T14:30:00Z'), tz)).toBe(true); // EST
    expect(isInsideWindow(w, new Date('2026-11-24T13:30:00Z'), tz)).toBe(false); // 08:30 EST
    expect(isInsideWindow(w, new Date('2026-06-23T13:30:00Z'), tz)).toBe(true); // EDT
    expect(isInsideWindow(w, new Date('2026-06-23T14:30:00Z'), tz)).toBe(true); // 10:30 EDT
    expect(isInsideWindow(w, new Date('2026-06-23T12:30:00Z'), tz)).toBe(false); // 08:30 EDT
  });

  it('the wrong weekday is outside even at the right hour', () => {
    // Monday 2026-11-23, 09:30 IST
    expect(
      isInsideWindow(
        TUE_THU_9_11,
        new Date('2026-11-23T04:00:00Z'),
        'Asia/Kolkata',
      ),
    ).toBe(false);
  });

  it("the weekday is the RECIPIENT's, not UTC's", () => {
    // Tue 2026-11-24 00:30 in Tokyo (UTC+9) is still Mon 15:30 UTC
    const late: SendWindow = {
      days: [2],
      startHour: 0,
      endHour: 2,
      tzBasis: 'recipient',
    };
    expect(
      isInsideWindow(late, new Date('2026-11-23T15:30:00Z'), 'Asia/Tokyo'),
    ).toBe(true);
    expect(isInsideWindow(late, new Date('2026-11-23T15:30:00Z'), 'UTC')).toBe(
      false,
    );
  });

  it('endHour 24 runs to local midnight', () => {
    const evening: SendWindow = {
      days: [2],
      startHour: 20,
      endHour: 24,
      tzBasis: 'recipient',
    };
    // Tue 2026-11-24 23:30 IST = 18:00Z
    expect(
      isInsideWindow(evening, new Date('2026-11-24T18:00:00Z'), 'Asia/Kolkata'),
    ).toBe(true);
    // Wed 00:00 IST = 18:30Z: outside
    expect(
      isInsideWindow(evening, new Date('2026-11-24T18:30:00Z'), 'Asia/Kolkata'),
    ).toBe(false);
  });
});

describe('slotAtOrAfter: the next opening', () => {
  it('Friday evening with a Mon-Fri window opens Monday (across the weekend, with a DST change)', () => {
    // Fri 2026-03-06 22:30Z = 17:30 EST: the window just closed. Monday
    // 2026-03-09 is already EDT (clocks went forward on Sunday 03-08).
    const slot = slotAtOrAfter(
      MON_FRI_9_17,
      new Date('2026-03-06T22:30:00Z'),
      'America/New_York',
    );
    expect(iso(slot!.start)).toBe('2026-03-09T13:00:00.000Z'); // 09:00 EDT
    expect(iso(slot!.end)).toBe('2026-03-09T21:00:00.000Z'); // 17:00 EDT
  });

  it("still inside on Friday at 16:00 EST: the slot is today's, already open", () => {
    const at = new Date('2026-03-06T21:00:00Z');
    const slot = slotAtOrAfter(MON_FRI_9_17, at, 'America/New_York');
    expect(iso(slot!.start)).toBe('2026-03-06T14:00:00.000Z');
    expect(slot!.start.getTime()).toBeLessThanOrEqual(at.getTime());
  });

  it('a Tue-Thu window asked on a Friday opens the next Tuesday', () => {
    const slot = slotAtOrAfter(
      TUE_THU_9_11,
      new Date('2026-11-27T10:00:00Z'), // Fri
      'Asia/Kolkata',
    );
    expect(iso(slot!.start)).toBe('2026-12-01T03:30:00.000Z'); // Tue 09:00 IST
  });

  it("before opening on a window day: today's slot. After closing: the next window day's", () => {
    const tz = 'Asia/Kolkata';
    const before = slotAtOrAfter(
      TUE_THU_9_11,
      new Date('2026-11-24T01:00:00Z'),
      tz,
    ); // Tue 06:30 IST
    expect(iso(before!.start)).toBe('2026-11-24T03:30:00.000Z');
    const after = slotAtOrAfter(
      TUE_THU_9_11,
      new Date('2026-11-24T06:00:00Z'),
      tz,
    ); // Tue 11:30 IST
    expect(iso(after!.start)).toBe('2026-11-25T03:30:00.000Z'); // Wed
  });

  it('a single-day window is found a week later at most', () => {
    const sundayOnly: SendWindow = {
      days: [7],
      startHour: 10,
      endHour: 12,
      tzBasis: 'workspace',
    };
    const slot = slotAtOrAfter(
      sundayOnly,
      new Date('2026-11-23T00:00:00Z'),
      'UTC',
    ); // Monday
    expect(iso(slot!.start)).toBe('2026-11-29T10:00:00.000Z');
  });

  it('DST day lengths: spring forward is an hour shorter, fall back an hour longer', () => {
    const allDay: SendWindow = {
      days: [1, 2, 3, 4, 5, 6, 7],
      startHour: 0,
      endHour: 24,
      tzBasis: 'workspace',
    };
    const spring = slotAtOrAfter(
      allDay,
      new Date('2026-03-08T12:00:00Z'),
      'America/New_York',
    );
    expect((spring!.end.getTime() - spring!.start.getTime()) / 3_600_000).toBe(
      23,
    );
    const fall = slotAtOrAfter(
      allDay,
      new Date('2026-11-01T12:00:00Z'),
      'America/New_York',
    );
    expect((fall!.end.getTime() - fall!.start.getTime()) / 3_600_000).toBe(25);
  });

  it('a window that falls entirely inside the skipped hour is empty that day: skip to the next', () => {
    // Sunday 2026-03-08 02:00-03:00 does not exist in New York
    const skipped: SendWindow = {
      days: [7],
      startHour: 2,
      endHour: 3,
      tzBasis: 'workspace',
    };
    const slot = slotAtOrAfter(
      skipped,
      new Date('2026-03-08T00:00:00Z'),
      'America/New_York',
    );
    expect(iso(slot!.start)).toBe('2026-03-15T06:00:00.000Z'); // the following Sunday, 02:00 EDT
  });
});

describe('scheduleInWindow', () => {
  const base = {
    window: TUE_THU_9_11,
    recipientTz: 'Asia/Kolkata',
    workspaceTz: 'UTC',
    seed: 'cl-1:0',
  };

  it('inside the window: send now, no new time', () => {
    const r = scheduleInWindow({
      ...base,
      now: new Date('2026-11-24T04:00:00Z'),
    });
    expect(r.inside).toBe(true);
    expect(r.nextSendAt).toBeNull();
    expect(r.tz).toBe('Asia/Kolkata');
  });

  it('outside: pushed into the NEXT slot, never before it opens, never after it closes', () => {
    const r = scheduleInWindow({
      ...base,
      now: new Date('2026-11-24T08:00:00Z'),
    }); // Tue 13:30 IST
    expect(r.inside).toBe(false);
    // Wednesday 09:00-11:00 IST = 03:30Z-05:30Z
    expect(r.nextSendAt!.getTime()).toBeGreaterThanOrEqual(
      Date.parse('2026-11-25T03:30:00Z'),
    );
    expect(r.nextSendAt!.getTime()).toBeLessThan(
      Date.parse('2026-11-25T05:30:00Z'),
    );
    // and it IS inside the window when it comes due
    expect(isInsideWindow(TUE_THU_9_11, r.nextSendAt!, 'Asia/Kolkata')).toBe(
      true,
    );
  });

  it('a pushed time is stable: the same lead and step always get the same time', () => {
    const now = new Date('2026-11-24T08:00:00Z');
    const a = scheduleInWindow({ ...base, now });
    const b = scheduleInWindow({
      ...base,
      now: new Date(now.getTime() + 60_000),
    });
    expect(iso(a.nextSendAt!)).toBe(iso(b.nextSendAt!));
  });

  it('1,000 leads due overnight are spread across the window, not fired at the opening', () => {
    const now = new Date('2026-11-24T20:00:00Z'); // Wed 01:30 IST (outside)
    const times = Array.from({ length: 1000 }, (_, i) =>
      scheduleInWindow({
        ...base,
        seed: `lead-${i}:0`,
        now,
      }).nextSendAt!.getTime(),
    );
    const open = Date.parse('2026-11-25T03:30:00Z');
    const close = Date.parse('2026-11-25T05:30:00Z');
    expect(Math.min(...times)).toBeGreaterThanOrEqual(open);
    expect(Math.max(...times)).toBeLessThan(close);
    // not bursting: no single minute holds more than ~3% of them (uniform would be ~0.8%)
    const perMinute = new Map<number, number>();
    for (const t of times)
      perMinute.set(
        Math.floor(t / 60_000),
        (perMinute.get(Math.floor(t / 60_000)) ?? 0) + 1,
      );
    expect(Math.max(...perMinute.values())).toBeLessThan(30);
    // and it reaches into the later half of the window
    expect(times.filter((t) => t > open + 3_600_000).length).toBeGreaterThan(
      300,
    );
  });

  it('recipient without a timezone is read on the workspace clock, and says so', () => {
    const r = scheduleInWindow({
      ...base,
      recipientTz: null,
      workspaceTz: 'America/New_York',
      now: new Date('2026-11-24T01:00:00Z'), // Mon 20:00 EST
    });
    expect(r.usedWorkspaceFallback).toBe(true);
    expect(r.tz).toBe('America/New_York');
    // Tue 09:00-11:00 EST = 14:00Z-16:00Z
    expect(r.nextSendAt!.getTime()).toBeGreaterThanOrEqual(
      Date.parse('2026-11-24T14:00:00Z'),
    );
    expect(r.nextSendAt!.getTime()).toBeLessThan(
      Date.parse('2026-11-24T16:00:00Z'),
    );
  });

  it('a short window still spreads inside itself', () => {
    const short: SendWindow = {
      days: [2],
      startHour: 9,
      endHour: 10,
      tzBasis: 'workspace',
    };
    for (let i = 0; i < 50; i++) {
      const r = scheduleInWindow({
        window: short,
        now: new Date('2026-11-23T12:00:00Z'),
        recipientTz: null,
        workspaceTz: 'UTC',
        seed: `s-${i}`,
      });
      expect(r.nextSendAt!.getTime()).toBeGreaterThanOrEqual(
        Date.parse('2026-11-24T09:00:00Z'),
      );
      expect(r.nextSendAt!.getTime()).toBeLessThan(
        Date.parse('2026-11-24T10:00:00Z'),
      );
    }
  });
});

describe('spreadFraction', () => {
  it('is deterministic and in [0, 1)', () => {
    expect(spreadFraction('x')).toBe(spreadFraction('x'));
    expect(spreadFraction('x')).not.toBe(spreadFraction('y'));
    for (let i = 0; i < 200; i++) {
      const f = spreadFraction(`seed-${i}`);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });
});
