import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { Pool, PoolClient } from 'pg';
import { AuthService } from '../auth/auth.service';
import { MembershipCache } from '../auth/membership-cache.service';
import type { Role } from '../auth/types';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { NotificationsService } from '../notifications/notifications.service';

const INVITE_TTL_DAYS = 7;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export interface MemberRow {
  user_id: string;
  role: Role;
  name: string;
  email: string;
  created_at: string;
}

export interface InviteRow {
  id: string;
  email: string;
  role: Role;
  expires_at: string;
  created_at: string;
  invited_by_name: string | null;
}

export interface InvitePreview {
  orgName: string;
  email: string;
  role: Role;
  status: 'pending' | 'expired' | 'accepted';
}

interface ResolvedInvite {
  id: string;
  org_id: string;
  org_name: string;
  email: string;
  role: Role;
  expires_at: Date;
  accepted_at: Date | null;
}

const sha256 = (raw: string) => createHash('sha256').update(raw).digest('hex');

@Injectable()
export class TeamService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly auth: AuthService,
    private readonly memberships: MembershipCache,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Members ────────────────────────────────────────────────────────────

  members(orgId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      // users is a global table; membership rows are RLS-scoped to this org,
      // so the join can only ever surface this org's members.
      const r = await c.query<MemberRow>(
        `SELECT m.user_id, m.role, u.name, u.email, m.created_at
         FROM memberships m JOIN users u ON u.id = m.user_id
         ORDER BY m.created_at`,
      );
      return r.rows;
    });
  }

  async changeRole(orgId: string, userId: string, role: Role) {
    await withOrgContext(this.pool, orgId, async (c) => {
      const current = await this.lockMember(c, userId);
      if (current === role) return;
      if (current === 'admin') await this.assertNotLastAdmin(c);
      await c.query(
        `UPDATE memberships SET role = $2, updated_at = now() WHERE user_id = $1`,
        [userId, role],
      );
    });
    this.memberships.invalidate(userId);
    return { userId, role };
  }

  async removeMember(orgId: string, userId: string) {
    await withOrgContext(this.pool, orgId, async (c) => {
      const current = await this.lockMember(c, userId);
      if (current === 'admin') await this.assertNotLastAdmin(c);
      await c.query(`DELETE FROM memberships WHERE user_id = $1`, [userId]);
      // their inbox assignments go back to the shared queue
      await c.query(
        `UPDATE conversations SET assigned_user_id = NULL WHERE assigned_user_id = $1`,
        [userId],
      );
    });
    this.memberships.invalidate(userId);
    return { removed: userId };
  }

  private async lockMember(c: PoolClient, userId: string): Promise<Role> {
    const r = await c.query<{ role: Role }>(
      `SELECT role FROM memberships WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    if (!r.rows[0]) throw new NotFoundException('Member not found');
    return r.rows[0].role;
  }

  /** Every workspace keeps at least one admin. Locks the admin rows so two
   *  concurrent demotions can't both pass the check. */
  private async assertNotLastAdmin(c: PoolClient) {
    const r = await c.query(
      `SELECT id FROM memberships WHERE role = 'admin' FOR UPDATE`,
    );
    if ((r.rowCount ?? 0) <= 1) {
      throw new BadRequestException('A workspace needs at least one admin');
    }
  }

  // ── Invites (admin side) ───────────────────────────────────────────────

  invites(orgId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query<InviteRow>(
        `SELECT i.id, i.email, i.role, i.expires_at, i.created_at,
                u.name AS invited_by_name
         FROM invites i LEFT JOIN users u ON u.id = i.invited_by
         WHERE i.accepted_at IS NULL AND i.expires_at > now()
         ORDER BY i.created_at DESC`,
      );
      return r.rows;
    });
  }

  /** Creates (or re-issues) the invite and returns the raw token once —
   *  only its hash is stored, so a lost link means re-inviting. */
  createInvite(orgId: string, invitedBy: string, email: string, role: Role) {
    const normalized = email.trim().toLowerCase();
    const token = randomBytes(32).toString('base64url');
    return withOrgContext(this.pool, orgId, async (c) => {
      const member = await c.query(
        `SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE lower(u.email) = $1`,
        [normalized],
      );
      if (member.rowCount) {
        throw new ConflictException('Already a member of this workspace');
      }
      // re-inviting replaces the old pending link
      await c.query(
        `DELETE FROM invites WHERE lower(email) = $1 AND accepted_at IS NULL`,
        [normalized],
      );
      const r = await c.query<InviteRow>(
        `INSERT INTO invites (org_id, email, role, token_hash, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
         RETURNING id, email, role, expires_at, created_at`,
        [orgId, normalized, role, sha256(token), invitedBy, INVITE_TTL_DAYS],
      );
      return { ...r.rows[0], token };
    });
  }

  async revokeInvite(orgId: string, id: string) {
    const n = await withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query(
        `DELETE FROM invites WHERE id = $1 AND accepted_at IS NULL`,
        [id],
      );
      return r.rowCount ?? 0;
    });
    if (!n) throw new NotFoundException('Invite not found');
    return { revoked: id };
  }

  // ── Invites (invitee side) ─────────────────────────────────────────────

  private async resolve(token: string): Promise<ResolvedInvite> {
    if (!TOKEN_RE.test(token)) throw new NotFoundException('Invite not found');
    const r = await this.pool.query<ResolvedInvite>(
      `SELECT * FROM resolve_invite($1)`,
      [sha256(token)],
    );
    if (!r.rows[0]) throw new NotFoundException('Invite not found');
    return r.rows[0];
  }

  async preview(token: string): Promise<InvitePreview> {
    const inv = await this.resolve(token);
    return {
      orgName: inv.org_name,
      email: inv.email,
      role: inv.role,
      status: inv.accepted_at
        ? 'accepted'
        : inv.expires_at.getTime() <= Date.now()
          ? 'expired'
          : 'pending',
    };
  }

  /** Signed-in user accepts; the invite is bound to their email. */
  async accept(token: string, userId: string) {
    const inv = await this.resolve(token);
    const u = await this.pool.query<{ email: string }>(
      `SELECT email FROM users WHERE id = $1`,
      [userId],
    );
    if (u.rows[0]?.email.toLowerCase() !== inv.email.toLowerCase()) {
      throw new ForbiddenException(
        `This invite is for ${inv.email}. Sign in with that account to accept.`,
      );
    }
    await this.join(inv, userId);
    return this.auth.switchOrg(userId, inv.org_id);
  }

  /** New user: create the account with the invited email, then join. */
  async register(token: string, name: string, password: string) {
    const inv = await this.resolve(token);
    this.assertUsable(inv);
    const exists = await this.pool.query(
      `SELECT 1 FROM users WHERE lower(email) = lower($1)`,
      [inv.email],
    );
    if (exists.rowCount) {
      throw new ConflictException(
        'An account with this email already exists — sign in to accept.',
      );
    }
    const user = await this.auth.createUser({
      email: inv.email,
      password,
      name,
    });
    await this.join(inv, user.id);
    const tokens = await this.auth.switchOrg(user.id, inv.org_id);
    return { user, org: { id: inv.org_id, name: inv.org_name }, ...tokens };
  }

  private assertUsable(inv: ResolvedInvite) {
    if (inv.accepted_at) throw new GoneException('Invite already used');
    if (inv.expires_at.getTime() <= Date.now()) {
      throw new GoneException('Invite expired — ask for a new one');
    }
  }

  /** Atomic under the invite's org context: lock, re-check, add membership,
   *  consume the invite. Re-checking after the lock closes double-accept. */
  private async join(inv: ResolvedInvite, userId: string) {
    await withOrgContext(this.pool, inv.org_id, async (c) => {
      const r = await c.query<{
        accepted_at: Date | null;
        expires_at: Date;
      }>(
        `SELECT accepted_at, expires_at FROM invites WHERE id = $1 FOR UPDATE`,
        [inv.id],
      );
      if (!r.rows[0]) throw new NotFoundException('Invite not found');
      this.assertUsable({ ...inv, ...r.rows[0] });
      // tell the existing team — before the insert, so the newcomer isn't
      // notified about themselves
      await this.notifications.notifyOrg(c, inv.org_id, {
        type: 'member_joined',
        title: `${inv.email} joined the workspace`,
        body: `Role: ${inv.role}`,
        link: '/settings#team',
      });
      await c.query(
        `INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (org_id, user_id) DO NOTHING`,
        [inv.org_id, userId, inv.role],
      );
      await c.query(
        `UPDATE invites SET accepted_at = now(), accepted_by = $2 WHERE id = $1`,
        [inv.id, userId],
      );
    });
    this.memberships.invalidate(userId);
  }
}
