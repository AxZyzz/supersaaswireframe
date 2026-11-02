"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Plus, Send, Trash2 } from "lucide-react";
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  listTemplates,
  renderSample,
  Template,
  TEMPLATE_VARS,
  testSendTemplate,
  updateTemplate,
} from "@/lib/templates";
import { listSenders, Sender } from "@/lib/senders";
import { canManage, useRole } from "@/lib/me";

type Draft = {
  id: string | null; // null = unsaved new template
  name: string;
  subject: string;
  bodyHtml: string;
};

const EMPTY: Draft = { id: null, name: "", subject: "", bodyHtml: "" };

export default function TemplatesPage() {
  const editable = canManage(useRole());
  const [templates, setTemplates] = useState<Template[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const [t, s] = await Promise.all([listTemplates(), listSenders()]);
    setTemplates(t);
    setSenders(s);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function select(t: Template) {
    setNote(null);
    setDraft({
      id: t.id,
      name: t.name,
      subject: t.subject,
      bodyHtml: t.body_html,
    });
  }

  async function save() {
    if (!draft.name.trim()) return;
    setSaving(true);
    const body = {
      name: draft.name.trim(),
      subject: draft.subject,
      bodyHtml: draft.bodyHtml,
    };
    const saved = draft.id
      ? await updateTemplate(draft.id, body)
      : await createTemplate(body);
    setSaving(false);
    setDraft({
      id: saved.id,
      name: saved.name,
      subject: saved.subject,
      bodyHtml: saved.body_html,
    });
    setNote({ ok: true, text: "Saved." });
    await load();
  }

  async function duplicate() {
    if (!draft.id) return;
    const copy = await duplicateTemplate(draft.id);
    select(copy);
    await load();
  }

  async function remove() {
    if (!draft.id) return;
    await deleteTemplate(draft.id);
    setDraft(EMPTY);
    await load();
  }

  async function testSend() {
    if (!draft.id) {
      setNote({ ok: false, text: "Save the template first." });
      return;
    }
    if (senders.length === 0) {
      setNote({ ok: false, text: "Add a sender account first (Settings)." });
      return;
    }
    const to = window.prompt("Send a test to:");
    if (!to) return;
    try {
      const r = await testSendTemplate(draft.id, senders[0].id, to);
      setNote({ ok: true, text: `Sent via ${r.provider} — id ${r.messageId}` });
    } catch {
      setNote({ ok: false, text: "Test send failed — verify the sender." });
    }
  }

  // insert a token at the end of subject or body
  function insertVar(v: string, field: "subject" | "bodyHtml") {
    setDraft((d) => ({ ...d, [field]: `${d[field]}{${v}}` }));
  }

  const previewSubject = useMemo(
    () => renderSample(draft.subject),
    [draft.subject],
  );
  const previewHtml = useMemo(
    () => renderSample(draft.bodyHtml),
    [draft.bodyHtml],
  );

  const field =
    "w-full rounded border border-line-mid bg-white px-2.5 py-1.5 text-sm outline-none focus:border-accent";

  return (
    <div className="mx-auto flex max-w-shell gap-4">
      {/* library */}
      <aside className="w-64 shrink-0 space-y-2">
        {editable ? (
          <button
            onClick={() => {
              setNote(null);
              setDraft(EMPTY);
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            <Plus size={15} /> New template
          </button>
        ) : (
          <p className="rounded border border-line bg-panel px-3 py-2 text-tiny text-muted">
            Templates are managed by admins and managers. You can browse and preview them.
          </p>
        )}
        <div className="overflow-hidden rounded-lg border border-line bg-white">
          {templates.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">
              No templates yet.
            </p>
          ) : (
            templates.map((t) => (
              <button
                key={t.id}
                onClick={() => select(t)}
                className={`block w-full border-b border-line px-3 py-2 text-left last:border-0 hover:bg-hover ${
                  draft.id === t.id ? "bg-accent-soft" : ""
                }`}
              >
                <div className="truncate text-sm font-medium text-ink">
                  {t.name}
                </div>
                <div className="truncate text-tiny text-muted">
                  {t.subject || "(no subject)"}
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* editor + preview */}
      <div className="flex-1 space-y-4">
        <div className="space-y-3 rounded-lg border border-line bg-white p-4">
          <div className="flex items-center gap-2">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Template name"
              className={`${field} font-medium`}
            />
            {editable && (
              <>
            <button
              onClick={() => void save()}
              disabled={saving || !draft.name.trim()}
              className="shrink-0 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => void duplicate()}
              disabled={!draft.id}
              title="Duplicate"
              className="shrink-0 rounded border border-line-mid p-1.5 text-faint hover:text-accent disabled:opacity-40"
            >
              <Copy size={15} />
            </button>
            <button
              onClick={() => void testSend()}
              title="Send test"
              className="shrink-0 rounded border border-line-mid p-1.5 text-faint hover:text-accent"
            >
              <Send size={15} />
            </button>
            <button
              onClick={() => void remove()}
              disabled={!draft.id}
              title="Delete"
              className="shrink-0 rounded border border-line-mid p-1.5 text-faint hover:text-danger-text disabled:opacity-40"
            >
              <Trash2 size={15} />
            </button>
              </>
            )}
          </div>

          {note && (
            <div
              className={`rounded border px-3 py-1.5 text-sm ${
                note.ok
                  ? "border-success-text/30 bg-success-bg text-success-text"
                  : "border-danger-text/30 bg-danger-bg text-danger-text"
              }`}
            >
              {note.text}
            </div>
          )}

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-tiny font-medium uppercase tracking-wide text-faint">
                Subject
              </label>
              <VarChips onPick={(v) => insertVar(v, "subject")} />
            </div>
            <input
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              placeholder="Quick question, {first_name|there}"
              className={field}
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-tiny font-medium uppercase tracking-wide text-faint">
                Body (HTML)
              </label>
              <VarChips onPick={(v) => insertVar(v, "bodyHtml")} />
            </div>
            <textarea
              value={draft.bodyHtml}
              onChange={(e) => setDraft({ ...draft, bodyHtml: e.target.value })}
              rows={12}
              placeholder="<p>Hi {first_name|there},</p>"
              className={`${field} font-mono text-xs`}
            />
          </div>
        </div>

        {/* live preview (sample data) */}
        <div className="rounded-lg border border-line bg-white p-4">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-ink2">Preview</h3>
            <span className="text-tiny text-muted">
              sample data — Alex Rivera @ Acme Corp
            </span>
          </div>
          <div className="rounded border border-line bg-panel p-3">
            <div className="mb-2 border-b border-line pb-2 text-sm">
              <span className="text-faint">Subject: </span>
              <span className="font-medium text-ink">
                {previewSubject || "(no subject)"}
              </span>
            </div>
            <div
              className="prose-sm max-w-none text-sm text-ink"
              dangerouslySetInnerHTML={{
                __html: previewHtml || "<p class='text-muted'>(empty body)</p>",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function VarChips({ onPick }: { onPick: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {TEMPLATE_VARS.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onPick(v)}
          className="rounded bg-panel px-1.5 py-0.5 text-tiny text-muted hover:bg-accent-soft hover:text-accent"
        >
          {`{${v}}`}
        </button>
      ))}
    </div>
  );
}
