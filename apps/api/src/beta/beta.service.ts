import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';

export type SignupMode = 'open' | 'waitlist';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface WaitlistRow {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  use_case: string | null;
  status: 'pending' | 'approved' | 'joined';
  created_at: string;
  approved_at: string | null;
  joined_at: string | null;
}

/**
 * Beta launch (T10.7). With SIGNUP_MODE=waitlist, sign-up needs an invite
 * code an operator issued for that exact email; everyone else joins the
 * waitlist. Codes are random, single-use, stored only as a hash.
 */
@Injectable()
export class BetaService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  // Read per call (ConfigModule has already loaded .env into process.env), so
  // flipping SIGNUP_MODE takes effect on restart without code changes.
  mode(): SignupMode {
    return process.env.SIGNUP_MODE === 'waitlist' ? 'waitlist' : 'open';
  }

  /** Same response whether or not the email is already listed — no probing. */
  async join(input: {
    email: string;
    name?: string;
    company?: string;
    useCase?: string;
  }) {
    await this.pool.query(
      `INSERT INTO waitlist (email, name, company, use_case)
       VALUES (lower($1), $2, $3, $4)
       ON CONFLICT (lower(email)) DO NOTHING`,
      [
        input.email.trim(),
        input.name?.trim() || null,
        input.company?.trim() || null,
        input.useCase?.trim() || null,
      ],
    );
    return { ok: true };
  }

  async list() {
    const r = await this.pool.query<WaitlistRow>(
      `SELECT id, email, name, company, use_case, status, created_at, approved_at, joined_at
       FROM waitlist ORDER BY (status = 'pending') DESC, created_at DESC LIMIT 500`,
    );
    return r.rows;
  }

  /** Issues (or re-issues) the invite code. Returned once — send the link. */
  async approve(id: string) {
    const code = randomBytes(24).toString('base64url');
    const r = await this.pool.query<{ email: string; status: string }>(
      `UPDATE waitlist SET status = 'approved', invite_code_hash = $2,
              approved_at = COALESCE(approved_at, now())
       WHERE id = $1 AND status <> 'joined'
       RETURNING email, status`,
      [id, sha256(code)],
    );
    if (!r.rowCount)
      throw new NotFoundException('Waitlist entry not found or already joined');
    return { id, email: r.rows[0].email, code };
  }

  /** Called by signup in waitlist mode, before the account is created. */
  async assertInvite(email: string, code: string | undefined) {
    if (this.mode() !== 'waitlist') return;
    if (!code) {
      throw new ForbiddenException(
        'Sign-up is invite-only during the beta. Join the waitlist and we will send you an invite.',
      );
    }
    const r = await this.pool.query(
      `SELECT 1 FROM waitlist
       WHERE invite_code_hash = $1 AND lower(email) = lower($2) AND status = 'approved'`,
      [sha256(code), email.trim()],
    );
    if (!r.rowCount) {
      throw new ForbiddenException(
        'This invite link is invalid, already used, or for a different email.',
      );
    }
  }

  async markJoined(email: string) {
    await this.pool.query(
      `UPDATE waitlist SET status = 'joined', joined_at = now(), invite_code_hash = NULL
       WHERE lower(email) = lower($1) AND status = 'approved'`,
      [email.trim()],
    );
  }

  // ── feedback ──

  submitFeedback(
    orgId: string,
    userId: string,
    input: { kind: string; message: string; page?: string },
  ) {
    if (!input.message.trim())
      throw new BadRequestException('Feedback is empty');
    return withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO feedback (org_id, user_id, kind, message, page)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [orgId, userId, input.kind, input.message.trim(), input.page ?? null],
      );
      return { id: r.rows[0].id };
    });
  }

  async allFeedback(limit = 100) {
    const r = await this.pool.query(`SELECT * FROM operator_feedback($1)`, [
      limit,
    ]);
    return r.rows as Record<string, unknown>[];
  }
}
