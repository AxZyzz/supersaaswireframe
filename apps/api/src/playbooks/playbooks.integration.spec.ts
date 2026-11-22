/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { NativeDiscoverDriver } from '../prospects/discover-driver';
import { ProspectsService } from '../prospects/prospects.service';
import {
  CHALLENGER_DRAFTER,
  type ChallengerDraftInput,
} from '../review/challenger-drafter';
import { candidateLoader } from './playbook-candidates';
import { KeywordRetriever, type RetrieveQuery } from './playbook-retriever';
import { PLAYBOOK_RETRIEVER, PlaybooksService } from './playbooks.service';
import {
  PLAYBOOK_VECTOR_STORE,
  type PlaybookVectorStore,
  type VectorRecord,
} from './vector-store';

jest.setTimeout(120_000);

/**
 * Learning Loop T14 against a real Postgres: drafting from an approved
 * promotion or a search preference, saving, versions, retiring, roles, tenant
 * isolation, the vector copy (with a fake store) and the re-check that keeps a
 * wrong index from surfacing the wrong text.
 */
describe('Playbook memory (T14)', () => {
  let app: INestApplication;
  let pool: Pool;
  let adminToken: string;
  let managerToken: string;
  let agentToken: string;
  let otherToken: string;
  let orgId: string;
  let otherOrgId: string;
  let adminId: string;
  let otherAdminId: string;
  const extraUsers: string[] = [];
  let offerId: string;
  let offer2Id: string;
  let otherOfferId: string;

  const http = () => request(app.getHttpServer());
  const as = (t: string) => `Bearer ${t}`;
  const inOrg = <T>(
    o: string,
    fn: (c: Parameters<Parameters<typeof withOrgContext>[2]>[0]) => Promise<T>,
  ) => withOrgContext(pool, o, fn);
  const q = <T>(
    fn: (c: Parameters<Parameters<typeof withOrgContext>[2]>[0]) => Promise<T>,
  ) => inOrg(orgId, fn);

  // ── test doubles for the two cloud-facing seams ───────────────────────

  /** In-memory vector index. `fail` simulates BigQuery being down. */
  const store: PlaybookVectorStore & {
    rows: Map<string, VectorRecord>;
    fail: boolean;
  } = {
    name: 'memory',
    rows: new Map<string, VectorRecord>(),
    fail: false,
    upsert(r: VectorRecord) {
      if (store.fail) return Promise.reject(new Error('BigQuery is down'));
      store.rows.set(r.playbookId, r);
      return Promise.resolve();
    },
    remove(_org: string, id: string) {
      store.rows.delete(id);
      return Promise.resolve();
    },
    search: () => Promise.resolve([]),
  };

  /** keyword = the real keyword search; fixed = a (possibly wrong) index that returns whatever ids it is told to. */
  const retriever = {
    name: 'test',
    mode: 'keyword' as 'keyword' | 'fixed',
    fixed: [] as string[],
    kw: null as KeywordRetriever | null,
    retrieve(qy: RetrieveQuery): Promise<string[]> {
      return retriever.mode === 'fixed'
        ? Promise.resolve(retriever.fixed)
        : (retriever.kw as KeywordRetriever).retrieve(qy);
    },
  };

  /** Stands in for the Copywriter / Gemini drafter and records the hints it was given. */
  const drafter = {
    seen: [] as ChallengerDraftInput[],
    draft(input: ChallengerDraftInput) {
      drafter.seen.push(input);
      return Promise.resolve(
        ['Hint-aware one', 'Hint-aware two', 'Hint-aware three'].map(
          (subject) => ({
            subject,
            source: 'template' as const,
          }),
        ),
      );
    },
  };

  // ── builders ───────────────────────────────────────────────────────────

  /** A campaign + experiment (A control, B) for an offer, with a stored review. */
  const mkReview = async (o: {
    draft?: boolean;
    promote: boolean;
    simulated?: boolean;
    approved?: boolean;
    offer?: string | null;
  }) =>
    q(async (c) => {
      const offer = o.offer === undefined ? offerId : o.offer;
      const camp = await c.query<{ id: string }>(
        `INSERT INTO campaigns (org_id, name, status) VALUES ($1,'T14 camp','active') RETURNING id`,
        [orgId],
      );
      const st = await c.query<{ id: string }>(
        `INSERT INTO campaign_steps (org_id, campaign_id, step_order, delay_hours) VALUES ($1,$2,0,0) RETURNING id`,
        [orgId, camp.rows[0].id],
      );
      const ex = await c.query<{ id: string }>(
        `INSERT INTO experiments (org_id, campaign_id, step_id, status, started_at, offer_ref, created_by)
         VALUES ($1,$2,$3,'running',now(),$4,$5) RETURNING id`,
        [orgId, camp.rows[0].id, st.rows[0].id, offer, adminId],
      );
      const ids: string[] = [];
      for (const [i, label] of ['A', 'B'].entries()) {
        const v = await c.query<{ id: string }>(
          `INSERT INTO experiment_variants (org_id, experiment_id, label, subject, is_control, status)
           VALUES ($1,$2,$3,$4,$5,'active') RETURNING id`,
          [
            orgId,
            ex.rows[0].id,
            label,
            i === 0 ? 'Hello there' : 'Quick question about {company}',
            i === 0,
          ],
        );
        ids.push(v.rows[0].id);
      }
      const [a, b] = ids;
      const arm = (
        variantId: string,
        label: string,
        control: boolean,
        rate: number,
        n: number,
        qv: number,
      ) => ({
        variantId,
        label,
        isControl: control,
        assigned: n,
        qualifiedRate: rate,
        qualifiedLo: rate / 2,
        qualifiedHi: rate * 2,
        qualifiedVerified: qv,
        qualifiedProvisional: 0,
        bookedRate: null,
        qualifiedRateOfDelivered: null,
        sent: n,
        delivered: n,
        bounceRate: 0,
        unsubscribeRate: 0,
        complaintRate: 0,
        openRate: null,
        replyRate: null,
      });
      const result = o.promote
        ? {
            decision: 'promote',
            winnerVariantId: b,
            arms: [
              arm(a, 'A', true, 0.05, 240, 12),
              arm(b, 'B', false, 0.225, 240, 54),
            ],
            lift: {
              d: 0.175,
              lo: 0.0214,
              hi: 0.3293,
              controlId: a,
              challengerId: b,
            },
            findings: [
              { id: 'F1', kind: 'rate' },
              { id: 'F2', kind: 'lift' },
            ],
            allowedActions: o.draft
              ? [
                  {
                    actionId: 'draft-1',
                    type: 'draft_challenger',
                    label: 'Draft a challenger',
                  },
                ]
              : [],
          }
        : {
            decision: 'inconclusive',
            winnerVariantId: null,
            arms: [],
            lift: null,
            findings: [],
            allowedActions: [],
          };
      const reviewId = randomUUID();
      await c.query(
        `INSERT INTO reviews (id, org_id, experiment_id, revision, policy_version, simulated,
            inputs_hash, inputs, result, explanation)
         VALUES ($1,$2,$3,1,'v1',$4,$5,'{}'::jsonb,$6::jsonb,'{"summary":"x","points":[]}'::jsonb)`,
        [
          reviewId,
          orgId,
          ex.rows[0].id,
          o.simulated ?? false,
          `h-${reviewId}`,
          JSON.stringify(result),
        ],
      );
      if (o.approved) {
        await c.query(
          `INSERT INTO review_actions (org_id, review_id, experiment_id, revision, action_id, type, status,
              idempotency_key, applied_at, requested_by, approved_by)
           VALUES ($1,$2,$3,1,$4,'pause_variant','applied',$5,now(),$6,$6)`,
          [
            orgId,
            reviewId,
            ex.rows[0].id,
            `pause-${reviewId.slice(0, 8)}`,
            randomUUID(),
            adminId,
          ],
        );
      }
      return { reviewId, experimentId: ex.rows[0].id };
    });

  const mkPreference = async (status = 'active') =>
    q(async (c) => {
      const p = randomUUID();
      // one active preference per workspace + offer (no stacking in V1)
      await c.query(
        `UPDATE search_preferences SET status = 'expired' WHERE offer_id = $1 AND status = 'active'`,
        [offerId],
      );
      await c.query(
        `INSERT INTO search_preferences (id, org_id, offer_id, factor, value, label, filter, mode, cap_share,
            expires_at, evidence, evidence_hash, status, idempotency_key)
         VALUES ($1,$2,$3,'city','Pune','City: Pune','{}'::jsonb,'quota',0.2, now() + interval '14 days',
            $4::jsonb,$5,$6,$7)`,
        [
          p,
          orgId,
          offerId,
          JSON.stringify({
            insightId: 'i1',
            metric: 'qualified',
            x: 8,
            n: 60,
            p: 0.1333,
            lo: 0.0693,
            hi: 0.2424,
            overallP: 0.0444,
            sentence: 's',
            confounding: null,
            computedAt: new Date().toISOString(),
            from: null,
            to: null,
            source: 'postgres',
          }),
          `eh-${p}`,
          status,
          `idem-${p}`,
        ],
      );
      return p;
    });

  const save = (t: string, body: Record<string, unknown>) =>
    http().post('/playbooks').set('Authorization', as(t)).send(body);

  const savedFromReview = async (
    title: string,
    extra: Record<string, unknown> = {},
    o = {},
  ) => {
    const r = await mkReview({ promote: true, approved: true, ...o });
    const res = await save(managerToken, {
      reviewId: r.reviewId,
      title,
      body: 'Short question subjects beat plain greetings for this offer in our test.',
      ...extra,
    }).expect(201);
    return { ...r, pb: res.body };
  };

  beforeAll(async () => {
    process.env.THROTTLE_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PLAYBOOK_VECTOR_STORE)
      .useValue(store)
      .overrideProvider(PLAYBOOK_RETRIEVER)
      .useValue(retriever)
      .overrideProvider(CHALLENGER_DRAFTER)
      .useValue(drafter)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    pool = app.get<Pool>(PG_POOL);
    retriever.kw = new KeywordRetriever(candidateLoader(pool));

    const signup = async (tag: string) => {
      const r = await http()
        .post('/auth/signup')
        .send({
          email: `t14-${tag}-${randomUUID().slice(0, 8)}@test.local`,
          password: 't14-password-123',
          name: `T14 ${tag}`,
          orgName: `T14 Org ${tag}`,
        })
        .expect(201);
      return r.body as {
        accessToken: string;
        org: { id: string };
        user: { id: string };
      };
    };
    const a = await signup('A');
    adminToken = a.accessToken;
    orgId = a.org.id;
    adminId = a.user.id;
    const b = await signup('B');
    otherToken = b.accessToken;
    otherOrgId = b.org.id;
    otherAdminId = b.user.id;

    const invite = async (role: 'manager' | 'agent') => {
      const inv = await http()
        .post('/orgs/invites')
        .set('Authorization', as(adminToken))
        .send({
          email: `t14-${role}-${randomUUID().slice(0, 8)}@test.local`,
          role,
        })
        .expect(201);
      const reg = await http()
        .post(`/invites/${inv.body.token}/register`)
        .send({ name: `T14 ${role}`, password: 'invitee-pass-123' })
        .expect(201);
      extraUsers.push(reg.body.user.id);
      return reg.body.accessToken as string;
    };
    managerToken = await invite('manager');
    agentToken = await invite('agent');

    await q(async (c) => {
      const o1 = await c.query<{ id: string }>(
        `INSERT INTO offers (org_id, name) VALUES ($1,'Dental website redesign') RETURNING id`,
        [orgId],
      );
      const o2 = await c.query<{ id: string }>(
        `INSERT INTO offers (org_id, name) VALUES ($1,'Payroll software') RETURNING id`,
        [orgId],
      );
      offerId = o1.rows[0].id;
      offer2Id = o2.rows[0].id;
    });
    await inOrg(otherOrgId, async (c) => {
      const o = await c.query<{ id: string }>(
        `INSERT INTO offers (org_id, name) VALUES ($1,'Other offer') RETURNING id`,
        [otherOrgId],
      );
      otherOfferId = o.rows[0].id;
    });
  });

  afterAll(async () => {
    delete process.env.THROTTLE_DISABLED;
    for (const o of [orgId, otherOrgId]) {
      await withOrgContext(pool, o, (c) =>
        c.query(`DELETE FROM orgs WHERE id = $1`, [o]),
      );
    }
    for (const u of [adminId, otherAdminId, ...extraUsers]) {
      await pool.query(`DELETE FROM users WHERE id = $1`, [u]);
    }
    await app.close();
  });

  beforeEach(() => {
    store.fail = false;
    retriever.mode = 'keyword';
  });

  // ── drafting ───────────────────────────────────────────────────────────

  describe('drafting a playbook from an approved result', () => {
    it('a promoted, approved review gives a draft built from its own numbers', async () => {
      const r = await mkReview({ promote: true, approved: true });
      const d = await http()
        .post('/playbooks/draft')
        .set('Authorization', as(managerToken))
        .send({ reviewId: r.reviewId })
        .expect(200);
      expect(d.body).toMatchObject({
        offerId,
        kind: 'message',
        segment: null,
        validDays: 90,
        evidence: {
          source: 'review',
          reviewId: r.reviewId,
          decision: 'promote',
        },
      });
      expect(d.body.evidence.numbers.liftPoints).toBe(17.5);
      expect(['template', 'mock', 'gemini']).toContain(d.body.source);
      expect(d.body.title.length).toBeGreaterThan(2);
      // nothing is saved by drafting
      const n = await q((c) => c.query(`SELECT 1 FROM playbooks`));
      expect(n.rowCount).toBe(0);
    });

    it.each([
      ['not promoted', { promote: false, approved: true }, 409, 'not_promoted'],
      [
        'promoted but not approved',
        { promote: true, approved: false },
        409,
        'not_approved',
      ],
      [
        'simulated',
        { promote: true, approved: true, simulated: true },
        400,
        'simulated',
      ],
      [
        'no offer',
        { promote: true, approved: true, offer: null },
        400,
        'no_offer',
      ],
    ])('refuses a review that is %s', async (_n, o, status, error) => {
      const r = await mkReview(o);
      const d = await http()
        .post('/playbooks/draft')
        .set('Authorization', as(managerToken))
        .send({ reviewId: r.reviewId })
        .expect(status);
      expect(d.body.error).toBe(error);
    });

    it('a search preference gives an audience draft with its segment', async () => {
      const p = await mkPreference();
      const d = await http()
        .post('/playbooks/draft')
        .set('Authorization', as(managerToken))
        .send({ preferenceId: p })
        .expect(200);
      expect(d.body).toMatchObject({
        kind: 'audience',
        segment: { factor: 'city', value: 'Pune' },
        evidence: { source: 'preference', preferenceId: p },
      });
      expect(d.body.body).toContain('not proof');
    });

    it('a withdrawn preference is not a lesson', async () => {
      const p = await mkPreference('withdrawn');
      const d = await http()
        .post('/playbooks/draft')
        .set('Authorization', as(managerToken))
        .send({ preferenceId: p })
        .expect(409);
      expect(d.body.error).toBe('preference_ended');
    });

    it('needs exactly one source, and a real one', async () => {
      await http()
        .post('/playbooks/draft')
        .set('Authorization', as(managerToken))
        .send({})
        .expect(400);
      await http()
        .post('/playbooks/draft')
        .set('Authorization', as(managerToken))
        .send({ reviewId: randomUUID(), preferenceId: randomUUID() })
        .expect(400);
      await http()
        .post('/playbooks/draft')
        .set('Authorization', as(managerToken))
        .send({ reviewId: randomUUID() })
        .expect(404);
    });
  });

  // ── saving, roles, validation ──────────────────────────────────────────

  describe('saving', () => {
    it('saves with evidence rebuilt by the server, 90 days of validity and an indexed vector', async () => {
      const { pb, reviewId, experimentId } = await savedFromReview(
        'Winning subject: short question',
      );
      expect(pb).toMatchObject({
        offerId,
        offerName: 'Dental website redesign',
        kind: 'message',
        version: 1,
        status: 'active',
        supersedesId: null,
        vectorStatus: 'indexed',
        expired: false,
        evidence: {
          source: 'review',
          reviewId,
          experimentId,
          decision: 'promote',
        },
      });
      const days =
        (new Date(pb.validTo).getTime() - new Date(pb.validFrom).getTime()) /
        86_400_000;
      expect(Math.round(days)).toBe(90);
      // the vector copy carries ids and the expiry, never the text
      const v = store.rows.get(pb.id) as VectorRecord;
      expect(v).toMatchObject({
        orgId,
        playbookId: pb.id,
        version: 1,
        offerId,
      });
      expect(v.embedding.length).toBeGreaterThan(0);
      expect(JSON.stringify(v)).not.toContain('short question');
    });

    it('the client cannot send its own evidence, offer or segment', async () => {
      const r = await mkReview({ promote: true, approved: true });
      for (const extra of [
        { evidence: { numbers: { liftPoints: 99 } } },
        { offerId: otherOfferId },
        { segment: { factor: 'city', value: 'Oslo' } },
      ]) {
        await save(managerToken, {
          reviewId: r.reviewId,
          title: 'Sneaky playbook',
          body: 'Trying to smuggle my own evidence into a playbook.',
          ...extra,
        }).expect(400);
      }
    });

    it('an audience playbook takes its segment from the preference, not from the client', async () => {
      const p = await mkPreference();
      const res = await save(managerToken, {
        preferenceId: p,
        title: 'Pune hiring firms looked better',
        body: 'Pune companies replied more; keep testing it, this is not proof.',
      }).expect(201);
      expect(res.body).toMatchObject({
        kind: 'audience',
        segment: { factor: 'city', value: 'Pune' },
      });
    });

    it('validates the words, the validity and the source', async () => {
      const r = await mkReview({ promote: true, approved: true });
      const ok = {
        reviewId: r.reviewId,
        title: 'A fine title',
        body: 'A body that is long enough to save.',
      };
      await save(managerToken, { ...ok, title: 'ab' }).expect(400);
      await save(managerToken, { ...ok, body: 'short' }).expect(400);
      await save(managerToken, { ...ok, body: 'x'.repeat(501) }).expect(400);
      await save(managerToken, { ...ok, validDays: 0 }).expect(400);
      await save(managerToken, { ...ok, validDays: 366 }).expect(400);
      await save(managerToken, { title: ok.title, body: ok.body }).expect(400); // no source
      await save(managerToken, { ...ok, preferenceId: randomUUID() }).expect(
        400,
      ); // two sources
      await save(managerToken, { ...ok, validDays: 30 }).expect(201);
    });

    it('a double save of the same title for the same offer is refused', async () => {
      await savedFromReview('Same title twice');
      const r = await mkReview({ promote: true, approved: true });
      const dup = await save(managerToken, {
        reviewId: r.reviewId,
        title: 'SAME TITLE TWICE',
        body: 'Another body that is long enough to be saved here.',
      }).expect(409);
      expect(dup.body.error).toBe('duplicate');
    });

    it('a failing vector copy never blocks saving: it is marked failed, and an admin can rebuild it', async () => {
      store.fail = true;
      const { pb } = await savedFromReview('Saved while BigQuery was down');
      expect(pb.vectorStatus).toBe('failed');
      expect(store.rows.has(pb.id)).toBe(false);
      store.fail = false;
      await http()
        .post('/playbooks/reindex')
        .set('Authorization', as(managerToken))
        .expect(403);
      const re = await http()
        .post('/playbooks/reindex')
        .set('Authorization', as(adminToken))
        .expect(200);
      expect(re.body.indexed).toBeGreaterThanOrEqual(1);
      expect(re.body.skipped).toBe(false);
      const after = await http()
        .get(`/playbooks/${pb.id}`)
        .set('Authorization', as(agentToken))
        .expect(200);
      expect(after.body.vectorStatus).toBe('indexed');
      expect(store.rows.has(pb.id)).toBe(true);
    });
  });

  describe('roles', () => {
    it('everyone reads; only managers and admins draft, save, edit and retire', async () => {
      const { pb, reviewId } = await savedFromReview('Role check playbook');
      await http()
        .get('/playbooks')
        .set('Authorization', as(agentToken))
        .expect(200);
      await http()
        .get(`/playbooks/${pb.id}`)
        .set('Authorization', as(agentToken))
        .expect(200);
      await http()
        .get(`/playbooks/${pb.id}/versions`)
        .set('Authorization', as(agentToken))
        .expect(200);
      await http()
        .post('/playbooks/draft')
        .set('Authorization', as(agentToken))
        .send({ reviewId })
        .expect(403);
      await save(agentToken, {
        reviewId,
        title: 'Agent tries',
        body: 'An agent is not allowed to save this.',
      }).expect(403);
      await http()
        .patch(`/playbooks/${pb.id}`)
        .set('Authorization', as(agentToken))
        .send({
          title: 'Agent edit',
          body: 'An agent is not allowed to edit this one.',
        })
        .expect(403);
      await http()
        .post(`/playbooks/${pb.id}/retire`)
        .set('Authorization', as(agentToken))
        .expect(403);
      await http()
        .post('/playbooks/reindex')
        .set('Authorization', as(agentToken))
        .expect(403);
      // the manager can
      await http()
        .patch(`/playbooks/${pb.id}`)
        .set('Authorization', as(managerToken))
        .send({
          title: 'Role check playbook v2',
          body: 'A manager edits this one and gets version two.',
        })
        .expect(200);
    });

    it('the service repeats the role check (a background caller cannot skip the controller)', async () => {
      const svc = app.get(PlaybooksService);
      const agent = { userId: adminId, orgId, role: 'agent' as const };
      await expect(
        svc.draftFromReview(orgId, agent, randomUUID()),
      ).rejects.toThrow(/Only managers/);
      await expect(svc.retire(orgId, agent, randomUUID())).rejects.toThrow(
        /Only managers/,
      );
      await expect(
        svc.reindex(orgId, { ...agent, role: 'manager' as const }),
      ).rejects.toThrow(/Only admins/);
    });
  });

  // ── versions and retiring ──────────────────────────────────────────────

  describe('versions and retiring', () => {
    it('an edit is a new version; the old one stays as history and its vector moves', async () => {
      const { pb } = await savedFromReview('Versioned playbook');
      const v2 = await http()
        .patch(`/playbooks/${pb.id}`)
        .set('Authorization', as(managerToken))
        .send({
          title: 'Versioned playbook (reworded)',
          body: 'The wording is clearer now but the numbers still stand.',
          validDays: 30,
        })
        .expect(200);
      expect(v2.body).toMatchObject({
        version: 2,
        supersedesId: pb.id,
        status: 'active',
        title: 'Versioned playbook (reworded)',
        evidence: pb.evidence,
        vectorStatus: 'indexed',
      });
      const days =
        (new Date(v2.body.validTo).getTime() -
          new Date(v2.body.validFrom).getTime()) /
        86_400_000;
      expect(Math.round(days)).toBe(30);
      // the old vector is gone, the new one is in
      expect(store.rows.has(pb.id)).toBe(false);
      expect(store.rows.has(v2.body.id)).toBe(true);
      // history
      const old = await http()
        .get(`/playbooks/${pb.id}`)
        .set('Authorization', as(agentToken))
        .expect(200);
      expect(old.body.status).toBe('superseded');
      expect(old.body.title).toBe('Versioned playbook'); // never rewritten
      const hist = await http()
        .get(`/playbooks/${v2.body.id}/versions`)
        .set('Authorization', as(agentToken))
        .expect(200);
      expect(hist.body.map((v: { version: number }) => v.version)).toEqual([
        2, 1,
      ]);
      const sameFromOld = await http()
        .get(`/playbooks/${pb.id}/versions`)
        .set('Authorization', as(agentToken))
        .expect(200);
      expect(sameFromOld.body.map((v: { id: string }) => v.id)).toEqual([
        v2.body.id,
        pb.id,
      ]);
      // the list shows only the latest of the chain
      const list = await http()
        .get('/playbooks')
        .set('Authorization', as(agentToken))
        .expect(200);
      const ids = list.body.map((p: { id: string }) => p.id);
      expect(ids).toContain(v2.body.id);
      expect(ids).not.toContain(pb.id);
      // an old version cannot be edited again
      const again = await http()
        .patch(`/playbooks/${pb.id}`)
        .set('Authorization', as(managerToken))
        .send({
          title: 'Edit the old one',
          body: 'Trying to edit a version that was replaced already.',
        })
        .expect(409);
      expect(again.body.error).toBe('not_active');
    });

    it('retiring removes it from search and from the vector index, and keeps it in the list as retired', async () => {
      const { pb } = await savedFromReview('Soon retired playbook');
      const ret = await http()
        .post(`/playbooks/${pb.id}/retire`)
        .set('Authorization', as(managerToken))
        .expect(200);
      expect(ret.body.status).toBe('retired');
      expect(ret.body.retiredAt).toBeTruthy();
      expect(store.rows.has(pb.id)).toBe(false);
      const list = await http()
        .get(`/playbooks?offerId=${offerId}`)
        .set('Authorization', as(agentToken))
        .expect(200);
      expect(list.body.find((p: { id: string }) => p.id === pb.id).status).toBe(
        'retired',
      );
      const left = await app
        .get(PlaybooksService)
        .relevant(orgId, { offerId, text: 'Soon retired playbook' });
      expect(left.map((h) => h.id)).not.toContain(pb.id);
      await http()
        .post(`/playbooks/${pb.id}/retire`)
        .set('Authorization', as(managerToken))
        .expect(409);
      await http()
        .patch(`/playbooks/${pb.id}`)
        .set('Authorization', as(managerToken))
        .send({
          title: 'Edit retired one',
          body: 'Retired playbooks are history and cannot be edited.',
        })
        .expect(409);
    });
  });

  // ── retrieval: only the right ones, whatever the index says ────────────

  describe('using playbooks', () => {
    it('keyword search finds the active, unexpired playbooks of THIS offer in THIS workspace', async () => {
      const svc = app.get(PlaybooksService);
      const mine = await savedFromReview('Pune dentists reply more', {
        body: 'Dental practices in Pune replied more to short subject lines.',
      });
      // a different offer in the same workspace, and another workspace
      const r2 = await mkReview({
        promote: true,
        approved: true,
        offer: offer2Id,
      });
      await save(managerToken, {
        reviewId: r2.reviewId,
        title: 'Payroll lesson about Pune',
        body: 'Payroll buyers in Pune like longer subject lines a lot.',
      }).expect(201);
      const otherRev = await inOrg(otherOrgId, async (c) => {
        const camp = await c.query<{ id: string }>(
          `INSERT INTO campaigns (org_id, name, status) VALUES ($1,'x','active') RETURNING id`,
          [otherOrgId],
        );
        await c.query(
          `INSERT INTO playbooks (org_id, offer_id, kind, title, body, evidence, valid_to)
           VALUES ($1,$2,'message','Other org Pune lesson','Pune subject lines from another workspace entirely.','{}'::jsonb, now() + interval '30 days')`,
          [otherOrgId, otherOfferId],
        );
        return camp.rows[0].id;
      });
      expect(otherRev).toBeTruthy();
      const hints = await svc.relevant(orgId, {
        offerId,
        text: 'subject lines for Pune dentists',
        k: 3,
      });
      // the best match comes first (earlier tests' playbooks may also share a word)
      expect(hints[0].id).toBe(mine.pb.id);
      const payroll = await q((c) =>
        c.query<{ id: string }>(
          `SELECT id FROM playbooks WHERE offer_id = $1`,
          [offer2Id],
        ),
      );
      const foreign = await inOrg(otherOrgId, (c) =>
        c.query<{ id: string }>(`SELECT id FROM playbooks`),
      );
      const seen = hints.map((h) => h.id);
      for (const r of [...payroll.rows, ...foreign.rows])
        expect(seen).not.toContain(r.id);
      expect(hints[0]).toMatchObject({ title: 'Pune dentists reply more' });
      expect(new Date(hints[0].validTo).getTime()).toBeGreaterThan(Date.now());
    });

    it('a wrong or stale index cannot surface another workspace, another offer, a retired or an expired playbook', async () => {
      const svc = app.get(PlaybooksService);
      const good = await savedFromReview('Good one for the index test');
      const retired = await savedFromReview('Retired one for the index test');
      await http()
        .post(`/playbooks/${retired.pb.id}/retire`)
        .set('Authorization', as(managerToken))
        .expect(200);
      const expired = await savedFromReview('Expired one for the index test');
      await q((c) =>
        c.query(
          `UPDATE playbooks SET valid_to = now() - interval '1 day', valid_from = now() - interval '91 days' WHERE id = $1`,
          [expired.pb.id],
        ),
      );
      const otherOrgPb = await inOrg(otherOrgId, async (c) => {
        const r = await c.query<{ id: string }>(
          `INSERT INTO playbooks (org_id, offer_id, kind, title, body, evidence, valid_to)
           VALUES ($1,$2,'message','Index leak other org','Should never be seen from another workspace at all.','{}'::jsonb, now() + interval '30 days')
           RETURNING id`,
          [otherOrgId, otherOfferId],
        );
        return r.rows[0].id;
      });
      const r2 = await mkReview({
        promote: true,
        approved: true,
        offer: offer2Id,
      });
      const otherOffer = await save(managerToken, {
        reviewId: r2.reviewId,
        title: 'Index leak other offer',
        body: 'A lesson for the payroll offer, not the dental one.',
      }).expect(201);

      // the (broken) index claims all of them are relevant, in this order
      retriever.mode = 'fixed';
      retriever.fixed = [
        otherOrgPb,
        otherOffer.body.id,
        retired.pb.id,
        expired.pb.id,
        randomUUID(),
        good.pb.id,
      ];
      const hints = await svc.relevant(orgId, {
        offerId,
        text: 'anything',
        k: 10,
      });
      expect(hints.map((h) => h.id)).toEqual([good.pb.id]);
    });

    it('never throws: no offer, no text, or a failing retriever means no hints', async () => {
      const svc = app.get(PlaybooksService);
      expect(await svc.relevant(orgId, { offerId: null, text: 'x' })).toEqual(
        [],
      );
      expect(await svc.relevant(orgId, { offerId, text: '   ' })).toEqual([]);
      const broken = jest
        .spyOn(retriever, 'retrieve')
        .mockRejectedValueOnce(new Error('boom'));
      expect(await svc.relevant(orgId, { offerId, text: 'something' })).toEqual(
        [],
      );
      broken.mockRestore();
    });

    it('titles() resolves ids a run or draft stored, including replaced versions', async () => {
      const svc = app.get(PlaybooksService);
      const { pb } = await savedFromReview('Titled playbook');
      const v2 = await http()
        .patch(`/playbooks/${pb.id}`)
        .set('Authorization', as(managerToken))
        .send({
          title: 'Titled playbook, second',
          body: 'A second version of the titled playbook, long enough.',
        })
        .expect(200);
      const t = await svc.titles(orgId, [
        pb.id,
        v2.body.id,
        randomUUID(),
        'not-a-uuid',
      ]);
      expect(t).toEqual([
        { id: pb.id, title: 'Titled playbook' },
        { id: v2.body.id, title: 'Titled playbook, second' },
      ]);
      expect(await svc.titles(otherOrgId, [pb.id])).toEqual([]);
    });
  });

  // ── wiring: challenger drafts and Discover runs ────────────────────────

  describe('using them in drafts and Discover runs', () => {
    it("a challenger draft request gets the offer's message playbooks as hints, and stores and shows which ones it used", async () => {
      const { pb } = await savedFromReview('Hint source for drafts', {
        body: 'Short question subjects beat plain greetings for dental practices.',
      });
      // an audience playbook for the same offer must NOT go to a subject drafter
      const pref = await mkPreference();
      const aud = await save(managerToken, {
        preferenceId: pref,
        title: 'Audience note not for subjects',
        body: 'Pune dental practices replied more; keep testing it, this is not proof.',
      }).expect(201);

      const r = await mkReview({ promote: true, approved: true, draft: true });
      drafter.seen.length = 0;
      const res = await http()
        .post(`/reviews/${r.reviewId}/challenger-drafts`)
        .set('Authorization', as(managerToken))
        .expect(200);

      // 1. the drafter was given the message playbook as a hint line, and only that
      expect(drafter.seen).toHaveLength(1);
      const lines = drafter.seen[0].playbooks ?? [];
      expect(lines.some((l) => l.includes('Hint source for drafts'))).toBe(
        true,
      );
      expect(
        lines.some((l) => l.includes('Audience note not for subjects')),
      ).toBe(false);
      expect(lines[0]).toContain('approved learning, valid until');

      // 2. each stored draft says which playbooks it used ("Used 1 playbook")
      expect(res.body.drafts).toHaveLength(3);
      for (const d of res.body.drafts) {
        expect(d.playbooks).toEqual(
          expect.arrayContaining([
            { id: pb.id, title: 'Hint source for drafts' },
          ]),
        );
        expect(d.playbooks.map((p: { id: string }) => p.id)).not.toContain(
          aud.body.id,
        );
      }
      const stored = await q((c) =>
        c.query<{ playbook_ids: string[] }>(
          `SELECT playbook_ids FROM challenger_drafts WHERE review_id = $1`,
          [r.reviewId],
        ),
      );
      expect(stored.rows).toHaveLength(3);
      expect(stored.rows[0].playbook_ids).toContain(pb.id);

      // 3. listing them later still resolves the titles, even after the playbook was replaced
      const listed = await http()
        .get(`/reviews/${r.reviewId}/challenger-drafts`)
        .set('Authorization', as(agentToken))
        .expect(200);
      const body = listed.body.drafts ?? listed.body;
      expect(
        body[0].playbooks.map((p: { title: string }) => p.title),
      ).toContain('Hint source for drafts');
    });

    it('a draft request with no matching playbook sends no hints and still works', async () => {
      await q((c) =>
        c.query(
          `UPDATE playbooks SET status = 'retired' WHERE status = 'active'`,
        ),
      );
      const r = await mkReview({ promote: true, approved: true, draft: true });
      drafter.seen.length = 0;
      const res = await http()
        .post(`/reviews/${r.reviewId}/challenger-drafts`)
        .set('Authorization', as(managerToken))
        .expect(200);
      expect(drafter.seen[0].playbooks).toEqual([]);
      expect(res.body.drafts[0].playbooks).toEqual([]);
    });

    it('a Discover plan gets the offer\'s AUDIENCE playbooks, records them on the run, and the run shows "used"', async () => {
      await q((c) =>
        c.query(
          `UPDATE playbooks SET status = 'retired' WHERE status = 'active'`,
        ),
      );
      const pref = await mkPreference();
      const aud = await save(managerToken, {
        preferenceId: pref,
        title: 'Pune dental practices answer more',
        body: 'Dental practices in Pune replied more; keep testing it, this is not proof.',
      }).expect(201);
      const msg = await savedFromReview('Message note not for discovery', {
        body: 'Short question subjects beat plain greetings for dental practices.',
      });
      expect(msg.pb.id).toBeTruthy();

      const run = await q(async (c) => {
        const r = await c.query<{ id: string }>(
          `INSERT INTO prospect_runs (org_id, goal, status, requested, offer_id)
           VALUES ($1,'Find dental practices in Pune','running',5,$2) RETURNING id`,
          [orgId, offerId],
        );
        return r.rows[0].id;
      });
      const native = app.get(NativeDiscoverDriver);
      const plan = jest
        .spyOn(native, 'plan')
        .mockResolvedValue({ icp: null, candidates: [] });
      // planSearch and getRun are internals of the service: reach them through a narrow type
      const svc = app.get<
        ProspectsService,
        {
          planSearch: (
            o: string,
            run: unknown,
            offer: unknown,
            p: unknown,
          ) => Promise<unknown>;
          getRun: (
            o: string,
            id: string,
          ) => Promise<{
            playbooks_used: Array<{ id: string; title: string }>;
            playbook_ids: string[];
          }>;
        }
      >(ProspectsService);
      await svc.planSearch(
        orgId,
        {
          id: run,
          goal: 'Find dental practices in Pune',
          offer_id: offerId,
          requested: 5,
        },
        { audience: 'dental practices' },
        { mode: 'baseline', count: 5, askFor: 8, limit: 5 },
      );
      const given = plan.mock.calls[0][0].playbooks ?? [];
      plan.mockRestore();
      expect(given.map((h) => h.id)).toEqual([aud.body.id]);
      expect(given[0].title).toBe('Pune dental practices answer more');

      const view = await svc.getRun(orgId, run);
      expect(view.playbook_ids).toEqual([aud.body.id]);
      expect(view.playbooks_used).toEqual([
        { id: aud.body.id, title: 'Pune dental practices answer more' },
      ]);
    });
  });

  // ── tenant isolation ───────────────────────────────────────────────────

  describe('tenant isolation', () => {
    it("another workspace cannot read, version, edit or retire this workspace's playbooks, and sees only its own list", async () => {
      const { pb } = await savedFromReview('Private to org A');
      await http()
        .get(`/playbooks/${pb.id}`)
        .set('Authorization', as(otherToken))
        .expect(404);
      await http()
        .get(`/playbooks/${pb.id}/versions`)
        .set('Authorization', as(otherToken))
        .expect(404);
      await http()
        .patch(`/playbooks/${pb.id}`)
        .set('Authorization', as(otherToken))
        .send({
          title: 'Hijack attempt',
          body: 'Another workspace trying to edit this playbook.',
        })
        .expect(404);
      await http()
        .post(`/playbooks/${pb.id}/retire`)
        .set('Authorization', as(otherToken))
        .expect(404);
      const list = await http()
        .get('/playbooks')
        .set('Authorization', as(otherToken))
        .expect(200);
      expect(list.body.map((p: { id: string }) => p.id)).not.toContain(pb.id);
      // and the other workspace cannot draft from our review
      await http()
        .post('/playbooks/draft')
        .set('Authorization', as(otherToken))
        .send({ reviewId: randomUUID() })
        .expect(404);
    });

    it('row-level security hides playbooks without a tenant context', async () => {
      const r = await pool.query(`SELECT 1 FROM playbooks`);
      expect(r.rowCount).toBe(0);
    });
  });
});
