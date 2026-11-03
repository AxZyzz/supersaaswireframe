"use client";

import { useState } from "react";
import { Sparkles, Undo2 } from "lucide-react";
import { refineEmail } from "@/lib/ai";
import { errorMessage } from "@/lib/api";
import { toast } from "@/components/feedback";

interface Draft {
  subject: string;
  body: string;
}

const QUICK = ["Shorter", "More casual", "More direct", "Stronger call to action"];

/**
 * Chat-style editing of one email (T6.3): type an instruction ("shorter",
 * "mention the case study") and the draft is rewritten in place. Each turn
 * builds on the current text; Undo walks back through earlier versions.
 */
export function AiEditBar({
  draft,
  onChange,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Draft[]>([]);

  async function run(change: string) {
    const text = change.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const next = await refineEmail({ ...draft, instruction: text });
      setHistory((h) => [...h, draft].slice(-10));
      onChange(next);
      setInstruction("");
    } catch (e) {
      toast(errorMessage(e, "Couldn't edit that draft."), "error");
    } finally {
      setBusy(false);
    }
  }

  function undo() {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    onChange(prev);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Sparkles size={13} className="absolute left-2.5 top-2.5 text-accent" />
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void run(instruction)}
            placeholder="Ask AI to edit — e.g. mention our case study"
            disabled={busy}
            className="w-full rounded border border-line-mid bg-white py-1.5 pl-8 pr-2.5 text-sm outline-none focus:border-accent disabled:opacity-60"
          />
        </div>
        <button
          onClick={() => void run(instruction)}
          disabled={busy || !instruction.trim()}
          className="rounded border border-line-mid px-2.5 text-tiny text-ink hover:bg-hover disabled:opacity-50"
        >
          {busy ? "Editing…" : "Apply"}
        </button>
        {history.length > 0 && (
          <button
            onClick={undo}
            disabled={busy}
            title="Undo last AI edit"
            className="rounded border border-line-mid px-2 text-faint hover:text-ink"
          >
            <Undo2 size={13} />
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {QUICK.map((q) => (
          <button
            key={q}
            onClick={() => void run(q)}
            disabled={busy}
            className="rounded-full bg-white px-2 py-0.5 text-micro text-muted ring-1 ring-line hover:text-ink disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
