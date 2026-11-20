"use client";

import { useEffect, useState } from "react";
import { Check, ClipboardCheck } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { toast } from "@/components/feedback";
import { getRubric, saveRubric } from "@/lib/outcomes";

/** Settings → Review: the workspace's definition of a "qualified" reply. */
export function ReviewRubricSection({ readOnly = false }: { readOnly?: boolean }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getRubric()
      .then((r) => setText(r.rubric))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      await saveRubric(text);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <div className="mb-1 flex items-center gap-2">
        <ClipboardCheck size={16} className="text-faint" />
        <h2 className="text-section font-semibold text-ink2">
          Review: what counts as qualified
        </h2>
      </div>
      <p className="mb-3 text-sm text-muted">
        The AI proposes which replies are qualified; a person confirms. This text is shown
        next to the Confirm buttons in the Inbox so everyone judges the same way.
      </p>
      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={2000}
            disabled={readOnly}
            className="w-full rounded border border-line-mid bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft2 disabled:bg-panel disabled:text-muted"
          />
          {!readOnly && (
            <button
              onClick={() => void save()}
              disabled={saving || text.trim().length < 10}
              className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {saved ? <Check size={15} /> : null}
              {saved ? "Saved" : saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
