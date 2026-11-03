import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { NotificationsService } from '../notifications/notifications.service';
import { AiService } from '../ai/ai.service';
import {
  classifyReply,
  OrgKnowledge,
  REPLY_CLASSES,
  ReplyClass,
} from '../ai/prompts';
import { PG_POOL } from '../db/db.module';
import { withOrgContext } from '../db/tenant-context';
import { RealtimeService } from '../realtime/realtime.service';
import { SendersService } from '../senders/senders.service';

export interface IngestReplyInput {
  fromEmail: string;
  subject?: string;
  body: string;
  messageId?: string;
  inReplyTo?: string; // Message-ID of the email being answered, when known
  // Caller-supplied classification (manual tools / tests). When absent the
  // reply is classified by the AI layer.
  classification?: ReplyClass;
}

export type ReplyAction = 'stopped' | 'rescheduled' | 'none';

const CLASS_LABELS: Record<ReplyClass, string> = {
  interested: 'Interested',
  not_interested: 'Not interested',
  question: 'Question',
  out_of_office: 'Out of office',
  wrong_person: 'Wrong person',
  manual_review: 'Needs review',
};

export interface ConversationPatch {
  unread?: boolean;
  status?: string;
  classification?: string;
  assignedUserId?: string | null;
  converted?: boolean;
}

export interface IngestResult {
  conversationId: string;
  classification: ReplyClass;
  confidence: number;
  action: ReplyAction;
}

export interface InboxFilter {
  filter?: string; // 'all' | 'unread' | a reply class
  status?: string; // 'open' | 'closed'
  q?: string;
}

export interface ConversationListRow {
  id: string;
  subject: string;
  status: string;
  unread: boolean;
  classification: string | null;
  confidence: number | null;
  last_message_at: Date;
  lead_id: string;
  lead_email: string;
  lead_company: string | null;
  lead_name: string | null;
  campaign_name: string | null;
  snippet: string | null;
}

export interface ThreadRow {
  direction: 'inbound' | 'outbound';
  subject: string;
  body_text: string | null;
  from_email: string | null;
  to_email: string | null;
  created_at: Date;
  classification: string | null;
  confidence: number | null;
}

interface MatchedSend {
  sent_email_id: string | null;
  campaign_id: string | null;
  campaign_lead_id: string | null;
  sender_id: string | null;
  lead_id: string;
  subject: string;
}

