import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseError, Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { CryptoService } from '../crypto/crypto.service';
import { withOrgContext } from '../db/tenant-context';
import {
  DecryptedSenderConfig,
  ProviderResolver,
} from './providers/provider.resolver';
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

// Shape of the encrypted-at-rest config jsonb. Secrets never leave here in
// plaintext: the SMTP password is stored as `passEnc` (AES-256-GCM).
interface StoredConfig {
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    passEnc: string;
  };
}

@Injectable()
export class SendersService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly crypto: CryptoService,
    private readonly resolver: ProviderResolver,
  ) {}

  list(orgId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query<SenderRow>(
        `SELECT ${COLS} FROM sender_accounts ORDER BY created_at DESC`,
      );
      return res.rows;
    });
  }

  create(orgId: string, dto: CreateSenderDto) {
    const config: StoredConfig = {};
    if (dto.provider === 'smtp' && dto.smtp) {
      config.smtp = {
        host: dto.smtp.host,
        port: dto.smtp.port,
        secure: dto.smtp.secure,
        user: dto.smtp.user,
        passEnc: this.crypto.encrypt(dto.smtp.pass),
      };
    }
    const configJson = Object.keys(config).length
      ? JSON.stringify(config)
      : null;
    return withOrgContext(this.pool, orgId, async (c) => {
      try {
        const res = await c.query<SenderRow>(
          `INSERT INTO sender_accounts
             (org_id, provider, from_name, from_email, reply_to, signature,
              daily_limit, send_window_start, send_window_end, config)
           VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,50),$8,$9,COALESCE($10,'{}')::jsonb)
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
            configJson,
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

  // Runs the provider's connection/auth check and flips status
  // unverified <-> verified. No email is sent.
  async verify(orgId: string, id: string) {
    const { sender, config } = await this.loadForSend(orgId, id);
    const provider = this.resolver.resolve(sender, config);
    const result = await provider.verify();
    const status = result.ok ? 'verified' : 'unverified';
    await withOrgContext(this.pool, orgId, (c) =>
      c.query(
        `UPDATE sender_accounts SET status = $2, updated_at = now() WHERE id = $1`,
        [id, status],
      ),
    );
    return { ok: result.ok, status, detail: result.detail };
  }

  // Render-agnostic send used by other features (templates test-send, and the
  // E5 sending engine): resolve the sender's provider and deliver a prepared
  // message. Secrets stay inside the service.
  async sendMessage(
    orgId: string,
    senderId: string,
    msg: {
      to: string;
      subject: string;
      html?: string;
      text?: string;
      headers?: Record<string, string>;
    },
  ) {
    const { sender, config } = await this.loadForSend(orgId, senderId);
    const provider = this.resolver.resolve(sender, config);
    const res = await provider.send(msg);
    return {
      messageId: res.messageId,
      provider: res.provider,
      from: sender.from_email,
    };
  }

  // Sends a real test message through the sender's provider to `to`.
  async testSend(orgId: string, id: string, to: string) {
    const { sender, config } = await this.loadForSend(orgId, id);
    const provider = this.resolver.resolve(sender, config);
    const res = await provider.send({
      to,
      subject: 'SuperSaaS test email',
      text: `This is a test send from sender ${sender.from_email}.`,
      html: `<p>This is a test send from <strong>${sender.from_email}</strong>.</p>`,
    });
    return { sent: true, messageId: res.messageId, provider: res.provider };
  }

  // Loads the row WITH its config column and decrypts secrets. Never exposed to
  // controllers directly — decrypted secrets stay inside the service.
  private async loadForSend(orgId: string, id: string) {
    const row = await withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query<SenderRow & { config: StoredConfig }>(
        `SELECT ${COLS}, config FROM sender_accounts WHERE id = $1`,
        [id],
      );
      if (res.rowCount === 0) throw new NotFoundException('Sender not found');
      return res.rows[0];
    });
    const { config: stored, ...sender } = row;
    return { sender, config: this.decryptConfig(stored) };
  }

  private decryptConfig(stored: StoredConfig): DecryptedSenderConfig {
    if (stored?.smtp) {
      return {
        smtp: {
          host: stored.smtp.host,
          port: stored.smtp.port,
          secure: stored.smtp.secure,
          user: stored.smtp.user,
          pass: this.crypto.decrypt(stored.smtp.passEnc),
        },
      };
    }
    return {};
  }
}
