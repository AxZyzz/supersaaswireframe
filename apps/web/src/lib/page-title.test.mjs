// Run: node --test src/lib/page-title.test.mjs (from apps/web).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pageTitle } from "./page-title.ts";

test("Discover gets its own top-bar title, not the Dashboard fallback", () => {
  assert.equal(pageTitle("/discover"), "Discover");
  assert.equal(pageTitle("/discover?run=abc"), "Discover");
  assert.equal(pageTitle("/leads/123"), "Leads");
  assert.equal(pageTitle("/somewhere-unknown"), "Dashboard");
});

test("every sidebar nav entry has a matching top-bar title", () => {
  // The sidebar is a client component (lucide, next/link), so read its NAV
  // table as text instead of importing it.
  const src = readFileSync(new URL("../components/sidebar.tsx", import.meta.url), "utf8");
  const entries = [...src.matchAll(/\{\s*href:\s*"([^"]+)",\s*label:\s*"([^"]+)"/g)];
  assert.ok(entries.length >= 5, "found the sidebar NAV entries");
  for (const [, href, label] of entries) {
    assert.equal(pageTitle(href), label, `top bar title for ${href}`);
  }
});
