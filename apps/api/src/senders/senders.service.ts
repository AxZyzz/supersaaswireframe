import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseError, Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import type { CreateSenderDto, UpdateSenderDto } from './sender.dto';

const COLS = `id, provider, from_name, from_email, reply_to, signature,
  daily_limit, send_window_start, send_window_end, status, created_at, updated_at`;

export interface SenderRow {
  id: string;
  provider: 'ses' | 'gmail' | 'smtp';
  from_name: string;
  from_email: string;
  reply_to: string | null;
  signature: string | null;
  daily_limit: number;
  send_window_start: number | null;
  send_window_end: number | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class SendersService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  list(orgId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query<SenderRow>(
        `SELECT ${COLS} FROM sender_accounts ORDER BY created_at DESC`,
      );
      return res.rows;
    });
  }

  create(orgId: string, dto: CreateSenderDto) {
    return withOrgContext(this.pool, orgId, async (c) => {
      try {
        const res = await c.query<SenderRow>(
          `INSERT INTO sender_accounts
             (org_id, provider, from_name, from_email, reply_to, signature,
              daily_limit, send_window_start, send_window_end)
           VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,50),$8,$9)
           RETURNING ${COLS}`,
          [
            orgId,
            dto.provider,
            dto.fromName.trim(),
            dto.fromEmail.trim().toLowerCase(),
            dto.replyTo ?? null,
            dto.signature ?? null,
            dto.dailyLimit ?? null,
            dto.sendWindowStart ?? null,
            dto.sendWindowEnd ?? null,
          ],
        );
        return res.rows[0];
      } catch (err) {
        if (err instanceof DatabaseError && err.code === '23505') {
          throw new ConflictException(
            'A sender with that email already exists',
          );
        }
        throw err;
      }
    });
  }

  async update(orgId: string, id: string, dto: UpdateSenderDto) {
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (dto.fromName !== undefined) add('from_name', dto.fromName.trim());
    if (dto.replyTo !== undefined) add('reply_to', dto.replyTo);
    if (dto.signature !== undefined) add('signature', dto.signature);
    if (dto.dailyLimit !== undefined) add('daily_limit', dto.dailyLimit);
    if (dto.sendWindowStart !== undefined)
      add('send_window_start', dto.sendWindowStart);
    if (dto.sendWindowEnd !== undefined)
      add('send_window_end', dto.sendWindowEnd);
    if (sets.length === 0) return this.get(orgId, id);
    sets.push('updated_at = now()');
    params.push(id);
    return withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query<SenderRow>(
        `UPDATE sender_accounts SET ${sets.join(', ')} WHERE id = $${params.length}
         RETURNING ${COLS}`,
        params,
      );
      if (res.rowCount === 0) throw new NotFoundException('Sender not found');
      return res.rows[0];
    });
  }

  get(orgId: string, id: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query<SenderRow>(
        `SELECT ${COLS} FROM sender_accounts WHERE id = $1`,
        [id],
      );
      if (res.rowCount === 0) throw new NotFoundException('Sender not found');
      return res.rows[0];
    });
  }

  async remove(orgId: string, id: string) {
    const affected = await withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query(`DELETE FROM sender_accounts WHERE id = $1`, [
        id,
      ]);
      return res.rowCount ?? 0;
    });
    if (affected === 0) throw new NotFoundException('Sender not found');
    return { deleted: true };
  }
}
