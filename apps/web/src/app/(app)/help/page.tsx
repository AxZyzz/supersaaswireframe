"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, ChevronRight, Search } from "lucide-react";
import { DocBody } from "@/components/doc-body";
import { DOC_SECTIONS, DOCS, docBySlug } from "@/lib/docs";

export default function HelpPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <Help />
    </Suspense>
  );
}

function Help() {
  const params = useSearchParams();
  const article = docBySlug(params.get("a") ?? "");
  const [q, setQ] = useState("");

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return DOCS;
    return DOCS.filter((d) =>
      `${d.title} ${d.summary} ${d.body}`.toLowerCase().includes(needle),
    );
  }, [q]);

  return (
    <div className="mx-auto flex max-w-shell gap-6">
      {/* table of contents */}
      <nav className="hidden w-56 shrink-0 lg:block">
        <div className="sticky top-0 space-y-4">
          {DOC_SECTIONS.map((s) => (
            <div key={s}>
              <div className="px-2 pb-1 text-micro font-medium uppercase tracking-wide text-faint">
                {s}
              </div>
              {DOCS.filter((d) => d.section === s).map((d) => (
                <Link
                  key={d.slug}
                  href={`/help?a=${d.slug}`}
                  className={`block rounded px-2 py-1 text-sm ${
                    article?.slug === d.slug
                      ? "bg-accent-soft font-medium text-accent"
                      : "text-muted hover:bg-hover hover:text-ink"
                  }`}
                >
                  {d.title}
                </Link>
              ))}
            </div>
          ))}
        </div>
      </nav>

      <div className="min-w-0 flex-1">
        {article ? (
          <article className="max-w-2xl rounded-lg border border-line bg-surface p-6">
            <Link
              href="/help"
              className="mb-4 inline-flex items-center gap-1 text-tiny text-muted hover:text-ink"
            >
              <ArrowLeft size={12} /> All articles
            </Link>
            <div className="text-tiny text-faint">{article.section}</div>
            <h1 className="mb-1 text-title font-semibold text-ink2">{article.title}</h1>
            <p className="mb-5 text-sm text-muted">{article.summary}</p>
            <DocBody body={article.body} />
          </article>
        ) : (
          <div className="max-w-3xl space-y-5">
            <div>
              <div className="flex items-center gap-2">
                <BookOpen size={18} className="text-faint" />
                <h1 className="text-title font-semibold text-ink2">Help center</h1>
              </div>
              <p className="mt-1 text-sm text-muted">
                Guides for every part of the app. Press{" "}
                <kbd className="rounded border border-line-mid bg-panel px-1 text-tiny">Ctrl K</kbd>{" "}
                anywhere to jump to a page or article.
              </p>
            </div>
            <label className="flex items-center gap-2 rounded border border-line-mid bg-surface px-3 py-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft2">
              <Search size={15} className="text-faint" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search help — e.g. unsubscribe, DKIM, API"
                className="flex-1 bg-transparent text-sm outline-none"
                autoFocus
              />
            </label>
            {matches.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">
                Nothing matches &ldquo;{q}&rdquo;.
              </p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
                {matches.map((d) => (
                  <li key={d.slug}>
                    <Link
                      href={`/help?a=${d.slug}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-hover"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-ink">{d.title}</div>
                        <div className="truncate text-tiny text-muted">
                          {d.section} · {d.summary}
                        </div>
                      </div>
                      <ChevronRight size={15} className="shrink-0 text-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
