"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Cloud, FileSpreadsheet, Mail, Plug, RefreshCw, Trash2, X } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { timeAgo } from "@/lib/analytics";
import {
  connectSheets,
  deleteSheetSync,
  disconnectSheets,
  getIntegrations,
  IntegrationsOverview,
  listSheetSyncs,
  runSheetSync,
  setSheetSyncEnabled,
  SheetSync,
} from "@/lib/integrations";
import { gmailConnect } from "@/lib/senders";
import { toast } from "@/components/feedback";

const card = "rounded-lg border border-line bg-panel p-4";
const btn =
  "rounded border border-line-mid bg-surface px-3 py-1.5 text-sm font-medium text-ink2 hover:bg-hover disabled:opacity-60";
const primary =
  "rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60";

function Status({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-tiny ${
        on ? "bg-success-bg text-success-text" : "bg-neut-bg text-muted"
      }`}
    >
      {label}
    </span>
  );
}

/**
 * Settings → Integrations (T9.2): every outside account the workspace uses.
 * Gmail lives on sender accounts; Google Sheets has its own connection and
 * synced sheets (T2.8); Amazon SES waits on the AWS setup.
 */
export function IntegrationsSection({ canManage }: { canManage: boolean }) {
  const [o, setO] = useState<IntegrationsOverview | null>(null);
  const [syncs, setSyncs] = useState<SheetSync[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const fetchAll = () => Promise.all([getIntegrations(), listSheetSyncs()]);
  const reload = useCallback(async () => {
    const [ov, s] = await fetchAll();
    setO(ov);
    setSyncs(s);
  }, []);

  useEffect(() => {
    let live = true;
    void fetchAll().then(([ov, s]) => {
      if (!live) return;
      setO(ov);
      setSyncs(s);
    });
    return () => {
      live = false;
    };
  }, []);

  async function act(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    try {
      await fn();
      if (ok) toast(ok);
      await reload();
    } catch (e) {
      toast(errorMessage(e, "That didn't work."), "error");
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function go(get: () => Promise<{ url: string }>) {
    try {
      window.location.assign((await get()).url);
    } catch (e) {
      toast(errorMessage(e, "Couldn't start Google sign-in."), "error");
    }
  }

  if (!o) return null;
  const gs = o.googleSheets;

  return (
    <section id="integrations" className="rounded-lg border border-line bg-surface p-5">
      <div className="mb-1 flex items-center gap-2">
        <Plug size={16} className="text-faint" />
        <h2 className="text-section font-semibold text-ink2">Integrations</h2>
      </div>
      <p className="mb-4 text-sm text-muted">
        Outside accounts this workspace sends from or imports leads from.
      </p>

      <Suspense fallback={null}>
        <SheetsConnectResult />
      </Suspense>

      <div className="space-y-3">
        {/* Gmail */}
        <div className={card}>
          <div className="flex flex-wrap items-center gap-2">
            <Mail size={16} className="text-faint" />
            <span className="font-medium text-ink">Gmail</span>
            <Status
              on={o.gmail.senders > 0}
              label={
                o.gmail.senders
                  ? `${o.gmail.senders} connected · ${o.gmail.verified} verified`
                  : "Not connected"
              }
            />
            <div className="flex-1" />
            {canManage && o.gmail.available && (
              <button onClick={() => void go(() => gmailConnect())} className={btn}>
                Connect Gmail
              </button>
            )}
          </div>
          <p className="mt-1.5 text-tiny text-muted">
            {o.gmail.available
              ? "Send campaigns from Gmail accounts. Each connected account is a sender in "
              : "Not available on this server yet (Google OAuth credentials missing). Senders: "}
            <Link href="/settings#senders" className="text-accent hover:underline">
              Sender accounts
            </Link>
            .
          </p>
        </div>

        {/* Google Sheets */}
        <div className={card}>
          <div className="flex flex-wrap items-center gap-2">
            <FileSpreadsheet size={16} className="text-faint" />
            <span className="font-medium text-ink">Google Sheets</span>
            <Status
              on={gs.connected}
              label={gs.connected ? `Connected · ${gs.accountEmail}` : "Not connected"}
            />
            <div className="flex-1" />
            {canManage && gs.available && !gs.connected && (
              <button onClick={() => void go(() => connectSheets("/settings"))} className={primary}>
                Connect Google Sheets
              </button>
            )}
            {canManage && gs.connected && (
              <>
                <Link href="/leads?import=sheet" className={btn}>
                  Import a sheet
                </Link>
                <button
                  disabled={busy === "disconnect"}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Disconnect Google Sheets? Synced sheets stop updating. Leads already imported stay.",
                      )
                    )
                      void act("disconnect", disconnectSheets, "Google Sheets disconnected.");
                  }}
                  className="text-sm text-muted hover:text-danger-text"
                >
                  Disconnect
                </button>
              </>
            )}
          </div>
          <p className="mt-1.5 text-tiny text-muted">
            {gs.available
              ? "Import leads from a sheet and keep them in sync every hour. View-only access: SuperSaaS never edits your sheets."
              : "Not available on this server yet (Google OAuth credentials missing)."}
          </p>

          {syncs.length > 0 && (
            <ul className="mt-3 divide-y divide-line rounded border border-line bg-surface">
              {syncs.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <a
                      href={`https://docs.google.com/spreadsheets/d/${s.spreadsheet_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-ink hover:text-accent"
                    >
                      {s.spreadsheet_title}
                    </a>
                    <span className="text-muted"> › {s.sheet_title}</span>
                    <div className="text-tiny text-muted">
                      {s.last_status === "error" ? (
                        <span className="text-danger-text">{s.last_error}</span>
                      ) : s.last_synced_at ? (
                        <>
                          Synced {timeAgo(s.last_synced_at)}
                          {s.job_status === "completed" &&
                            ` · ${s.job_imported} new, ${s.job_updated} updated, ${s.job_skipped} skipped`}
                        </>
                      ) : (
                        "Not synced yet"
                      )}
                    </div>
                  </div>
                  {canManage && (
                    <>
                      <label className="flex items-center gap-1.5 text-tiny text-muted">
                        <input
                          type="checkbox"
                          checked={s.enabled}
                          disabled={!gs.connected || busy === s.id}
                          onChange={(e) => {
                            const enabled = e.target.checked;
                            // optimistic; act() reloads the truth (and rolls back on error)
                            setSyncs((all) =>
                              all.map((x) => (x.id === s.id ? { ...x, enabled } : x)),
                            );
                            void act(s.id, () => setSheetSyncEnabled(s.id, enabled));
                          }}
                        />
                        Hourly
                      </label>
                      <button
                        title="Sync now"
                        disabled={!gs.connected || busy === `run-${s.id}`}
                        onClick={() =>
                          void act(`run-${s.id}`, () => runSheetSync(s.id), "Sync started.")
                        }
                        className="text-faint hover:text-accent disabled:opacity-40"
                      >
                        <RefreshCw size={14} className={busy === `run-${s.id}` ? "animate-spin" : ""} />
                      </button>
                      <button
                        title="Stop syncing (keeps imported leads)"
                        onClick={() => {
                          if (window.confirm("Stop syncing this sheet? Leads already imported stay."))
                            void act(s.id, () => deleteSheetSync(s.id), "Sheet removed.");
                        }}
                        className="text-faint hover:text-danger-text"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Amazon SES */}
        <div className={`${card} opacity-70`}>
          <div className="flex items-center gap-2">
            <Cloud size={16} className="text-faint" />
            <span className="font-medium text-ink">Amazon SES</span>
            <Status on={false} label="Needs AWS setup" />
          </div>
          <p className="mt-1.5 text-tiny text-muted">
            High-volume sending from your own domain, with automatic bounce and
            complaint handling. Turns on once the AWS account is set up.
          </p>
        </div>
      </div>
    </section>
  );
}

/** Result of "Connect Google Sheets" (/settings?sheets=connected|error). */
function SheetsConnectResult() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const result = params.get("sheets");
  if (!result) return null;
  const ok = result !== "error";
  const text = ok
    ? `Google Sheets ${result === "reconnected" ? "reconnected" : "connected"}: ${params.get("email") ?? ""}.`
    : params.get("reason") || "Connecting Google Sheets failed.";
  return (
    <div
      className={`mb-4 flex items-start gap-3 rounded-lg border px-3 py-2 text-sm ${
        ok
          ? "border-success-text/30 bg-success-bg text-success-text"
          : "border-danger-text/30 bg-danger-bg text-danger-text"
      }`}
    >
      <span className="flex-1">{text}</span>
      <button onClick={() => router.replace(pathname)} title="Dismiss" className="opacity-70 hover:opacity-100">
        <X size={14} />
      </button>
    </div>
  );
}
