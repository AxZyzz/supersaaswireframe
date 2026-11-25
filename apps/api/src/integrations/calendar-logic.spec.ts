import {
  bookingAnswers,
  calendarKeys,
  CALENDAR_SCOPE,
  DEFAULT_RESPONSE_WINDOW_DAYS,
  EVENT_FIELDS,
  parseEvent,
  pickSend,
  readRange,
  SendCandidate,
  updatedMin,
} from './calendar-logic';

const DAY = 86_400_000;
const ME = 'Owner@Gmail.com';

describe('parseEvent', () => {
  it('lower-cases attendees and drops the account itself, rooms and people who declined', () => {
    const e = parseEvent(
      {
        id: 'e1',
        status: 'confirmed',
        created: '2026-11-20T10:00:00Z',
        start: { dateTime: '2026-11-25T09:30:00+05:30' },
        attendees: [
          { email: 'Jane@Acme.COM' },
          { email: 'owner@gmail.com', self: true },
          { email: 'OWNER@gmail.com' }, // the account again, no self flag
          { email: 'room-4@resource.calendar.google.com', resource: true },
          { email: 'declined@acme.com', responseStatus: 'declined' },
          { email: 'jane@acme.com' }, // same person twice
          { email: '  ' },
          {},
        ],
      },
      ME,
    );
    expect(e).toEqual({
      id: 'e1',
      cancelled: false,
      start: '2026-11-25T04:00:00.000Z',
      created: '2026-11-20T10:00:00.000Z',
      attendees: ['jane@acme.com'],
    });
  });

  it('reads a cancelled event that carries nothing but an id', () => {
    expect(parseEvent({ id: 'gone', status: 'cancelled' }, ME)).toEqual({
      id: 'gone',
      cancelled: true,
      start: null,
      created: null,
      attendees: [],
    });
  });

  it('takes the date of an all-day event and skips an event without an id', () => {
    expect(
      parseEvent({ id: 'd', start: { date: '2026-12-01' } }, ME)?.start,
    ).toBe('2026-12-01T00:00:00.000Z');
    expect(parseEvent({ status: 'confirmed' }, ME)).toBeNull();
  });
});

describe('what we ask Google for', () => {
  it('never requests a title, description, location or conference data', () => {
    for (const banned of [
      'summary',
      'description',
      'location',
      'organizer',
      'creator',
      'conferenceData',
      'htmlLink',
      'attachments',
    ]) {
      expect(EVENT_FIELDS).not.toContain(banned);
    }
    expect(EVENT_FIELDS).toContain('attendees(email');
  });

  it('asks for the read-only events scope and nothing broader', () => {
    expect(CALENDAR_SCOPE).toBe(
      'https://www.googleapis.com/auth/calendar.events.readonly',
    );
  });
});

describe('calendarKeys', () => {
  it('is stable per calendar and event, and lower-cases the calendar', () => {
    expect(calendarKeys.booked('Owner@Gmail.com', 'abc')).toBe(
      'cal:owner@gmail.com:abc',
    );
    expect(calendarKeys.cancelled('Owner@Gmail.com', 'abc')).toBe(
      'calcancel:owner@gmail.com:abc',
    );
  });
});

describe('bookingAnswers', () => {
  const sentAt = new Date('2026-11-01T10:00:00Z');
  const at = (days: number) => new Date(sentAt.getTime() + days * DAY);

  it('counts a booking from the send until the end of the response window', () => {
    expect(bookingAnswers({ sentAt, windowDays: 14 }, sentAt)).toBe(true);
    expect(bookingAnswers({ sentAt, windowDays: 14 }, at(14))).toBe(true);
    expect(bookingAnswers({ sentAt, windowDays: 14 }, at(14.01))).toBe(false);
  });

  it('never counts a booking made before the email went out', () => {
    expect(
      bookingAnswers(
        { sentAt, windowDays: 14 },
        new Date(sentAt.getTime() - 1),
      ),
    ).toBe(false);
  });

  it('uses the default window when the email had no experiment', () => {
    expect(DEFAULT_RESPONSE_WINDOW_DAYS).toBe(14);
    expect(bookingAnswers({ sentAt, windowDays: null }, at(13))).toBe(true);
    expect(bookingAnswers({ sentAt, windowDays: null }, at(15))).toBe(false);
  });

  it('respects a longer or shorter experiment window', () => {
    expect(bookingAnswers({ sentAt, windowDays: 30 }, at(25))).toBe(true);
    expect(bookingAnswers({ sentAt, windowDays: 7 }, at(8))).toBe(false);
  });
});

describe('pickSend', () => {
  const c = (id: string, sentDaysAgo: number, windowDays: number | null = 14) =>
    ({
      sentEmailId: id,
      leadId: 'lead',
      sentAt: new Date(Date.parse('2026-11-20T00:00:00Z') - sentDaysAgo * DAY),
      windowDays,
    }) satisfies SendCandidate;
  const bookedAt = new Date('2026-11-20T00:00:00Z');

  it('picks the most recent email whose window covers the booking', () => {
    const list = [c('old', 10), c('new', 2), c('expired', 40)];
    expect(pickSend(list, bookedAt)?.sentEmailId).toBe('new');
  });

  it('skips an email whose window has closed and returns null when none answers', () => {
    expect(pickSend([c('expired', 40)], bookedAt)).toBeNull();
    expect(pickSend([], bookedAt)).toBeNull();
  });

  it('ignores emails sent after the booking', () => {
    expect(pickSend([c('later', -2)], bookedAt)).toBeNull();
  });
});

describe('readRange and updatedMin', () => {
  it('reads from yesterday to 30 days ahead', () => {
    const now = new Date('2026-11-22T12:00:00Z');
    expect(readRange(now)).toEqual({
      timeMin: '2026-11-21T12:00:00.000Z',
      timeMax: '2026-12-22T12:00:00.000Z',
    });
  });

  it('has no cursor on the first sync, then overlaps the last one by 5 minutes', () => {
    expect(updatedMin(null)).toBeNull();
    expect(updatedMin('not a date')).toBeNull();
    expect(updatedMin('2026-11-22T12:00:00.000Z')).toBe(
      '2026-11-22T11:55:00.000Z',
    );
  });
});
