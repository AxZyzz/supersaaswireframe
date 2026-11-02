"use client";

import { useEffect, useState } from "react";
import { BookOpen, Check } from "lucide-react";
import { getKnowledge, OrgKnowledge, saveKnowledge } from "@/lib/ai";
import { HelpLink } from "@/components/help-link";

const FIELDS: { key: keyof OrgKnowledge; label: string; placeholder: string }[] =
  [
    {
      key: "description",
      label: "Business",
      placeholder: "What your company does, in a sentence or two.",
    },
    {
      key: "audience",
      label: "Target audience",
      placeholder: "Who you sell to — roles, industries, company size.",
    },
    {
      key: "offer",
      label: "Offer",
      placeholder: "The specific product/service and its value.",
    },
    {
      key: "painPoints",
      label: "Customer pain points",
      placeholder: "The problems your offer solves.",
    },
    {
      key: "usps",
      label: "Unique selling points",
      placeholder: "Why you, not a competitor.",
    },
    {
      key: "competitors",
      label: "Competitors",
      placeholder: "Who you're up against.",
    },
    {
      key: "testimonials",
      label: "Testimonials / proof",
      placeholder: "Results, logos, quotes worth citing.",
    },
  ];

export function KnowledgeSection({ readOnly = false }: { readOnly?: boolean } = {}) {
  const [kb, setKb] = useState<OrgKnowledge>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setKb((await getKnowledge()) ?? {});
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    setSaving(true);
    try {
      await saveKnowledge(kb);
    } finally {
      setSaving(false);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  const field =
    "w-full rounded border border-line-mid bg-white px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft2";

  return (
    <section className="rounded-lg border border-line bg-white p-5">
      <div className="mb-1 flex items-center gap-2">
        <BookOpen size={16} className="text-faint" />
        <h2 className="text-section font-semibold text-ink2">Knowledge base</h2>
        <HelpLink slug="ai-builder" />
      </div>
      <p className="mb-4 text-sm text-muted">
        Business context the AI uses to ground every generated email. Fill in what
        you can — more detail means more relevant copy.
      </p>

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="space-y-3">
          {FIELDS.map(({ key, label, placeholder }) => (
            <label key={key} className="block space-y-1">
              <span className="text-tiny font-medium uppercase tracking-wide text-faint">
                {label}
              </span>
              <textarea
                value={kb[key] ?? ""}
                onChange={(e) => setKb((p) => ({ ...p, [key]: e.target.value }))}
                placeholder={placeholder}
                rows={2}
                disabled={readOnly}
                className={`${field} disabled:bg-panel disabled:text-muted`}
              />
            </label>
          ))}
          {!readOnly && (
          <button
            onClick={() => void save()}
            disabled={saving}
            className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {saved ? <Check size={15} /> : null}
            {saved ? "Saved" : saving ? "Saving…" : "Save knowledge base"}
          </button>
          )}
        </div>
      )}
    </section>
  );
}
