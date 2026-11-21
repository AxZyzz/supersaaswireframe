import * as sharedAttrs from '../../../../packages/shared/src/attributes';
import * as apiAttrs from './attributes';
import { companyKey } from './company-key';
import {
  MailProviderResolver,
  MemoryMailProviderCache,
  mapMx,
} from './mail-provider';
import {
  cleanIndustry,
  cleanSizeBand,
  timezoneFor,
  verifyLocation,
  verifyTriggers,
} from '../prospects/attributes';

describe('T01 Company key, Discover attributes, triggers and mail provider', () => {
  it('shared and API attribute lists stay in sync', () => {
    expect(apiAttrs.INDUSTRIES).toEqual(sharedAttrs.INDUSTRIES);
    expect(apiAttrs.SIZE_BANDS).toEqual(sharedAttrs.SIZE_BANDS);
    expect(apiAttrs.TRIGGER_TYPES).toEqual(sharedAttrs.TRIGGER_TYPES);
    expect(apiAttrs.MAIL_PROVIDERS).toEqual(sharedAttrs.MAIL_PROVIDERS);
  });

  it('normalizes companyKey from website or email and isolates free-mail', () => {
    expect(companyKey('info@acme.com', 'https://www.Acme.com/about')).toBe(
      'acme.com',
    );
    expect(companyKey('a@gmail.com')).toBe('email:a@gmail.com');
    expect(companyKey('A@GMAIL.COM')).toBe('email:a@gmail.com');
    expect(companyKey('sales@mail.acme.com')).toBe('acme.com');
    expect(companyKey(null, null)).toBeNull();
    expect(companyKey('contact@acme.com')).toBe(
      companyKey('other@acme.com', 'https://www.acme.com'),
    );
  });

  it('verifies triggers only when verbatim quote appears on a fetched page', () => {
    const pages = [
      {
        url: 'https://acme.com/about',
        text: 'We are opening our second clinic in Baner this month and hiring nurses.',
      },
    ];
    const kept = verifyTriggers(
      [
        {
          type: 'expansion',
          quote: 'opening our second   clinic in Baner',
          url: 'https://acme.com/about',
        },
        {
          type: 'funding',
          quote: 'raised $10M Series A from Sequoia',
          url: 'https://acme.com/about',
        },
      ],
      pages,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].type).toBe('expansion');
  });

  it('derives timezone in code from country and city', () => {
    expect(timezoneFor('IN', 'Pune')).toBe('Asia/Kolkata');
    expect(timezoneFor('India', null)).toBe('Asia/Kolkata');
    expect(timezoneFor('US', null)).toBeNull();
    expect(timezoneFor('US', 'Austin')).toBe('America/Chicago');
    expect(timezoneFor('InvalidCountry', 'Nowhere')).toBeNull();
  });

  it('verifies location against page text and validates industry/size_band', () => {
    const loc = verifyLocation(
      { city: 'Pune', region: 'Maharashtra', country: 'India' },
      [
        {
          url: 'https://c.in',
          text: 'Visit our office in Pune, Maharashtra, India.',
        },
      ],
    );
    expect(loc).toEqual({
      city: 'Pune',
      region: 'Maharashtra',
      country: 'IN',
      timezone: 'Asia/Kolkata',
    });
    expect(cleanIndustry('healthcare_clinic')).toBe('healthcare_clinic');
    expect(cleanIndustry('made_up')).toBe('unknown');
    expect(cleanSizeBand('11-50')).toBe('11-50');
    expect(cleanSizeBand('huge')).toBe('unknown');
  });

  it('maps MX records and caches domain lookups', async () => {
    expect(mapMx([{ exchange: 'aspmx.l.google.com', priority: 1 }])).toBe(
      'google',
    );
    expect(
      mapMx([
        { exchange: 'acme-com.mail.protection.outlook.com', priority: 0 },
      ]),
    ).toBe('microsoft');
    expect(mapMx([{ exchange: 'mx.zoho.in', priority: 10 }])).toBe('zoho');
    expect(mapMx([{ exchange: 'mx.custom.org', priority: 10 }])).toBe('other');
    expect(mapMx([])).toBe('unknown');

    let calls = 0;
    const resolver = new MailProviderResolver(
      new MemoryMailProviderCache(),
      () => {
        calls++;
        return Promise.resolve([
          { exchange: 'aspmx.l.google.com', priority: 1 },
        ]);
      },
    );
    expect(await resolver.lookup('acme.com')).toBe('google');
    expect(await resolver.lookup('ACME.com')).toBe('google');
    expect(calls).toBe(1);
  });
});
