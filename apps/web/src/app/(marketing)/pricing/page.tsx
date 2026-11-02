import type { Metadata } from "next";
import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { Faq } from "@/components/marketing/faq";
import {
  BETA_LIMITS,
  BRAND,
  FAQ,
  PLANNED_TIERS,
  SHOW_PLANNED_TIERS,
} from "@/lib/marketing";

export const metadata: Metadata = {
  title: `Pricing — ${BRAND.name}`,
  description: `${BRAND.name} is free during the public beta. See beta limits and planned plans.`,
};

const INCLUDED = [
  "AI sequence builder + knowledge base",
  "CSV import, REST API, smart segments",
  "Open, click and reply tracking",
  "Shared inbox with reply classification",
  "Team roles, invites and branding",
  "One-click unsubscribe + suppression",
];

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
      <h1 className="text-center text-[28px] font-semibold text-ink2 md:text-[34px]">
        Free while we&apos;re in beta.
      </h1>
      <p className="mx-auto mt-2 max-w-lg text-center text-sm text-muted">
        Every feature, no card. Beta workspaces run with fair-use limits that keep
        sending reputations healthy.
      </p>

      {/* the beta plan */}
      <div className="mx-auto mt-10 grid max-w-3xl overflow-hidden rounded-lg border border-accent shadow-float md:grid-cols-2">
        <div className="bg-white p-6">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-tiny font-medium text-accent">
            <Sparkles size={13} /> Public beta
          </span>
          <div className="mt-4 flex items-end gap-1.5">
            <span className="text-[40px] font-semibold leading-none text-ink2">$0</span>
            <span className="pb-1 text-tiny text-muted">during beta</span>
          </div>
          <ul className="mt-5 space-y-2.5">
            {INCLUDED.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-ink">
                <Check size={15} className="mt-0.5 shrink-0 text-accent" strokeWidth={2.2} />
                {f}
              </li>
            ))}
          </ul>
          <Link
            href="/signup"
            className="mt-6 flex h-10 w-full items-center justify-center rounded bg-accent text-sm font-medium text-white hover:bg-accent-hover"
          >
            Start free
          </Link>
        </div>
        <div className="border-t border-line bg-page p-6 md:border-t-0 md:border-l">
          <h2 className="text-sm font-semibold text-ink2">Beta limits</h2>
          <dl className="mt-3 space-y-2">
            {BETA_LIMITS.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <dt className="text-muted">{label}</dt>
                <dd className="font-medium text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {SHOW_PLANNED_TIERS && (
        <section className="mt-20">
          <h2 className="text-center text-section font-semibold text-ink2">
            Planned plans after beta
          </h2>
          <p className="mt-1 text-center text-tiny text-muted">
            Indicative and subject to change. Beta users get notice well before
            anything is billed.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PLANNED_TIERS.map((t) => (
              <div key={t.name} className="rounded-lg border border-line bg-white p-5">
                <div className="text-sm font-semibold text-ink2">{t.name}</div>
                <div className="mt-0.5 text-tiny text-muted">{t.blurb}</div>
                <div className="mt-3 flex items-end gap-1">
                  <span className="text-[24px] font-semibold leading-none text-ink2">{t.price}</span>
                  <span className="pb-0.5 text-tiny text-muted">/ month</span>
                </div>
                <ul className="mt-4 space-y-1.5 border-t border-line pt-3">
                  {t.features.map((f) => (
                    <li key={f} className="flex items-start gap-1.5 text-tiny text-ink">
                      <Check size={13} className="mt-0.5 shrink-0 text-faint" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mx-auto mt-20 max-w-2xl">
        <h2 className="text-center text-section font-semibold text-ink2">
          Frequently asked questions
        </h2>
        <div className="mt-5">
          <Faq items={FAQ} />
        </div>
      </section>
    </main>
  );
}
