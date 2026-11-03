import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Check,
  Inbox,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { AppPreview } from "@/components/marketing/app-preview";
import { BRAND } from "@/lib/marketing";

export const metadata: Metadata = {
  title: `${BRAND.name} — ${BRAND.tagline}`,
  description: BRAND.description,
};

const FEATURES = [
  {
    icon: Users,
    view: "dashboard" as const,
    h: "Leads, organized",
    a: "Import from CSV or push leads in over the REST API. Duplicates are caught case-insensitively, and tags, custom fields and smart segments keep lists clean.",
    points: ["CSV import with column mapping", "Smart segments that refresh themselves", "Lead timeline, notes and scoring"],
  },
  {
    icon: Sparkles,
    view: "ai" as const,
    h: "AI that writes like it knows you",
    a: "Describe your business once. The AI drafts multi-step sequences grounded in your offer, audience and proof, and you edit every step before launch.",
    points: ["Knowledge base grounds every draft", "Personalization variables per lead", "One click from sequence to campaign"],
  },
  {
    icon: Inbox,
    view: "inbox" as const,
    h: "Every reply, triaged",
    a: "Replies land in one shared inbox, classified by intent. Sequences stop on reply, out-of-office pushes the next step back, and not-interested leads are tagged for you.",
    points: ["Interested, question, OOO, not interested", "Assign, add internal notes, mark converted", "Notifications when it matters"],
  },
  {
    icon: BarChart3,
    view: "analytics" as const,
    h: "Know what works",
    a: "Open, click and reply rates per campaign, a full engagement funnel, and a live activity feed, so you double down on the steps that land.",
    points: ["Per-campaign performance", "Engagement funnel", "Sender health alerts"],
  },
];

const STEPS = [
  { h: "Tell it about your business", t: "Answer three questions so the AI knows your offer and who it's for." },
  { h: "Import leads and connect a mailbox", t: "Upload a CSV and send from your own address with sane daily limits." },
  { h: "Launch and work the replies", t: "Generate a sequence, review it, launch, and handle replies in one inbox." },
];

const TRUST = [
  "Sends from your own mailbox",
  "Daily limits and send windows",
  "One-click unsubscribe on every email",
  "Workspace data isolated per team",
];

export default function LandingPage() {
  return (
    <main>
      {/* hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 md:grid-cols-2 md:py-24">
        <div>
          <span className="mb-5 inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-tiny font-medium text-accent">
            <Sparkles size={13} /> Free during public beta
          </span>
          <h1 className="text-[36px] font-semibold leading-[1.1] tracking-tight text-ink2 md:text-[50px]">
            Cold email that reads like you wrote it.
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-muted">
            {BRAND.description}
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href="/signup"
              className="inline-flex h-10 items-center gap-1.5 rounded bg-accent px-5 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Start free <ArrowRight size={16} />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex h-10 items-center rounded border border-line-mid px-5 text-sm font-medium text-ink hover:bg-hover"
            >
              See pricing
            </Link>
          </div>
          <p className="mt-4 text-tiny text-muted">No credit card · Set up in about five minutes</p>
        </div>
        <AppPreview view="dashboard" />
      </section>

      {/* trust strip — concrete guarantees, not borrowed logos */}
      <section className="border-y border-line bg-page">
        <ul className="mx-auto grid max-w-6xl grid-cols-1 gap-3 px-4 py-6 text-sm text-ink sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {TRUST.map((t) => (
            <li key={t} className="flex items-center gap-2">
              <ShieldCheck size={16} className="shrink-0 text-accent" /> {t}
            </li>
          ))}
        </ul>
      </section>

      {/* features */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-20 sm:px-6">
        <div className="space-y-20">
          {FEATURES.map((f, i) => (
            <div
              key={f.h}
              className={`grid items-center gap-10 md:grid-cols-2 ${i % 2 ? "md:[&>*:first-child]:order-2" : ""}`}
            >
              <div>
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <f.icon size={19} strokeWidth={1.9} />
                </span>
                <h2 className="mt-4 text-[24px] font-semibold leading-tight text-ink2">{f.h}</h2>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{f.a}</p>
                <ul className="mt-4 space-y-2">
                  {f.points.map((p) => (
                    <li key={p} className="flex items-start gap-2 text-sm text-ink">
                      <Check size={15} className="mt-0.5 shrink-0 text-accent" strokeWidth={2.2} />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
              <AppPreview view={f.view} />
            </div>
          ))}
        </div>
      </section>

      {/* how it works */}
      <section id="how" className="scroll-mt-16 border-t border-line bg-page">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="text-center text-[24px] font-semibold text-ink2">How it works</h2>
          <p className="mt-2 text-center text-sm text-muted">From sign-up to first campaign in one sitting.</p>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={s.h} className="rounded-lg border border-line bg-surface p-6">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-4 text-section font-semibold text-ink2">{s.h}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.t}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-accent">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-4 py-16 text-center sm:px-6">
          <h2 className="text-[24px] font-semibold text-white">Your next meeting is one sequence away.</h2>
          <p className="max-w-md text-sm text-white/80">
            Free while we&apos;re in beta. Bring a list and an offer — we&apos;ll handle the rest.
          </p>
          <Link
            href="/signup"
            className="inline-flex h-10 items-center gap-1.5 rounded bg-surface px-5 text-sm font-medium text-accent hover:bg-surface/90"
          >
            Start free <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </main>
  );
}
