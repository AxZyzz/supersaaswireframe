"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { toast } from "@/components/feedback";
import { createOffer, listOffers, Offer } from "@/lib/offers";

const field =
  "rounded border border-line-mid bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent";

export function OfferSelect({
  value,
  onChange,
  disabled,
  canCreate = true,
  className = "",
}: {
  value: string;
  onChange: (offerId: string) => void;
  disabled?: boolean;
  canCreate?: boolean;
  className?: string;
}) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void listOffers()
      .then((list) => {
        if (!live) return;
        setOffers(list);
        if (!value && list[0]) {
          onChange(list[0].id);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitNew() {
    const clean = newName.trim();
    if (!clean) return;
    setBusy(true);
    try {
      const created = await createOffer({ name: clean });
      setOffers((prev) => [...prev, created]);
      onChange(created.id);
      setNewName("");
      setCreating(false);
      toast(`Offer "${created.name}" created.`);
    } catch (e) {
      toast(errorMessage(e, "Could not create offer."), "error");
    } finally {
      setBusy(false);
    }
  }

  if (creating) {
    return (
      <div className={`flex items-center gap-1.5 ${className}`}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New offer name…"
          maxLength={120}
          className={`${field} flex-1`}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submitNew();
            }
          }}
        />
        <button
          type="button"
          disabled={busy || !newName.trim()}
          onClick={() => void submitNew()}
          className="rounded bg-accent px-2.5 py-1.5 text-tiny font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => {
            setCreating(false);
            setNewName("");
          }}
          className="rounded border border-line-mid px-2 py-1.5 text-tiny text-muted hover:text-ink"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === "__new__") {
            setCreating(true);
          } else {
            onChange(e.target.value);
          }
        }}
        className={`${field} flex-1 disabled:opacity-60`}
      >
        {offers.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
        {canCreate && !disabled && (
          <option value="__new__">+ New offer…</option>
        )}
      </select>
      {canCreate && !disabled && (
        <button
          type="button"
          onClick={() => setCreating(true)}
          title="New offer"
          className="flex items-center gap-1 rounded border border-line-mid px-2 py-1.5 text-tiny text-muted hover:border-accent hover:text-accent"
        >
          <Plus size={12} /> New offer…
        </button>
      )}
    </div>
  );
}
