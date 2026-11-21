import {
  mappingPrompt,
  ruleMapping,
  sanitizeMapping,
  valuesFit,
} from './column-mapping';

// Shaped like the scraped LinkedIn list that broke the old matcher: a JSON
// "activity" column whose header contains "company", and an email-verification
// "status" column.
const headers = [
  'Full Name',
  'Work Email',
  'company_recent_post',
  'Company Name',
  'Job Title',
  'email_status',
  'LinkedIn URL',
];
const rows = [
  [
    'Mindy Lee',
    'mindy@nowcfo.com',
    '{"url":"https://www.linkedin.com/posts/nowcfo_x","likes":25}',
    'NOW CFO',
    'BDR Manager',
    'Verified',
    'https://www.linkedin.com/in/mindy',
  ],
  [
    'Chris Chapman',
    'chris@alpaca.markets',
    '{"url":"https://www.linkedin.com/posts/alpaca_y","likes":46}',
    'Alpaca',
    'Head of Partnerships',
    'Verified',
    'https://www.linkedin.com/in/chris',
  ],
];

describe('column matching for lead imports', () => {
  it('rules: exact header meanings, checked against the values', () => {
    expect(ruleMapping(headers, rows)).toEqual({
      'Full Name': 'fullName',
      'Work Email': 'email',
      company_recent_post: '',
      'Company Name': 'company',
      'Job Title': 'title',
      email_status: '',
      'LinkedIn URL': '',
    });
  });

  it('rules: finds an email column by its values when the header says nothing', () => {
    const m = ruleMapping(
      ['Contact', 'Org'],
      [
        ['a@x.com', 'X'],
        ['b@y.io', 'Y'],
      ],
    );
    expect(m.Contact).toBe('email');
  });

  it('rules: separate first/last names win over a full-name column', () => {
    const m = ruleMapping(
      ['First Name', 'Last Name', 'Name', 'Email'],
      [['Ana', 'Ruiz', 'Ana Ruiz', 'ana@x.com']],
    );
    expect(m).toMatchObject({
      'First Name': 'firstName',
      'Last Name': 'lastName',
      Name: '',
      Email: 'email',
    });
  });

  it('value checks: JSON, URLs and paragraphs never fill a short field', () => {
    expect(valuesFit('company', [rows[0][2]])).toBe(false);
    expect(valuesFit('company', ['https://acme.com'])).toBe(false);
    expect(valuesFit('title', ['x'.repeat(250)])).toBe(false);
    expect(valuesFit('company', ['Acme', 'Globex'])).toBe(true);
    expect(valuesFit('email', ['Verified', 'Verified'])).toBe(false);
    expect(valuesFit('score', ['hot', 'cold'])).toBe(true);
  });

  it("sanitizes the AI's answer: unknown fields, duplicates and bad fits dropped", () => {
    const m = sanitizeMapping(
      {
        'Full Name': 'fullName',
        'Work Email': 'email',
        company_recent_post: 'company', // JSON: rejected
        'Company Name': 'company',
        'Job Title': 'title',
        email_status: 'status',
        'LinkedIn URL': 'linkedin', // not a field
      },
      headers,
      rows,
    );
    expect(m).toEqual({
      'Full Name': 'fullName',
      'Work Email': 'email',
      company_recent_post: '',
      'Company Name': 'company',
      'Job Title': 'title',
      email_status: 'status', // plain short text: allowed here, the importer drops unknown statuses
      'LinkedIn URL': '',
    });
  });

  it('prompt: fast tier, structured output, samples truncated', () => {
    const long = 'y'.repeat(400);
    const p = mappingPrompt(['Bio'], [[long]]);
    expect(p.tier).toBe('fast');
    expect(p.jsonSchema).toBeDefined();
    const content = p.messages[0].content;
    expect(content).not.toContain(long);
    expect(content).toContain('…');
  });
});
