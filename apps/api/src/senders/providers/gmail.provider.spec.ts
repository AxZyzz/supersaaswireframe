import {
  clearGmailTokenCache,
  FetchLike,
  GmailAuthError,
  GmailProvider,
} from './gmail.provider';

const CFG = { refreshToken: 'rt-1', clientId: 'cid', clientSecret: 'cs' };

interface Call {
  url: string;
  init: RequestInit;
}

/** Fake Google: token endpoint + Gmail send endpoint, scripted per test. */
function fakeGoogle(opts: {
  token?: { status: number; body: unknown };
  send?: { status: number; body: unknown };
}) {
  const calls: Call[] = [];
  const fn = (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = String(url).includes('oauth2.googleapis.com/token')
      ? (opts.token ?? {
          status: 200,
          body: { access_token: 'at-1', expires_in: 3600 },
        })
      : (opts.send ?? { status: 200, body: { id: 'gmail-id-1' } });
    return Promise.resolve(
      new Response(JSON.stringify(r.body), { status: r.status }),
    );
  };
  return { fn, calls };
}

const provider = (fn: FetchLike) =>
  new GmailProvider(CFG, 'me@acme.com', 'Me Sender', 'replies@acme.com', fn);

describe('GmailProvider', () => {
  beforeEach(() => clearGmailTokenCache());

  it('verify() succeeds when the refresh token works', async () => {
    const g = fakeGoogle({});
    const v = await provider(g.fn).verify();
    expect(v).toEqual({
      ok: true,
      detail: 'Connected to Gmail as me@acme.com',
    });
    const body = new URLSearchParams(g.calls[0].init.body as string);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt-1');
  });

  it('verify() explains a revoked/expired token', async () => {
    const g = fakeGoogle({
      token: { status: 400, body: { error: 'invalid_grant' } },
    });
    const v = await provider(g.fn).verify();
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/revoked or has expired/);
  });

  it('send() posts a raw MIME message with our headers and Message-ID', async () => {
    const g = fakeGoogle({});
    const res = await provider(g.fn).send({
      to: 'lead@prospect.com',
      subject: 'Quick question',
      text: 'Hi there',
      html: '<p>Hi there</p>',
      headers: { 'List-Unsubscribe': '<https://x/u/abc>' },
    });
    expect(res.provider).toBe('gmail');
    expect(res.messageId).toMatch(/^<[0-9a-f-]+@acme\.com>$/);

    const send = g.calls.find((c) => c.url.includes('/messages/send'))!;
    expect((send.init.headers as Record<string, string>).authorization).toBe(
      'Bearer at-1',
    );
    const { raw } = JSON.parse(send.init.body as string) as { raw: string };
    const mime = Buffer.from(raw, 'base64url').toString('utf8');
    expect(mime).toMatch(/^From: Me Sender <me@acme\.com>/m);
    expect(mime).toMatch(/^To: lead@prospect\.com/m);
    expect(mime).toMatch(/^Subject: Quick question/m);
    expect(mime).toMatch(/^Reply-To: replies@acme\.com/m);
    expect(mime).toMatch(/^List-Unsubscribe: <https:\/\/x\/u\/abc>/m);
    expect(mime).toContain(`Message-ID: ${res.messageId}`);
  });

  it('reuses the access token across sends (one refresh)', async () => {
    const g = fakeGoogle({});
    const p = provider(g.fn);
    await p.send({ to: 'a@b.com', subject: 's', text: 't' });
    await provider(g.fn).send({ to: 'c@d.com', subject: 's', text: 't' });
    const refreshes = g.calls.filter((c) => c.url.includes('/token'));
    expect(refreshes).toHaveLength(1);
  });

  it('send() throws GmailAuthError when the token is revoked', async () => {
    const g = fakeGoogle({
      token: { status: 400, body: { error: 'invalid_grant' } },
    });
    await expect(
      provider(g.fn).send({ to: 'a@b.com', subject: 's', text: 't' }),
    ).rejects.toBeInstanceOf(GmailAuthError);
  });

  it('send() surfaces Gmail API errors and drops the cached token on 401', async () => {
    const g = fakeGoogle({
      send: {
        status: 401,
        body: { error: { message: 'Invalid Credentials' } },
      },
    });
    const p = provider(g.fn);
    await expect(
      p.send({ to: 'a@b.com', subject: 's', text: 't' }),
    ).rejects.toThrow(/HTTP 401\): Invalid Credentials/);
    await expect(
      p.send({ to: 'a@b.com', subject: 's', text: 't' }),
    ).rejects.toThrow();
    // token was refreshed again after the 401 instead of reusing the bad one
    expect(g.calls.filter((c) => c.url.includes('/token'))).toHaveLength(2);
  });
});
