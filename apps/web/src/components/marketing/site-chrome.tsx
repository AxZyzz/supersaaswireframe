"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { getAccessToken } from "@/lib/api";
import { applyBrand } from "@/lib/branding";
import { BRAND } from "@/lib/marketing";

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded bg-accent text-white">
        <Send size={15} strokeWidth={2} />
      </span>
      <span className="text-sm font-semibold text-ink2">{BRAND.name}</span>
    </Link>
  );
}

export function SiteNav() {
  // Signed-in visitors get a way back into the app instead of sign-up CTAs.
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    setSignedIn(!!getAccessToken());
    // public pages wear our brand, not the last workspace's accent
    applyBrand(null);
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="hidden items-center gap-6 text-sm text-muted md:flex">
          <Link href="/#features" className="hover:text-ink">
            Product
          </Link>
          <Link href="/#how" className="hover:text-ink">
            How it works
          </Link>
          <Link href="/pricing" className="hover:text-ink">
            Pricing
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          {signedIn ? (
            <Link
              href="/dashboard"
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Open app
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded px-3 py-1.5 text-sm text-ink hover:bg-hover"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
              >
                Start free
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const cols: { h: string; links: [string, string][] }[] = [
    {
      h: "Product",
      links: [
        ["Features", "/#features"],
        ["How it works", "/#how"],
        ["Pricing", "/pricing"],
      ],
    },
    {
      h: "Account",
      links: [
        ["Start free", "/signup"],
        ["Log in", "/login"],
      ],
    },
  ];
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="col-span-2">
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-muted">{BRAND.tagline}</p>
        </div>
        {cols.map((c) => (
          <div key={c.h}>
            <div className="text-sm font-semibold text-ink">{c.h}</div>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              {c.links.map(([label, href]) => (
                <li key={label}>
                  <Link href={href} className="hover:text-ink">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-4 text-tiny text-muted sm:px-6">
          © {new Date().getFullYear()} A2B AI Technologies. {BRAND.name} is in public beta.
        </div>
      </div>
    </footer>
  );
}
