import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { MembershipCache } from './membership-cache.service';
import { seedDefaultTags } from '../leads/default-tags';
import { seedDefaultTemplates } from '../templates/default-templates';
import type {
  AccessTokenPayload,
  RefreshTokenPayload,
  Role,
  TokenPair,
} from './types';

const BCRYPT_ROUNDS = 12;
const REFRESH_TTL_DAYS = 30;
// Window in which re-presenting a just-rotated refresh token is treated as a
// concurrent-refresh race rather than token theft.
const REUSE_GRACE_MS = 30_000;
// Valid real hash so unknown-email logins burn a full cost-12 compare —
// a malformed fallback would short-circuit and leak email existence via timing.
const DUMMY_HASH = bcrypt.hashSync('supersaas-timing-dummy', BCRYPT_ROUNDS);

export interface MembershipInfo {
  orgId: string;
  orgName: string;
  role: Role;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly memberships: MembershipCache,
  ) {}

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private async issueTokens(
    userId: string,
    orgId: string,
    role: Role,
  ): Promise<TokenPair> {
    const jti = randomUUID();
    const accessPayload: AccessTokenPayload = {
      sub: userId,
      orgId,
      role,
      type: 'access',
    };
    const refreshPayload: RefreshTokenPayload = {
      sub: userId,
      jti,
      type: 'refresh',
    };
    const accessToken = await this.jwt.signAsync(accessPayload, {
      expiresIn: this.config.get('JWT_ACCESS_TTL', '15m'),
    });
    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: this.config.get(
        'JWT_REFRESH_SECRET',
        'dev-refresh-secret-change-me',
      ),
      expiresIn: `${REFRESH_TTL_DAYS}d`,
    });
    const expiresAt = new Date(
      Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    await this.pool.query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [jti, userId, this.hashToken(refreshToken), expiresAt],
    );
    return { accessToken, refreshToken };
  }

  async signup(input: {
    email: string;
    password: string;
    name: string;
    orgName: string;
  }) {
    const { id: userId, email } = await this.createUser(input);

    const orgId = randomUUID();
    const slug = this.slugify(input.orgName, orgId);
    await withOrgContext(this.pool, orgId, async (c) => {
      await c.query(`INSERT INTO orgs (id, name, slug) VALUES ($1, $2, $3)`, [
        orgId,
        input.orgName.trim(),
        slug,
      ]);
      await c.query(
        `INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'admin')`,
        [orgId, userId],
      );
      await seedDefaultTags(c, orgId);
      await seedDefaultTemplates(c, orgId);
    });

    const tokens = await this.issueTokens(userId, orgId, 'admin');
    return {
      user: { id: userId, email, name: input.name.trim() },
      org: { id: orgId, name: input.orgName.trim(), slug },
      ...tokens,
    };
  }

  /** Insert a user (no membership). Shared by signup and invite registration. */
  async createUser(input: {
    email: string;
    password: string;
    name: string;
  }): Promise<{ id: string; email: string; name: string }> {
    const email = input.email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    const existing = await this.pool.query(
      `SELECT id FROM users WHERE email = $1`,
      [email],
    );
    if ((existing.rowCount ?? 0) > 0) {
      throw new ConflictException('Email already registered');
    }

    const userRes = await this.pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3) RETURNING id`,
      [email, passwordHash, input.name.trim()],
    );
    return { id: userRes.rows[0].id, email, name: input.name.trim() };
  }

  async login(email: string, password: string) {
    const normalized = email.trim().toLowerCase();
    const res = await this.pool.query<{
      id: string;
      password_hash: string;
      name: string;
    }>(`SELECT id, password_hash, name FROM users WHERE email = $1`, [
      normalized,
    ]);
    // Constant-shape failure: hash compare even on unknown email.
    const row = res.rows[0];
    const ok = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok) throw new UnauthorizedException('Invalid credentials');

    const memberships = await this.membershipsOf(row.id);
    if (memberships.length === 0) {
      throw new UnauthorizedException('No workspace membership');
    }
    const first = memberships[0];
    const tokens = await this.issueTokens(row.id, first.orgId, first.role);
    return {
      user: { id: row.id, email: normalized, name: row.name },
      memberships,
      activeOrgId: first.orgId,
      ...tokens,
    };
  }

  async refresh(rawToken: string): Promise<TokenPair> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(rawToken, {
        secret: this.config.get(
          'JWT_REFRESH_SECRET',
          'dev-refresh-secret-change-me',
        ),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Wrong token type');
    }

    const res = await this.pool.query<{
      id: string;
      user_id: string;
      token_hash: string;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT id, user_id, token_hash, expires_at, revoked_at
        FROM refresh_tokens WHERE id = $1`,
      [payload.jti],
    );
    const row = res.rows[0];
    const valid =
      row &&
      row.revoked_at === null &&
      row.expires_at.getTime() > Date.now() &&
      row.token_hash === this.hashToken(rawToken);
    if (!valid) {
      // A token rotated seconds ago is a benign race (two tabs, or parallel
      // requests refreshing at once): reject it, but don't treat it as theft.
      const justRotated =
        row?.revoked_at &&
        Date.now() - row.revoked_at.getTime() < REUSE_GRACE_MS &&
        row.token_hash === this.hashToken(rawToken);
      // Otherwise reuse of a rotated/revoked token → revoke the whole family.
      if (row && !justRotated) {
        await this.pool.query(
          `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
          [row.user_id],
        );
      }
      throw new UnauthorizedException('Refresh token no longer valid');
    }

    await this.pool.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`,
      [row.id],
    );

    const memberships = await this.membershipsOf(row.user_id);
    if (memberships.length === 0) {
      throw new UnauthorizedException('No workspace membership');
    }
    const first = memberships[0];
    return this.issueTokens(row.user_id, first.orgId, first.role);
  }

  async logout(rawToken: string): Promise<void> {
    try {
      const payload = await this.jwt.verifyAsync<RefreshTokenPayload>(
        rawToken,
        {
          secret: this.config.get(
            'JWT_REFRESH_SECRET',
            'dev-refresh-secret-change-me',
          ),
        },
      );
      await this.pool.query(
        `UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`,
        [payload.jti],
      );
    } catch {
      // Logout is idempotent; invalid token = nothing to revoke.
    }
  }

  async switchOrg(userId: string, orgId: string): Promise<TokenPair> {
    const memberships = await this.membershipsOf(userId);
    const target = memberships.find((m) => m.orgId === orgId);
    if (!target) throw new UnauthorizedException('Not a member of that org');
    return this.issueTokens(userId, target.orgId, target.role);
  }

  /**
   * GDPR erasure of the caller's own account (password re-check). Refused
   * while they're the only admin of a workspace that has other members —
   * hand over admin or delete the workspace first. Workspaces where they're
   * the sole member are deleted with them.
   */
  async deleteAccount(userId: string, password: string) {
    const u = await this.pool.query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [userId],
    );
    const ok = await bcrypt.compare(
      password,
      u.rows[0]?.password_hash ?? DUMMY_HASH,
    );
    if (!u.rows[0] || !ok) throw new UnauthorizedException('Wrong password');

    const soloOrgs: string[] = [];
    for (const m of await this.membershipsOf(userId)) {
      const counts = await withOrgContext(this.pool, m.orgId, async (c) => {
        const r = await c.query<{ members: number; admins: number }>(
          `SELECT count(*)::int AS members,
                  count(*) FILTER (WHERE role = 'admin')::int AS admins
           FROM memberships`,
        );
        return r.rows[0];
      });
      if (counts.members === 1) soloOrgs.push(m.orgId);
      else if (m.role === 'admin' && counts.admins === 1) {
        throw new BadRequestException(
          `You're the only admin of "${m.orgName}". Make someone else admin or delete that workspace first.`,
        );
      }
    }
    for (const orgId of soloOrgs) {
      await withOrgContext(this.pool, orgId, (c) =>
        c.query(`DELETE FROM orgs WHERE id = $1`, [orgId]),
      );
    }
    await this.pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    this.memberships.invalidate(userId); // live tokens stop working now
    return { deleted: true, workspacesDeleted: soloOrgs.length };
  }

  async membershipsOf(userId: string): Promise<MembershipInfo[]> {
    // Membership lookup must span orgs (pre-context), so it can't run under
    // RLS. SECURITY DEFINER function owned by the migration role does the
    // one controlled cross-tenant read.
    const res = await this.pool.query<{
      org_id: string;
      org_name: string;
      role: Role;
    }>(`SELECT org_id, org_name, role FROM user_memberships($1)`, [userId]);
    return res.rows.map((r) => ({
      orgId: r.org_id,
      orgName: r.org_name,
      role: r.role,
    }));
  }

  private slugify(name: string, uniquer: string): string {
    const base = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return `${base || 'org'}-${uniquer.slice(0, 8)}`;
  }
}
