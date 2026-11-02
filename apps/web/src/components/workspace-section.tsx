"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, Check, ImagePlus, Palette, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { applyBrand, DEFAULT_ACCENT, logoToDataUrl } from "@/lib/branding";
import {
  getOrg,
  INDUSTRIES,
  Org,
  OrgPatch,
  TEAM_SIZES,
  timezones,
  updateOrg,
} from "@/lib/org";

/** Tell the app shell (sidebar name/logo, accent) that the org changed. */
export function announceOrg(org: Org) {
  window.dispatchEvent(new CustomEvent<Org>("org-updated", { detail: org }));
}

const field =
  "w-full rounded border border-line-mid bg-white px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft2 disabled:bg-panel disabled:text-muted";
const label = "text-tiny font-medium uppercase tracking-wide text-faint";

/** Logo picker + color picker with a live preview. Shared by Settings and
 *  the onboarding wizard. Controlled: the parent owns the values. */
export function BrandingFields({
  logo,
  color,
  onLogo,
  onColor,
  disabled,
}: {
  logo: string | null;
  color: string | null;
  onLogo: (v: string | null) => void;
  onColor: (v: string | null) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setErr(null);
    try {
      onLogo(await logoToDataUrl(file));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1">
        <span className={label}>Logo</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={disabled}
            onClick={() => input.current?.click()}
            className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-dashed border-line-mid bg-panel text-faint hover:bg-hover disabled:cursor-not-allowed"
            aria-label="Upload logo"
          >
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- data: URL
              <img src={logo} alt="Logo" className="h-full w-full object-contain" />
            ) : (
              <ImagePlus size={20} strokeWidth={1.6} />
            )}
          </button>
          <div className="space-y-1 text-tiny text-muted">
            <p>PNG, JPG, WebP or SVG. Resized to 256px.</p>
            {logo && !disabled && (
              <button
                type="button"
                onClick={() => onLogo(null)}
                className="text-danger-text hover:underline"
              >
                Remove logo
              </button>
            )}
          </div>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {err && <p className="text-tiny text-danger-text">{err}</p>}
      </div>

      <div className="space-y-1">
        <span className={label}>Accent color</span>
        <div className="flex items-center gap-2">
          <input
            type="color"
            disabled={disabled}
            value={color ?? DEFAULT_ACCENT}
            onChange={(e) => onColor(e.target.value)}
            className="h-9 w-12 cursor-pointer rounded border border-line-mid bg-white p-0.5 disabled:cursor-not-allowed"
            aria-label="Accent color"
          />
          <code className="text-sm text-muted">{color ?? DEFAULT_ACCENT}</code>
          {color && !disabled && (
            <button
              type="button"
              onClick={() => onColor(null)}
              className="flex items-center gap-1 text-tiny text-muted hover:text-ink"
            >
              <RotateCcw size={12} /> Default
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <span className="rounded bg-accent px-2.5 py-1 text-tiny font-medium text-white">
            Primary button
          </span>
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-micro font-medium text-accent">
            Badge
          </span>
          <span className="text-tiny text-accent">Link</span>
        </div>
      </div>
    </div>
  );
}

export function WorkspaceSection() {
  const [org, setOrg] = useState<Org | null>(null);
  const [draft, setDraft] = useState<OrgPatch>({});
  const [canEdit, setCanEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([getOrg(), api<{ role: string }>("/auth/me")]).then(
      ([o, me]) => {
        setOrg(o);
        setCanEdit(me.role === "admin");
      },
    );
  }, []);

  if (!org) {
    return (
      <section className="rounded-lg border border-line bg-white p-5 text-sm text-muted">
        Loading workspace…
      </section>
    );
  }

  // draft overlays the saved org; undefined = untouched
  const v = <K extends keyof OrgPatch>(k: K, saved: OrgPatch[K]) =>
    k in draft ? draft[k] : saved;
  const set = (patch: OrgPatch) => setDraft((d) => ({ ...d, ...patch }));
  const color = v("brandColor", org.brand_color) ?? null;
  const dirty = Object.keys(draft).length > 0;

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const next = await updateOrg(draft);
      setOrg(next);
      setDraft({});
      announceOrg(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setDraft({});
    applyBrand(org!.brand_color);
  }

  return (
    <section className="rounded-lg border border-line bg-white p-5">
      <div className="mb-1 flex items-center gap-2">
        <Building2 size={16} className="text-faint" />
        <h2 className="text-section font-semibold text-ink2">Workspace</h2>
      </div>
      <p className="mb-4 text-sm text-muted">
        {canEdit
          ? "Your workspace profile and how the app looks for your team."
          : "Only admins can change workspace settings."}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className={label}>Workspace name</span>
          <input
            className={field}
            disabled={!canEdit}
            value={v("name", org.name) ?? ""}
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
        <label className="block space-y-1">
          <span className={label}>Website</span>
          <input
            className={field}
            disabled={!canEdit}
            placeholder="https://"
            value={v("website", org.website) ?? ""}
            onChange={(e) => set({ website: e.target.value || null })}
          />
        </label>
        <label className="block space-y-1">
          <span className={label}>Industry</span>
          <select
            className={field}
            disabled={!canEdit}
            value={v("industry", org.industry) ?? ""}
            onChange={(e) => set({ industry: e.target.value || null })}
          >
            <option value="">—</option>
            {INDUSTRIES.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className={label}>Team size</span>
          <select
            className={field}
            disabled={!canEdit}
            value={v("teamSize", org.team_size) ?? ""}
            onChange={(e) => set({ teamSize: e.target.value || null })}
          >
            <option value="">—</option>
            {TEAM_SIZES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 sm:col-span-2">
          <span className={label}>Timezone</span>
          <select
            className={field}
            disabled={!canEdit}
            value={v("timezone", org.timezone)}
            onChange={(e) => set({ timezone: e.target.value })}
          >
            {timezones().map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
          <span className="text-tiny text-faint">
            Used for send windows and reports.
          </span>
        </label>
      </div>

      <div className="mt-6 mb-3 flex items-center gap-2 border-t border-line pt-5">
        <Palette size={16} className="text-faint" />
        <h3 className="text-sm font-semibold text-ink2">Branding</h3>
      </div>
      <BrandingFields
        disabled={!canEdit}
        logo={v("logoData", org.logo_data) ?? null}
        color={color}
        onLogo={(logoData) => set({ logoData })}
        onColor={(brandColor) => {
          set({ brandColor });
          applyBrand(brandColor); // live preview across the app
        }}
      />

      {canEdit && (
        <div className="mt-5 flex items-center gap-2">
          <button
            onClick={() => void save()}
            disabled={!dirty || saving}
            className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {saved && <Check size={15} />}
            {saved ? "Saved" : saving ? "Saving…" : "Save workspace"}
          </button>
          {dirty && (
            <button
              onClick={discard}
              className="rounded px-3 py-1.5 text-sm text-muted hover:bg-hover"
            >
              Discard
            </button>
          )}
          {err && <span className="text-sm text-danger-text">{err}</span>}
        </div>
      )}
    </section>
  );
}
