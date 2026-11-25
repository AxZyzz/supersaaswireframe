/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method -- the route limits are metadata on the handler function itself */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { InsightsController } from '../insights/insights.controller';
import { ReviewController } from '../review/review.controller';
import {
  ReviewService,
  SIMULATED_REVIEWS_KEPT,
} from '../review/review.service';
import { SearchPreferencesController } from '../search-preferences/search-preferences.controller';

jest.setTimeout(90_000);

// @nestjs/throttler stores a route's limit/ttl under these keys (+ the name).
const LIMIT = 'THROTTLER:LIMITdefault';
const TTL = 'THROTTLER:TTLdefault';
const limitOf = (handler: object) => [
  Reflect.getMetadata(LIMIT, handler) as number,
  Reflect.getMetadata(TTL, handler) as number,
];

/** Security review T18 (docs/SECURITY-REVIEW.md, addendum): the fixes, pinned. */
describe('Security review T18 fixes', () => {
  describe('finding 1 + 2: routes that store a row or can run BigQuery have their own rate limit', () => {
    it('POST /review/simulate: 10 per minute', () => {
      expect(limitOf(ReviewController.prototype.simulate)).toEqual([
        10, 60_000,
      ]);
    });
    it('GET /insights: 30 per minute', () => {
      expect(limitOf(InsightsController.prototype.get)).toEqual([30, 60_000]);
    });
    it('POST /search-preferences/propose: 20 per minute', () => {
      expect(limitOf(SearchPreferencesController.prototype.propose)).toEqual([
        20, 60_000,
      ]);
    });
  });

  describe('finding 1: "Try simulation" rows do not pile up', () => {
    let app: INestApplication;
    let pool: Pool;
    let orgA: string;
    let userA: string;
    let orgB: string;
    let userB: string;
    const http = () => request(app.getHttpServer());

    beforeAll(async () => {
      process.env.THROTTLE_DISABLED = 'true'; // sign-ups are rate limited too
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
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
      const mk = async (label: string) => {
        const r = await http()
          .post('/auth/signup')
          .send({
            email: `t18-${label}-${randomUUID().slice(0, 8)}@test.local`,
            password: 't18-password-123',
            name: `T18 ${label}`,
            orgName: `T18 Org ${label}`,
          })
          .expect(201);
        return { org: r.body.org.id as string, user: r.body.user.id as string };
      };
      ({ org: orgA, user: userA } = await mk('a'));
      ({ org: orgB, user: userB } = await mk('b'));
    });

    afterAll(async () => {
      delete process.env.THROTTLE_DISABLED;
      for (const o of [orgA, orgB]) {
        await withOrgContext(pool, o, (c) =>
          c.query(`DELETE FROM orgs WHERE id = $1`, [o]),
        );
      }
      for (const u of [userA, userB]) {
        await pool.query(`DELETE FROM users WHERE id = $1`, [u]);
      }
      await app.close();
    });

    const simulatedIds = (org: string) =>
      withOrgContext(pool, org, async (c) =>
        (
          await c.query<{ id: string }>(
            `SELECT id FROM reviews WHERE simulated ORDER BY computed_at, id`,
          )
        ).rows.map((r) => r.id),
      );

    it('keeps only the newest SIMULATED_REVIEWS_KEPT per workspace, and never touches another workspace', async () => {
      const review = app.get(ReviewService);
      // workspace B has 3 of its own
      for (let i = 0; i < 3; i++) {
        await review.simulate(orgB, userB, 'valid_winner');
      }
      const before = await simulatedIds(orgB);
      expect(before).toHaveLength(3);

      // workspace A presses "Try simulation" 25 times
      const made: string[] = [];
      for (let i = 0; i < SIMULATED_REVIEWS_KEPT + 5; i++) {
        const v = await review.simulate(orgA, userA, 'valid_winner');
        made.push(v.id);
        expect(v.simulated).toBe(true); // still labelled, still not real
      }

      const kept = await simulatedIds(orgA);
      expect(kept).toHaveLength(SIMULATED_REVIEWS_KEPT);
      // the NEWEST ones survive, the five oldest are gone
      expect(new Set(kept)).toEqual(new Set(made.slice(5)));
      for (const gone of made.slice(0, 5)) expect(kept).not.toContain(gone);

      // workspace B is untouched by A's cleanup
      expect(await simulatedIds(orgB)).toEqual(before);
    });

    it('the newest simulation can still be opened by id (the dialog keeps working)', async () => {
      const review = app.get(ReviewService);
      const v = await review.simulate(orgA, userA, 'inconclusive_small');
      const again = await review.get(orgA, v.id);
      expect(again.simulated).toBe(true);
      expect(again.id).toBe(v.id);
    });
  });
});
