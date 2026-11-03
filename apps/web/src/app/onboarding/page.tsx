"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Circle,
  Loader2,
  Send,
  XCircle,
} from "lucide-react";
import { api, ApiError, ensureSession, errorMessage } from "@/lib/api";
import { getKnowledge, OrgKnowledge, saveKnowledge } from "@/lib/ai";
import { applyBrand } from "@/lib/branding";
import {
  completeOnboarding,
  getOrg,
  getSetup,
  INDUSTRIES,
  Org,
  OrgPatch,
  SetupStatus,
  TEAM_SIZES,
  timezones,
  updateOrg,
} from "@/lib/org";
import { dnsCheck, DnsCheckResult, listSenders } from "@/lib/senders";
import { SendersSection } from "@/components/senders-section";
import { BrandingFields } from "@/components/workspace-section";
import { Toaster } from "@/components/feedback";

const STEPS = ["Workspace", "AI memory", "Sender", "Domain", "Done"];

const field =
  "w-full rounded border border-line-mid bg-white px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft2";
const label = "text-tiny font-medium uppercase tracking-wide text-faint";

export default function OnboardingPage() {
  const router = useRouter();
  const [org, setOrg] = useState<Org | null>(null);
  const [step, setStep] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    ensureSession()
      .then((ok) => {
        if (!ok) {
          router.replace("/login");
          return null;
        }
        return Promise.all([api<{ role: string }>("/auth/me"), getOrg()]);
      })
      .then((res) => {
        if (!res) return;
        const [me, o] = res;
        // Wizard is admin-only and one-shot; everyone else goes straight in.
        if (me.role !== "admin" || o.onboarded_at) {
          router.replace("/dashboard");
          return;
        }
        applyBrand(o.brand_color);
        setOrg(o);
      })
      .catch((e) => {
        // only an auth failure means "sign in again" (see (app)/layout)
        if (e instanceof ApiError && e.status === 401) router.replace("/login");
        else setOffline(true);
      });
  }, [router]);

  async function finish() {
    setFinishing(true);
    await completeOnboarding();
    router.replace("/dashboard");
  }

  if (!org) {
    return (
      <div className="flex h-screen items-center justify-center bg-page text-sm text-muted">
        {offline ? "Can't reach the server right now — refresh in a moment." : "Loading…"}
      </div>
    );
  }

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            {org.logo_data ? (
              // eslint-disable-next-line @next/next/no-img-element -- data: URL
              <img src={org.logo_data} alt="" className="h-7 w-7 rounded object-contain" />
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded bg-accent text-white">
                <Send size={15} strokeWidth={2} />
              </span>
            )}
            <span className="text-sm font-semibold text-ink">{org.name}</span>
          </div>
          <ol className="hidden items-center gap-1 sm:flex">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-1">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-micro font-medium ${
                    i < step
                      ? "bg-accent-soft text-accent"
                      : i === step
                        ? "bg-accent text-white"
                        : "bg-neut-bg text-faint"
                  }`}
                >
                  {i < step ? <Check size={13} strokeWidth={2.5} /> : i + 1}
                </span>
                <span
                  className={`text-tiny ${i === step ? "font-medium text-ink" : "text-muted"}`}
                >
                  {s}
                </span>
                {i < STEPS.length - 1 && <span className="mx-1 h-px w-5 bg-line-mid" />}
              </li>
            ))}
          </ol>
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-6 py-10">
        <div className={`w-full ${step === 2 ? "max-w-3xl" : "max-w-xl"}`}>
          {step === 0 && (
            <WorkspaceStep
              org={org}
              onSaved={(o) => {
                setOrg(o);
                next();
              }}
            />
          )}
          {step === 1 && <MemoryStep onDone={next} />}
          {step === 2 && (
            <Card>
              <h1 className="text-title font-semibold text-ink">Connect a sender.</h1>
              <p className="mt-1.5 mb-5 text-sm text-muted">
                The mailbox your campaigns send from. You can add more later in
                Settings.
              </p>
              <SendersSection showDnsCheck={false} />
            </Card>
          )}
          {step === 3 && <DomainStep />}
          {step === 4 && <DoneStep finishing={finishing} onFinish={() => void finish()} />}

          {step > 0 && step < 4 && (
            <div className="mt-5 flex items-center justify-between">
              <button
                onClick={back}
                className="flex items-center gap-1 text-sm text-muted hover:text-ink"
              >
                <ArrowLeft size={14} /> Back
              </button>
              {(step === 2 || step === 3) && (
                <button
                  onClick={next}
                  className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
                >
                  Continue
                </button>
              )}
            </div>
          )}
          {step < 4 && (
            <p className="mt-6 text-center text-tiny text-faint">
              <button
                onClick={() => void finish()}
                className="hover:text-muted hover:underline"
              >
                Skip setup and go to the dashboard
              </button>
            </p>
          )}
        </div>
      </main>
      <Toaster />
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-white p-6 shadow-sm">{children}</div>
  );
}

function WorkspaceStep({ org, onSaved }: { org: Org; onSaved: (o: Org) => void }) {
  const [d, setD] = useState<OrgPatch>({
    name: org.name,
    website: org.website,
    industry: org.industry,
    teamSize: org.team_size,
    // a fresh workspace defaults to the admin's own zone, not UTC
    timezone:
      org.timezone === "UTC"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
        : org.timezone,
    brandColor: org.brand_color,
    logoData: org.logo_data,
    postalAddress: org.postal_address,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (p: OrgPatch) => setD((x) => ({ ...x, ...p }));

  async function save() {
    if (!d.name?.trim()) {
      setErr("Give your workspace a name.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      onSaved(await updateOrg(d));
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Card>
      <h1 className="text-title font-semibold text-ink">Set up your workspace.</h1>
      <p className="mt-1.5 text-sm text-muted">
        A few details so we can tailor your outreach setup.
      </p>
      <div className="mt-6 space-y-4">
        <label className="block space-y-1">
          <span className={label}>Workspace name</span>
          <input
            className={field}
            value={d.name ?? ""}
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
        <label className="block space-y-1">
          <span className={label}>Website</span>
          <input
            className={field}
            placeholder="https://"
            value={d.website ?? ""}
            onChange={(e) => set({ website: e.target.value || null })}
          />
        </label>
        <label className="block space-y-1">
          <span className={label}>Business postal address</span>
          <input
            className={field}
            placeholder="Street, city, postcode, country"
            value={d.postalAddress ?? ""}
            onChange={(e) => set({ postalAddress: e.target.value || null })}
          />
          <span className="text-tiny text-faint">
            Required by anti-spam law; shown in your campaign email footers.
          </span>
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block space-y-1">
            <span className={label}>Industry</span>
            <select
              className={field}
              value={d.industry ?? ""}
              onChange={(e) => set({ industry: e.target.value || null })}
            >
              <option value="">Choose…</option>
              {INDUSTRIES.map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className={label}>Team size</span>
            <select
              className={field}
              value={d.teamSize ?? ""}
              onChange={(e) => set({ teamSize: e.target.value || null })}
            >
              <option value="">Choose…</option>
              {TEAM_SIZES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block space-y-1">
          <span className={label}>Timezone</span>
          <select
            className={field}
            value={d.timezone}
            onChange={(e) => set({ timezone: e.target.value })}
          >
            {timezones().map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </label>
        <BrandingFields
          logo={d.logoData ?? null}
          color={d.brandColor ?? null}
          onLogo={(logoData) => set({ logoData })}
          onColor={(brandColor) => {
            set({ brandColor });
            applyBrand(brandColor);
          }}
        />
      </div>
      {err && <p className="mt-4 text-sm text-danger-text">{err}</p>}
      <div className="mt-7 flex justify-end">
        <button
          onClick={() => void save()}
          disabled={busy}
          className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
        >
          {busy ? "Saving…" : "Continue"}
        </button>
      </div>
    </Card>
  );
}

const MEMORY_FIELDS: { key: keyof OrgKnowledge; label: string; placeholder: string }[] = [
  {
    key: "description",
    label: "What does your business do?",
    placeholder: "We help B2B agencies book more discovery calls with…",
  },
  {
    key: "audience",
    label: "Who do you sell to?",
    placeholder: "Founders and heads of growth at 10–200 person SaaS companies.",
  },
  {
    key: "offer",
    label: "What are you offering in outreach?",
    placeholder: "A free 20-minute audit of their outbound funnel.",
  },
];

function MemoryStep({ onDone }: { onDone: () => void }) {
  const [kb, setKb] = useState<OrgKnowledge | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getKnowledge().then((k) => setKb(k ?? {}));
  }, []);

  async function save() {
    setBusy(true);
    await saveKnowledge(kb ?? {});
    onDone();
  }

  return (
    <Card>
      <h1 className="text-title font-semibold text-ink">Teach the AI your business.</h1>
      <p className="mt-1.5 text-sm text-muted">
        Every generated email is grounded in this. Three answers is enough to
        start — the full knowledge base lives in Settings.
      </p>
      {!kb ? (
        <p className="mt-6 text-sm text-muted">Loading…</p>
      ) : (
        <div className="mt-6 space-y-4">
          {MEMORY_FIELDS.map((f) => (
            <label key={f.key} className="block space-y-1">
              <span className="text-sm font-medium text-ink">{f.label}</span>
              <textarea
                rows={2}
                className={field}
                placeholder={f.placeholder}
                value={kb[f.key] ?? ""}
                onChange={(e) => setKb((p) => ({ ...p, [f.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      )}
      <div className="mt-7 flex justify-end gap-3">
        <button onClick={onDone} className="text-sm text-muted hover:text-ink">
          Skip for now
        </button>
        <button
          onClick={() => void save()}
          disabled={busy || !kb}
          className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
        >
          {busy ? "Saving…" : "Continue"}
        </button>
      </div>
    </Card>
  );
}

function DomainStep() {
  const [domain, setDomain] = useState("");
  const [res, setRes] = useState<DnsCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // default to the first sender's domain
  useEffect(() => {
    void listSenders().then((s) => {
      const d = s[0]?.from_email.split("@")[1];
      if (d) setDomain((cur) => cur || d);
    });
  }, []);

  async function check() {
    if (!domain.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      setRes(await dnsCheck(domain.trim()));
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const rows: { key: "spf" | "dkim" | "dmarc"; name: string; why: string }[] = [
    { key: "spf", name: "SPF", why: "Authorizes your provider to send on your behalf." },
    { key: "dkim", name: "DKIM", why: "Signs your emails so inboxes trust them." },
    { key: "dmarc", name: "DMARC", why: "Tells inboxes what to do with unauthenticated mail." },
  ];

  return (
    <Card>
      <h1 className="text-title font-semibold text-ink">Check your domain.</h1>
      <p className="mt-1.5 text-sm text-muted">
        Authenticated domains land in the inbox, not spam. We look up your live
        DNS records — nothing is changed.
      </p>
      <div className="mt-6 flex gap-2">
        <input
          className={field}
          placeholder="yourcompany.com"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void check()}
        />
        <button
          onClick={() => void check()}
          disabled={busy || !domain.trim()}
          className="flex shrink-0 items-center gap-1.5 rounded border border-line-mid px-3 py-1.5 text-sm text-ink hover:bg-hover disabled:opacity-60"
        >
          {busy && <Loader2 size={14} className="animate-spin" />} Check DNS
        </button>
      </div>
      {err && <p className="mt-3 text-sm text-danger-text">{err}</p>}
      {res && (
        <ul className="mt-5 space-y-2">
          {rows.map((r) => {
            const c = res[r.key];
            return (
              <li key={r.key} className="rounded-md border border-line p-3">
                <div className="flex items-center gap-2">
                  {c.found ? (
                    <CheckCircle2 size={16} className="text-success-text" />
                  ) : (
                    <XCircle size={16} className="text-warning-text" />
                  )}
                  <span className="text-sm font-semibold text-ink">{r.name}</span>
                  <span className="text-tiny text-muted">{r.why}</span>
                </div>
                <p className="mt-1 pl-6 text-tiny text-muted">{c.detail}</p>
                {c.record && (
                  <code className="mt-1 ml-6 block truncate rounded bg-panel px-2 py-1 text-tiny text-ink">
                    {c.record}
                  </code>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-5 text-tiny text-faint">
        Missing records? Add them at your DNS provider and re-check — propagation
        can take up to an hour. You can continue meanwhile.
      </p>
    </Card>
  );
}

function DoneStep({
  finishing,
  onFinish,
}: {
  finishing: boolean;
  onFinish: () => void;
}) {
  const [s, setS] = useState<SetupStatus | null>(null);
  useEffect(() => {
    void getSetup().then(setS);
  }, []);

  const items: [keyof SetupStatus, string][] = [
    ["profile", "Workspace profile"],
    ["knowledge", "AI memory"],
    ["sender", "Sender connected"],
    ["senderVerified", "Sender verified"],
  ];

  return (
    <Card>
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-success-bg text-success-text">
        <Check size={22} strokeWidth={2.5} />
      </div>
      <h1 className="mt-4 text-title font-semibold text-ink">You&apos;re set up.</h1>
      <p className="mt-1.5 text-sm text-muted">
        Next: import leads and launch your first campaign. Anything you skipped
        stays on your dashboard checklist.
      </p>
      <ul className="mt-5 space-y-2">
        {items.map(([k, text]) => (
          <li key={k} className="flex items-center gap-2 text-sm">
            {s?.[k] ? (
              <CheckCircle2 size={16} className="text-success-text" />
            ) : (
              <Circle size={16} className="text-faint" />
            )}
            <span className={s?.[k] ? "text-ink" : "text-muted"}>{text}</span>
          </li>
        ))}
      </ul>
      <button
        onClick={onFinish}
        disabled={finishing}
        className="mt-7 w-full rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
      >
        {finishing ? "Opening…" : "Go to dashboard"}
      </button>
    </Card>
  );
}
