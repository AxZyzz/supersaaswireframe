import request from 'supertest';

type Server = Parameters<typeof request>[0];

/**
 * Campaigns only send from verified senders. Integration tests create SMTP
 * senders with no real server, so they run the normal "Test connection"
 * check, which passes against the mock email driver (forced in setup-env).
 */
export async function verifyAllSenders(server: Server, authorization: string) {
  const list = await request(server)
    .get('/senders')
    .set('Authorization', authorization)
    .expect(200);
  for (const s of list.body as { id: string; status: string }[]) {
    if (s.status === 'verified') continue;
    const r = await request(server)
      .post(`/senders/${s.id}/verify`)
      .set('Authorization', authorization);
    if ((r.body as { ok?: boolean }).ok !== true) {
      throw new Error(
        `sender ${s.id} failed to verify: ${JSON.stringify(r.body)}`,
      );
    }
  }
}
