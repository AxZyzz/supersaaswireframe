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

describe('renderTemplate HTML safety', () => {
  const evil = '<a href="https://evil.example/login">Account locked</a>';

  it('escapes lead-supplied values in HTML bodies', () => {
    const out = renderTemplate(
      '<p>Hi {first_name}</p>',
      { first_name: evil },
      { html: true },
    );
    expect(out).toBe(
      '<p>Hi &lt;a href=&quot;https://evil.example/login&quot;&gt;Account locked&lt;/a&gt;</p>',
    );
    expect(out).not.toContain('<a ');
  });

  it('leaves subjects / plain text unescaped and author fallbacks raw', () => {
    expect(renderTemplate('Hi {first_name}', { first_name: 'Ann & Co' })).toBe(
      'Hi Ann & Co',
    );
    expect(
      renderTemplate(
        '<p>{first_name|<b>there</b>}</p>',
        { first_name: null },
        { html: true },
      ),
    ).toBe('<p><b>there</b></p>');
  });
});
