/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import {
  INestApplication,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { OPERATOR_KEY } from '../operator/operator.guard';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { ROLES_KEY } from './decorators/roles.decorator';
import type { Role } from './types';

/**
 * Authorization matrix (T10.2). Discovers EVERY route from controller
 * metadata, so new endpoints are covered automatically:
 *  - only an explicit allow-list may be public;
 *  - every other route rejects anonymous calls (401);
 *  - each role gets 403 exactly where its role isn't allowed.
 * It also renders docs/AUTHZ-MATRIX.md and fails if that doc is stale
 * (regenerate with UPDATE_AUTHZ=1).
 */

const ROLES: Role[] = ['admin', 'manager', 'agent'];

// Intentionally unauthenticated. Adding to this list is a security decision.
const PUBLIC_ALLOWLIST = [
  'GET /',
  'GET /health/ready',
  'POST /auth/signup',
  'POST /auth/login',
  'POST /auth/refresh',
  'POST /auth/logout',
  'GET /t/o/:trackingId',
  'GET /t/c/:trackingId',
  'GET /u/:token',
  'POST /u/:token',
  'GET /invites/:token',
  'POST /invites/:token/register',
  'POST /v1/leads', // API-key guarded instead of JWT
  'GET /beta/mode',
  'POST /waitlist',
  'GET /auth/google/callback', // Google redirect; signed `state` names the workspace
];

interface RouteInfo {
  key: string; // "GET /leads/:id"
  method: string;
  path: string;
  isPublic: boolean;
  operator: boolean; // A2B staff only — forbidden to every workspace role
  roles: Role[] | null; // null = any authenticated member
}

function discover(app: INestApplication): RouteInfo[] {
  const discovery = app.get(DiscoveryService);
  const reflector = app.get(Reflector);
  const out: RouteInfo[] = [];
  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;
    const ctrlPaths = ([] as string[]).concat(
      Reflect.getMetadata(PATH_METADATA, metatype) ?? '',
    );
    const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as
        RequestMethod | undefined;
      if (method === undefined) continue;
      const handlerPaths = ([] as string[]).concat(
        Reflect.getMetadata(PATH_METADATA, handler) ?? '',
      );
      const targets = [handler, metatype];
      const isPublic = !!reflector.getAllAndOverride<boolean>(
        IS_PUBLIC_KEY,
        targets,
      );
      const roles = reflector.getAllAndOverride<Role[] | undefined>(
        ROLES_KEY,
        targets,
      );
      const operator = !!reflector.getAllAndOverride<boolean>(
        OPERATOR_KEY,
        targets,
      );
      for (const c of ctrlPaths) {
        for (const h of handlerPaths) {
          const path =
            '/' +
            [c, h]
              .map((p) => p.replace(/^\/+|\/+$/g, ''))
              .filter(Boolean)
              .join('/');
          const verb = RequestMethod[method];
          out.push({
            key: `${verb} ${path}`,
            method: verb,
            path,
            isPublic,
            operator,
            roles: roles?.length ? roles : null,
          });
        }
      }
    }
  }
  return out.sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
}

const allowedFor = (r: RouteInfo, role: Role) =>
  !r.operator && (!r.roles || r.roles.includes(role));

function renderMatrix(routes: RouteInfo[]): string {
  const cell = (r: RouteInfo, role: Role) =>
    r.isPublic ? '—' : allowedFor(r, role) ? '✅' : '⛔';
  const lines = [
    '# Authorization matrix',
    '',
    '> Generated from controller metadata by `apps/api/src/auth/authz-matrix.integration.spec.ts`.',
    '> Do not edit by hand — run the API tests with `UPDATE_AUTHZ=1` to regenerate.',
    '',
    '✅ allowed · ⛔ 403 Forbidden · — public (no login; API-key routes noted)',
    '`operator` = A2B staff console (users.is_operator), forbidden to every workspace role.',
    '',
    '',
    '| Route | Auth | Admin | Manager | Agent |',
    '|---|---|:-:|:-:|:-:|',
    ...routes.map(
      (r) =>
        `| \`${r.key}\` | ${r.isPublic ? (r.path.startsWith('/v1/') ? 'API key' : 'public') : r.operator ? 'operator' : 'login'} | ${cell(r, 'admin')} | ${cell(r, 'manager')} | ${cell(r, 'agent')} |`,
    ),
    '',
  ];
  return lines.join('\n');
}

