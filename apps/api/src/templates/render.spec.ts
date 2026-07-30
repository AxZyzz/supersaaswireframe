import { renderTemplate, varsFromLead } from './render';

describe('renderTemplate', () => {
  const vars = { first_name: 'Sam', company: 'Acme' };

  it('substitutes whitelisted tokens', () => {
    expect(renderTemplate('Hi {first_name} at {company}', vars)).toBe(
      'Hi Sam at Acme',
    );
  });

  it('uses the fallback when the value is missing/empty', () => {
    expect(renderTemplate('Hi {first_name|there}', {})).toBe('Hi there');
    expect(renderTemplate('Hi {first_name|there}', { first_name: '' })).toBe(
      'Hi there',
    );
  });

  it('leaves unknown tokens literal (surfaces typos)', () => {
    expect(renderTemplate('Hi {frist_name}', vars)).toBe('Hi {frist_name}');
  });

  it('aliases business_name to company via varsFromLead', () => {
    const v = varsFromLead({ company: 'Globex' });
    expect(renderTemplate('{business_name}', v)).toBe('Globex');
  });

  it('empty fallback yields empty string, not the token', () => {
    expect(renderTemplate('X{last_name|}Y', {})).toBe('XY');
  });
});