// Unified inbox (E7). `ingestReply` is the single entry point for inbound
// replies: the creds-gated SES-inbound / Gmail pollers (E5 chunk 3) call it,
// and so does the dev simulate endpoint. It threads the reply, classifies it,
// and applies the sequence automations (stop-on-reply, out-of-office
// reschedule, not-interested tagging).
@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly ai: AiService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly senders: SendersService,
  ) {}

  /**
   * Manual reply to the lead (T7.3). Sends from the conversation's sender
   * (else the workspace's first sender), threaded with In-Reply-To /
   * References so it lands in the same thread in the lead's mail client.
   * Network call happens outside any transaction; the message is recorded
   * only if the provider accepted it.
   */
  async reply(orgId: string, userId: string, id: string, body: string) {
    const text = body.trim();
    if (!text) throw new BadRequestException('Reply is empty');

    const ctx = await withOrgContext(this.pool, orgId, async (c) => {
      const conv = await c.query<{
        subject: string;
        sender_id: string | null;
        lead_email: string | null;
        lead_id: string;
      }>(
        `SELECT cv.subject, cv.sender_id, l.email AS lead_email, cv.lead_id
         FROM conversations cv JOIN leads l ON l.id = cv.lead_id
         WHERE cv.id = $1`,
        [id],
      );
      const cv = conv.rows[0];
      if (!cv) throw new NotFoundException('Conversation not found');
      if (!cv.lead_email)
        throw new BadRequestException('This lead has no email address');
      const sender = await c.query<{ id: string; signature: string | null }>(
        `SELECT id, signature FROM sender_accounts
         WHERE ($1::uuid IS NULL OR id = $1)
         ORDER BY (id = $1) DESC NULLS LAST, created_at
         LIMIT 1`,
        [cv.sender_id],
      );
      if (!sender.rows[0]) {
        throw new BadRequestException(
          'Connect a sender account before replying',
        );
      }
      const last = await c.query<{ message_id: string | null }>(
        `SELECT message_id FROM conversation_messages
         WHERE conversation_id = $1 AND message_id IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`,
        [id],
      );
      return {
        cv,
        sender: sender.rows[0],
        inReplyTo: last.rows[0]?.message_id ?? null,
      };
    });

    const subject = /^re:/i.test(ctx.cv.subject)
      ? ctx.cv.subject
      : `Re: ${ctx.cv.subject || '(no subject)'}`;
    const fullText = ctx.sender.signature
      ? `${text}\n\n${ctx.sender.signature}`
      : text;
    const html = fullText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    const headers: Record<string, string> = {};
    if (ctx.inReplyTo) {
      headers['In-Reply-To'] = ctx.inReplyTo;
      headers['References'] = ctx.inReplyTo;
    }

    const sent = await this.senders.sendMessage(orgId, ctx.sender.id, {
      to: ctx.cv.lead_email!,
      subject,
      text: fullText,
      html,
      headers,
    });

    const message = await withOrgContext(this.pool, orgId, async (c) => {
      const m = await c.query<{ id: string; created_at: string }>(
        `INSERT INTO conversation_messages
           (org_id, conversation_id, direction, from_email, to_email, subject, body_text, message_id, in_reply_to)
         VALUES ($1, $2, 'outbound', $3, $4, $5, $6, $7, $8)
         RETURNING id, created_at`,
        [
          orgId,
          id,
          sent.from,
          ctx.cv.lead_email,
          subject,
          fullText,
          sent.messageId,
          ctx.inReplyTo,
        ],
      );
      await c.query(
        `UPDATE conversations SET last_message_at = now(), unread = false
         WHERE id = $1`,
        [id],
      );
      await c.query(
        `INSERT INTO lead_events (org_id, lead_id, type, data) VALUES ($1, $2, 'reply_sent', $3::jsonb)`,
        [
          orgId,
          ctx.cv.lead_id,
          JSON.stringify({ conversation_id: id, by: userId }),
        ],
      );
      return m.rows[0];
    });
    this.realtime.toOrg(orgId, { type: 'inbox', id });
    return { ...message, subject, messageId: sent.messageId };
  }

  async ingestReply(
    orgId: string,
    input: IngestReplyInput,
  ): Promise<IngestResult> {
    // Phase 1: match the reply to the email it answers + load KB (short tx).
    const { match, kb } = await withOrgContext(this.pool, orgId, async (c) => {
      let m: MatchedSend | undefined;
      const cols = `id AS sent_email_id, campaign_id, campaign_lead_id,
        sender_id, lead_id, subject`;
      if (input.inReplyTo) {
        const r = await c.query<MatchedSend>(
          `SELECT ${cols} FROM sent_emails
           WHERE message_id = $1 AND lead_id IS NOT NULL LIMIT 1`,
          [input.inReplyTo],
        );
        m = r.rows[0];
      }
      if (!m) {
        const r = await c.query<MatchedSend>(
          `SELECT ${cols} FROM sent_emails
           WHERE lower(to_email) = lower($1) AND lead_id IS NOT NULL
           ORDER BY sent_at DESC LIMIT 1`,
          [input.fromEmail],
        );
        m = r.rows[0];
      }
      if (!m) {
        // No prior send — still thread it if the sender is a known lead.
        const l = await c.query<{ id: string }>(
          `SELECT id FROM leads WHERE lower(email) = lower($1) LIMIT 1`,
          [input.fromEmail],
        );
        if (l.rowCount === 0) {
          throw new NotFoundException('Reply sender is not a known lead');
        }
        m = {
          sent_email_id: null,
          campaign_id: null,
          campaign_lead_id: null,
          sender_id: null,
          lead_id: l.rows[0].id,
          subject: input.subject ?? '',
        };
      }
      const k = await c.query<OrgKnowledge>(
        `SELECT description, audience, offer, pain_points AS "painPoints",
           usps, competitors, testimonials
         FROM org_knowledge WHERE org_id = $1`,
        [orgId],
      );
      return { match: m, kb: k.rows[0] ?? null };
    });

    // Phase 2: classify outside any transaction (may be a network call).
    const { classification, confidence } = input.classification
      ? { classification: input.classification, confidence: 1 }
      : await this.classify(orgId, input, kb);

    // Phase 3: thread + record + automations.
    const result = await withOrgContext(this.pool, orgId, async (c) => {
      const existing = await c.query<{ id: string }>(
        `SELECT id FROM conversations
         WHERE lead_id = $1 AND campaign_id IS NOT DISTINCT FROM $2
         ORDER BY created_at LIMIT 1`,
        [match.lead_id, match.campaign_id],
      );
      let conversationId = existing.rows[0]?.id;
      if (!conversationId) {
        const created = await c.query<{ id: string }>(
          `INSERT INTO conversations
             (org_id, lead_id, campaign_id, campaign_lead_id, sender_id, subject)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [
            orgId,
            match.lead_id,
            match.campaign_id,
            match.campaign_lead_id,
            match.sender_id,
            input.subject || match.subject,
          ],
        );
        conversationId = created.rows[0].id;
      }

      await c.query(
        `INSERT INTO conversation_messages
           (org_id, conversation_id, direction, from_email, subject, body_text,
            message_id, in_reply_to, classification, confidence)
         VALUES ($1,$2,'inbound',$3,$4,$5,$6,$7,$8,$9)`,
        [
          orgId,
          conversationId,
          input.fromEmail,
          input.subject ?? '',
          input.body,
          input.messageId ?? null,
          input.inReplyTo ?? null,
          classification,
          confidence,
        ],
      );
      await c.query(
        `UPDATE conversations
         SET unread = true, status = 'open', classification = $2,
             confidence = $3, last_message_at = now()
         WHERE id = $1`,
        [conversationId, classification, confidence],
      );

      await c.query(
        `INSERT INTO email_events (org_id, sent_email_id, campaign_id, lead_id, type, data)
         VALUES ($1,$2,$3,$4,'reply',$5::jsonb)`,
        [
          orgId,
          match.sent_email_id,
          match.campaign_id,
          match.lead_id,
          JSON.stringify({ classification }),
        ],
      );
      await c.query(
        `INSERT INTO lead_events (org_id, lead_id, type, data)
         VALUES ($1,$2,'email_replied',$3::jsonb)`,
        [orgId, match.lead_id, JSON.stringify({ classification })],
      );

      const action = await this.applyAutomations(
        c,
        orgId,
        match,
        classification,
      );

      // Advance the lead's pipeline status, but never overwrite a later stage
      // (interested/converted/lost) with an earlier one.
      const nextStatus =
        classification === 'interested'
          ? 'interested'
          : classification === 'not_interested'
            ? 'lost'
            : 'replied';
      const lead = await c.query<{ label: string }>(
        `UPDATE leads SET status = CASE
             WHEN status IN ('new','contacted','replied') THEN $2 ELSE status END,
           updated_at = now()
         WHERE id = $1
         RETURNING COALESCE(NULLIF(trim(concat_ws(' ', first_name, last_name)), ''), email) AS label`,
        [match.lead_id, nextStatus],
      );

      await this.notifications.notifyOrg(c, orgId, {
        type: 'reply',
        title: `${lead.rows[0]?.label ?? input.fromEmail} replied`,
        body: `${CLASS_LABELS[classification]} · ${input.body.slice(0, 120)}`,
        link: `/inbox?c=${conversationId}`,
      });

      return { conversationId, classification, confidence, action };
    });
    // after commit, so clients that refetch immediately see the reply
    this.realtime.toOrg(orgId, { type: 'inbox', id: result.conversationId });
    this.realtime.toOrg(orgId, { type: 'notifications' });
    return result;
  }

  private async classify(
    orgId: string,
    input: IngestReplyInput,
    kb: OrgKnowledge | null,
  ): Promise<{ classification: ReplyClass; confidence: number }> {
    try {
      const res = await this.ai.generate(
        orgId,
        'reply-classify',
        classifyReply({ replyBody: input.body, subject: input.subject, kb }),
      );
      const parsed = JSON.parse(res.text) as {
        classification?: string;
        confidence?: number;
      };
      const cls = REPLY_CLASSES.find((k) => k === parsed.classification);
      if (!cls) return { classification: 'manual_review', confidence: 0 };
      const conf =
        typeof parsed.confidence === 'number'
          ? Math.min(1, Math.max(0, parsed.confidence))
          : 0;
      return { classification: cls, confidence: conf };
    } catch (err) {
      this.logger.warn(
        `reply classification failed; routing to manual review: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { classification: 'manual_review', confidence: 0 };
    }
  }

  // Sequence automations (T5.8 + T6.5). Out-of-office keeps the lead enrolled
  // and pushes the next step out 3 days; any other reply stops the sequence.
  // Not-interested replies also get a "Not interested" tag.
  private async applyAutomations(
    c: import('pg').PoolClient,
    orgId: string,
    match: MatchedSend,
    classification: ReplyClass,
  ): Promise<ReplyAction> {
    if (classification === 'not_interested') {
      const tag = await c.query<{ id: string }>(
        `INSERT INTO tags (org_id, name, color) VALUES ($1, 'Not interested', '#6b7280')
         ON CONFLICT (org_id, lower(name)) DO UPDATE SET name = tags.name
         RETURNING id`,
        [orgId],
      );
      await c.query(
        `INSERT INTO lead_tags (org_id, lead_id, tag_id) VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING`,
        [orgId, match.lead_id, tag.rows[0].id],
      );
    }

    if (!match.campaign_lead_id) return 'none';

    if (classification === 'out_of_office') {
      const r = await c.query(
        `UPDATE campaign_leads
         SET next_send_at = now() + interval '3 days', updated_at = now()
         WHERE id = $1 AND status = 'active'`,
        [match.campaign_lead_id],
      );
      return (r.rowCount ?? 0) > 0 ? 'rescheduled' : 'none';
    }

    const r = await c.query(
      `UPDATE campaign_leads
       SET status = 'stopped', stop_reason = 'replied', next_send_at = NULL,
           updated_at = now()
       WHERE id = $1 AND status = 'active'`,
      [match.campaign_lead_id],
    );
    return (r.rowCount ?? 0) > 0 ? 'stopped' : 'none';
  }

  // ── read side ────────────────────────────────────────────────────────
  list(orgId: string, f: InboxFilter) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (f.status === 'open' || f.status === 'closed')
      add('c.status = ?', f.status);
    if (f.filter === 'unread') where.push('c.unread');
    else if (
      f.filter &&
      (REPLY_CLASSES as readonly string[]).includes(f.filter)
    ) {
      add('c.classification = ?', f.filter);
    }
    if (f.q?.trim()) {
      add(
        `(l.email ILIKE ? OR l.first_name ILIKE $${params.length + 1}
          OR l.last_name ILIKE $${params.length + 1} OR l.company ILIKE $${params.length + 1}
          OR c.subject ILIKE $${params.length + 1})`,
        `%${f.q.trim()}%`,
      );
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    return withOrgContext(this.pool, orgId, async (c) => {
      const res = await c.query<ConversationListRow>(
        `SELECT c.id, c.subject, c.status, c.unread, c.classification,
           c.confidence, c.last_message_at,
           l.id AS lead_id, l.email AS lead_email, l.company AS lead_company,
           NULLIF(trim(concat_ws(' ', l.first_name, l.last_name)), '') AS lead_name,
           cp.name AS campaign_name,
           (SELECT left(m.body_text, 140) FROM conversation_messages m
             WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS snippet
         FROM conversations c
         JOIN leads l ON l.id = c.lead_id
         LEFT JOIN campaigns cp ON cp.id = c.campaign_id
         ${whereSql}
         ORDER BY c.last_message_at DESC
         LIMIT 200`,
        params,
      );
      return res.rows;
    });
  }

  unreadCount(orgId: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const r = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM conversations
         WHERE unread AND status = 'open'`,
      );
      return { unread: r.rows[0].n };
    });
  }

  // Conversation + merged thread (outbound from sent_emails, inbound from
  // conversation_messages) + lead context for the side panel.
  get(orgId: string, id: string) {
    return withOrgContext(this.pool, orgId, async (c) => {
      const conv = await c.query<{
        id: string;
        lead_id: string;
        campaign_id: string | null;
        campaign_lead_id: string | null;
      }>(
        `SELECT c.*, cp.name AS campaign_name, s.from_email AS sender_email
         FROM conversations c
         LEFT JOIN campaigns cp ON cp.id = c.campaign_id
         LEFT JOIN sender_accounts s ON s.id = c.sender_id
         WHERE c.id = $1`,
        [id],
      );
      if (conv.rowCount === 0) {
        throw new NotFoundException('Conversation not found');
      }
      const cv = conv.rows[0];

      const outbound = await c.query<ThreadRow>(
        `SELECT 'outbound' AS direction, se.subject, NULL AS body_text,
           s.from_email, se.to_email, se.sent_at AS created_at,
           NULL AS classification, NULL::real AS confidence
         FROM sent_emails se
         LEFT JOIN sender_accounts s ON s.id = se.sender_id
         WHERE se.lead_id = $1 AND se.campaign_id IS NOT DISTINCT FROM $2
           AND se.status = 'sent'`,
        [cv.lead_id, cv.campaign_id],
      );
      const inbound = await c.query<ThreadRow>(
        `SELECT direction, subject, body_text, from_email, to_email, created_at,
           classification, confidence
         FROM conversation_messages WHERE conversation_id = $1`,
        [id],
      );
      const thread = [...outbound.rows, ...inbound.rows].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );

      const lead = await c.query<{
        id: string;
        email: string;
        first_name: string | null;
        last_name: string | null;
        company: string | null;
        title: string | null;
        phone: string | null;
        status: string;
        score: string | null;
      }>(
        `SELECT id, email, first_name, last_name, company, title, phone,
           status, score
         FROM leads WHERE id = $1`,
        [cv.lead_id],
      );
      const tags = await c.query<{ name: string; color: string }>(
        `SELECT t.name, t.color FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id
         WHERE lt.lead_id = $1 ORDER BY t.name`,
        [cv.lead_id],
      );
      const enrollment = cv.campaign_lead_id
        ? await c.query<{
            status: string;
            stop_reason: string | null;
            current_step: number;
            next_send_at: Date | null;
          }>(
            `SELECT status, stop_reason, current_step, next_send_at
             FROM campaign_leads WHERE id = $1`,
            [cv.campaign_lead_id],
          )
        : null;
      const notes = await c.query<{
        id: string;
        body: string;
        created_at: Date;
        author_name: string | null;
      }>(
        `SELECT n.id, n.body, n.created_at, u.name AS author_name
         FROM conversation_notes n LEFT JOIN users u ON u.id = n.author_user_id
         WHERE n.conversation_id = $1 ORDER BY n.created_at`,
        [id],
      );

      return {
        ...cv,
        thread,
        notes: notes.rows,
        lead: lead.rows[0] ?? null,
        tags: tags.rows,
        enrollment: enrollment?.rows[0] ?? null,
      };
    });
  }

  // Internal team note (never sent to the lead).
  async addNote(orgId: string, userId: string, id: string, body: string) {
    const note = await withOrgContext(this.pool, orgId, async (c) => {
      const conv = await c.query(`SELECT 1 FROM conversations WHERE id = $1`, [
        id,
      ]);
      if (conv.rowCount === 0) {
        throw new NotFoundException('Conversation not found');
      }
      const r = await c.query<{ id: string; body: string; created_at: Date }>(
        `INSERT INTO conversation_notes (org_id, conversation_id, author_user_id, body)
         VALUES ($1,$2,$3,$4) RETURNING id, body, created_at`,
        [orgId, id, userId, body.trim()],
      );
      return r.rows[0];
    });
    this.realtime.toOrg(orgId, { type: 'inbox', id });
    return note;
  }

  async update(
    orgId: string,
    id: string,
    patch: ConversationPatch,
    actorUserId?: string,
  ) {
    // Assignment + conversion have side effects; handle them in one tx first.
    if (patch.assignedUserId !== undefined || patch.converted !== undefined) {
      await withOrgContext(this.pool, orgId, async (c) => {
        const conv = await c.query<{
          lead_id: string;
          campaign_lead_id: string | null;
          subject: string;
        }>(
          `SELECT lead_id, campaign_lead_id, subject FROM conversations WHERE id = $1`,
          [id],
        );
        if (conv.rowCount === 0) {
          throw new NotFoundException('Conversation not found');
        }
        const cv = conv.rows[0];

        if (patch.assignedUserId !== undefined) {
          if (patch.assignedUserId) {
            // membership rows are RLS-scoped, so this proves same-org
            const m = await c.query(
              `SELECT 1 FROM memberships WHERE user_id = $1`,
              [patch.assignedUserId],
            );
            if (m.rowCount === 0) {
              throw new BadRequestException('Assignee is not a member');
            }
          }
          await c.query(
            `UPDATE conversations SET assigned_user_id = $2 WHERE id = $1`,
            [id, patch.assignedUserId],
          );
          if (patch.assignedUserId && patch.assignedUserId !== actorUserId) {
            await this.notifications.notifyUser(
              c,
              orgId,
              patch.assignedUserId,
              {
                type: 'assigned',
                title: 'A conversation was assigned to you',
                body: cv.subject,
                link: `/inbox?c=${id}`,
              },
            );
          }
        }

        if (patch.converted !== undefined) {
          await c.query(
            `UPDATE conversations SET converted_at = CASE WHEN $2 THEN now() ELSE NULL END
             WHERE id = $1`,
            [id, patch.converted],
          );
          if (patch.converted) {
            await c.query(
              `UPDATE leads SET status = 'converted', updated_at = now() WHERE id = $1`,
              [cv.lead_id],
            );
            if (cv.campaign_lead_id) {
              await c.query(
                `UPDATE campaign_leads SET status = 'stopped', stop_reason = 'converted',
                   next_send_at = NULL, updated_at = now()
                 WHERE id = $1 AND status = 'active'`,
                [cv.campaign_lead_id],
              );
            }
            await c.query(
              `INSERT INTO lead_events (org_id, lead_id, type, data)
               VALUES ($1,$2,'converted',$3::jsonb)`,
              [orgId, cv.lead_id, JSON.stringify({ conversation_id: id })],
            );
          }
        }
      });
    }
    const updated = await this.updateFields(orgId, id, patch);
    this.realtime.toOrg(orgId, { type: 'inbox', id });
    if (patch.assignedUserId) {
      this.realtime.toUser(patch.assignedUserId, { type: 'notifications' });
    }
    return updated;
  }

  private updateFields(orgId: string, id: string, patch: ConversationPatch) {
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (patch.unread !== undefined) add('unread', patch.unread);
    if (patch.status !== undefined) add('status', patch.status);
    if (patch.classification !== undefined) {
      add('classification', patch.classification);
      sets.push('confidence = 1'); // a human override is certain
    }
    return withOrgContext(this.pool, orgId, async (c) => {
      if (sets.length > 0) {
        params.push(id);
        const r = await c.query(
          `UPDATE conversations SET ${sets.join(', ')}
           WHERE id = $${params.length}`,
          params,
        );
        if (r.rowCount === 0) {
          throw new NotFoundException('Conversation not found');
        }
      }
      const res = await c.query<{
        id: string;
        status: string;
        unread: boolean;
        classification: string | null;
        confidence: number | null;
        assigned_user_id: string | null;
        converted_at: Date | null;
      }>(
        `SELECT id, status, unread, classification, confidence,
           assigned_user_id, converted_at
         FROM conversations WHERE id = $1`,
        [id],
      );
      if (res.rowCount === 0)
        throw new NotFoundException('Conversation not found');
      return res.rows[0];
    });
  }
}
