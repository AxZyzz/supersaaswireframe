"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { LeadTag, listTags } from "@/lib/leads";
import { Condition, createSegment, RULE_FIELDS } from "@/lib/segments";

export function SegmentCreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"manual" | "smart">("smart");
  const [match, setMatch] = useState<"all" | "any">("all");
  const [conditions, setConditions] = useState<Condition[]>([
    { field: "score", op: "eq", value: "hot" },
  ]);
  const [tags, setTags] = useState<LeadTag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listTags().then(setTags).catch(() => {});
  }, []);

  function setCond(i: number, patch: Partial<Condition>) {
    setConditions((cs) =>
      cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    );
  }
  function changeField(i: number, field: string) {
    const meta = RULE_FIELDS[field];
    const op = meta.ops[0].op;
    const value =
      meta.value === "score"
        ? "hot"
        : meta.value === "number"
          ? 30
          : meta.value === "tag"
            ? (tags[0]?.id ?? "")
            : meta.value === "none"
              ? undefined
              : "";
    setCond(i, { field, op, value });
  }

  async function submit() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createSegment({
        name: name.trim(),
        type,
        rules: type === "smart" ? { match, conditions } : undefined,
      });
      onCreated();
      onClose();
    } catch {
      setError("Could not create. Check the name isn't taken and rules valid.");
      setBusy(false);
    }
  }

  const field =
    "rounded border border-line-mid bg-white px-2 py-1 text-sm outline-none focus:border-accent";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-line bg-white shadow-float">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-section font-semibold text-ink2">New segment</h2>
          <button onClick={onClose} className="text-faint hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Segment name"
            className={`${field} w-full`}
          />
          <div className="flex gap-2">
            {(["smart", "manual"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`flex-1 rounded border px-3 py-1.5 text-sm capitalize ${
                  type === t
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line-mid text-muted"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {type === "smart" && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-muted">
                Match
                <select
                  value={match}
                  onChange={(e) => setMatch(e.target.value as "all" | "any")}
                  className={field}
                >
                  <option value="all">all conditions</option>
                  <option value="any">any condition</option>
                </select>
              </label>

              {conditions.map((c, i) => {
                const meta = RULE_FIELDS[c.field];
                return (
                  <div key={i} className="flex flex-wrap items-center gap-1.5">
                    <select
                      value={c.field}
                      onChange={(e) => changeField(i, e.target.value)}
                      className={field}
                    >
                      {Object.entries(RULE_FIELDS).map(([k, m]) => (
                        <option key={k} value={k}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={c.op}
                      onChange={(e) => setCond(i, { op: e.target.value })}
                      className={field}
                    >
                      {meta.ops.map((o) => (
                        <option key={o.op} value={o.op}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {meta.value === "score" && (
                      <select
                        value={String(c.value ?? "hot")}
                        onChange={(e) => setCond(i, { value: e.target.value })}
                        className={field}
                      >
                        <option value="hot">hot</option>
                        <option value="warm">warm</option>
                        <option value="cold">cold</option>
                      </select>
                    )}
                    {meta.value === "tag" && (
                      <select
                        value={String(c.value ?? "")}
                        onChange={(e) => setCond(i, { value: e.target.value })}
                        className={field}
                      >
                        {tags.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {meta.value === "text" && (
                      <input
                        value={String(c.value ?? "")}
                        onChange={(e) => setCond(i, { value: e.target.value })}
                        placeholder="value"
                        className={field}
                      />
                    )}
                    {meta.value === "number" && (
                      <input
                        type="number"
                        value={Number(c.value ?? 30)}
                        onChange={(e) =>
                          setCond(i, { value: Number(e.target.value) })
                        }
                        className={`${field} w-20`}
                      />
                    )}
                    {conditions.length > 1 && (
                      <button
                        onClick={() =>
                          setConditions((cs) => cs.filter((_, idx) => idx !== i))
                        }
                        className="text-faint hover:text-danger-text"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
              <button
                onClick={() =>
                  setConditions((cs) => [
                    ...cs,
                    { field: "status", op: "eq", value: "new" },
                  ])
                }
                className="flex items-center gap-1 text-sm text-accent"
              >
                <Plus size={14} /> Add condition
              </button>
            </div>
          )}

          {type === "manual" && (
            <p className="text-sm text-muted">
              A manual segment starts empty. Add leads to it after creating.
            </p>
          )}

          {error && <p className="text-sm text-danger-text">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button
            onClick={onClose}
            className="rounded border border-line-mid px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create segment"}
          </button>
        </div>
      </div>
    </div>
  );
}
