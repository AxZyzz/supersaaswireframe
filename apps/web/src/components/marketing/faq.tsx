"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";

export function Faq({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div>
      {items.map((item, i) => (
        <div key={item.q} className="border-b border-line">
          <button
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
            className="flex w-full items-center justify-between gap-4 py-4 text-left"
          >
            <span className="text-sm font-medium text-ink">{item.q}</span>
            {open === i ? (
              <Minus size={16} className="shrink-0 text-faint" />
            ) : (
              <Plus size={16} className="shrink-0 text-faint" />
            )}
          </button>
          {open === i && (
            <p className="pb-4 text-sm leading-relaxed text-muted">{item.a}</p>
          )}
        </div>
      ))}
    </div>
  );
}
