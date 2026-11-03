"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Download, ShieldCheck, Trash2 } from "lucide-react";
import { errorMessage, logout } from "@/lib/api";
import { HelpLink } from "@/components/help-link";
import { getMe } from "@/lib/me";
import { deleteAccount, deleteWorkspace, exportWorkspace, getOrg } from "@/lib/org";
import { disconnectLive } from "@/lib/realtime";

const field =
  "w-full rounded border border-line-mid bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft2";

/** Export + irreversible deletions (GDPR access/erasure). */
export function PrivacySection() {
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([getMe(), getOrg()]).then(([me, org]) => {
      setRole(me.role);
      setOrgName(org.name);
    });
  }, []);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const download = () =>
    run("export", async () => {
      const data = await exportWorkspace();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `workspace-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });

  const goodbye = () => {
    disconnectLive();
    void logout().then(() => router.replace("/"));
  };

  if (!role) return null;
  const admin = role === "admin";

  return (
    <section id="privacy" className="rounded-lg border border-line bg-surface p-5">
      <div className="mb-1 flex items-center gap-2">
        <ShieldCheck size={16} className="text-faint" />
        <h2 className="text-section font-semibold text-ink2">Data & privacy</h2>
        <HelpLink slug="privacy-data" />
      </div>
      <p className="mb-4 text-sm text-muted">
        Export your data or permanently delete it. To erase one person, open the lead
        and choose <b>Forget</b>.
      </p>

      {err && <p className="mb-3 text-sm text-danger-text">{err}</p>}

      <div className="space-y-4">
        {admin && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3">
            <div>
              <div className="text-sm font-medium text-ink">Export workspace data</div>
              <div className="text-tiny text-muted">
                Leads, campaigns, templates, conversations, members and suppression list as JSON.
              </div>
            </div>
            <button
              onClick={() => void download()}
              disabled={busy === "export"}
              className="flex items-center gap-1.5 rounded border border-line-mid px-3 py-1.5 text-sm text-ink hover:bg-hover disabled:opacity-60"
            >
              <Download size={14} /> {busy === "export" ? "Preparing…" : "Download JSON"}
            </button>
          </div>
        )}

        {admin && (
          <div className="rounded-md border border-danger-bg p-3">
            <div className="text-sm font-medium text-danger-text">Delete workspace</div>
            <p className="mt-0.5 text-tiny text-muted">
              Permanently deletes <b>{orgName}</b> and everything in it for every member.
              Members with no other workspace lose their accounts. This cannot be undone.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                className={`${field} max-w-xs`}
                placeholder={`Type "${orgName}" to confirm`}
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
              />
              <button
                onClick={() =>
                  void run("ws", async () => {
                    await deleteWorkspace(confirmName);
                    goodbye();
                  })
                }
                disabled={confirmName !== orgName || busy === "ws"}
                className="flex items-center gap-1.5 rounded bg-danger-text px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                <Trash2 size={14} /> Delete workspace
              </button>
            </div>
          </div>
        )}

        <div className="rounded-md border border-danger-bg p-3">
          <div className="text-sm font-medium text-danger-text">Delete my account</div>
          <p className="mt-0.5 text-tiny text-muted">
            Removes your account and personal data. Workspaces where you&apos;re the only member
            are deleted too. If you&apos;re the only admin of a shared workspace, make someone
            else admin first.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              type="password"
              className={`${field} max-w-xs`}
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button
              onClick={() =>
                void run("me", async () => {
                  if (!window.confirm("Permanently delete your account?")) return;
                  await deleteAccount(password);
                  goodbye();
                })
              }
              disabled={!password || busy === "me"}
              className="flex items-center gap-1.5 rounded bg-danger-text px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              <Trash2 size={14} /> Delete my account
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