// The sweeps make one request per route per role; well past Jest's 5s default.
jest.setTimeout(60_000);

describe('Authorization matrix', () => {
  let app: INestApplication;
  let pool: Pool;
  let routes: RouteInfo[];
  const tokens = {} as Record<Role, string>;
  let orgId: string;
  const userIds: string[] = [];

  const http = () => request(app.getHttpServer());
  const call = (r: RouteInfo, token?: string) => {
    const path = r.path.replace(/:[A-Za-z]+/g, () => randomUUID());
    const req = (
      http() as unknown as Record<string, (p: string) => request.Test>
    )[r.method.toLowerCase()](path);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return r.method === 'GET' || r.method === 'DELETE' ? req : req.send({});
  };

  beforeAll(async () => {
    process.env.THROTTLE_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
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
    routes = discover(app);

    // one workspace with one member per role
    const a = await http()
      .post('/auth/signup')
      .send({
        email: `authz-${randomUUID().slice(0, 8)}@test.local`,
        password: 'authz-pass-123',
        name: 'Authz Admin',
        orgName: 'Authz Org',
      })
      .expect(201);
    tokens.admin = a.body.accessToken;
    orgId = a.body.org.id;
    userIds.push(a.body.user.id);
    for (const role of ['manager', 'agent'] as const) {
      const inv = await http()
        .post('/orgs/invites')
        .set('Authorization', `Bearer ${tokens.admin}`)
        .send({
          email: `authz-${role}-${randomUUID().slice(0, 8)}@test.local`,
          role,
        })
        .expect(201);
      const reg = await http()
        .post(`/invites/${inv.body.token}/register`)
        .send({ name: `Authz ${role}`, password: 'authz-pass-123' })
        .expect(201);
      tokens[role] = reg.body.accessToken;
      userIds.push(reg.body.user.id);
    }
  });

  afterAll(async () => {
    delete process.env.THROTTLE_DISABLED;
    await withOrgContext(pool, orgId, (c) =>
      c.query(`DELETE FROM orgs WHERE id = $1`, [orgId]),
    );
    for (const id of userIds) {
      await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    }
    await app.close();
  });

  it('discovers the API surface', () => {
    expect(routes.length).toBeGreaterThan(60);
  });

  it('only allow-listed routes are public', () => {
    const publicRoutes = routes.filter((r) => r.isPublic).map((r) => r.key);
    expect(publicRoutes.sort()).toEqual([...PUBLIC_ALLOWLIST].sort());
  });

  it('every other route rejects anonymous requests', async () => {
    const leaks: string[] = [];
    for (const r of routes.filter((x) => !x.isPublic)) {
      const res = await call(r);
      if (res.status !== 401) leaks.push(`${r.key} → ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it('each role is forbidden exactly where it is not allowed', async () => {
    const wrong: string[] = [];
    for (const r of routes.filter((x) => !x.isPublic)) {
      for (const role of ROLES) {
        const allowed = allowedFor(r, role);
        const res = await call(r, tokens[role]);
        const forbidden = res.status === 403;
        if (allowed === forbidden) {
          wrong.push(
            `${role} ${r.key} → ${res.status} (expected ${allowed ? 'allowed' : '403'})`,
          );
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('docs/AUTHZ-MATRIX.md is up to date', () => {
    const file = resolve(__dirname, '../../../../docs/AUTHZ-MATRIX.md');
    const doc = renderMatrix(routes);
    if (process.env.UPDATE_AUTHZ === '1' || !existsSync(file)) {
      writeFileSync(file, doc);
    }
    expect(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).toBe(doc);
  });
});
