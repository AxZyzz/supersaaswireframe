"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, Trash2, UserPlus, Users } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { timeAgo } from "@/lib/analytics";
import {
  changeRole,
  createInvite,
  CreatedInvite,
  inviteLink,
  listInvites,
  listTeam,
  PendingInvite,
  removeMember,
  revokeInvite,
  Role,
  ROLE_META,
  TeamMember,
} from "@/lib/team";
import { HelpLink } from "@/components/help-link";
import { useLive } from "@/lib/realtime";

const ROLES = Object.keys(ROLE_META) as Role[];

const field =
  "rounded border border-line-mid bg-white px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft2";

export function TeamSection() {
  const [me, setMe] = useState<{ userId: string; role: Role } | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("agent");
  const [fresh, setFresh] = useState<CreatedInvite | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isAdmin = me?.role === "admin";

  const load = useCallback(async (admin: boolean) => {
    const [m, i] = await Promise.all([
      listTeam(),
      admin ? listInvites() : Promise.resolve([]),
    ]);
    setMembers(m);
    setInvites(i);
  }, []);

  useEffect(() => {
    void api<{ userId: string; role: Role }>("/auth/me").then((m) => {
      setMe(m);
      // agents can't list the team; the section explains instead
      if (m.role !== "agent") void load(m.role === "admin");
    });
  }, [load]);

  // Live: joins, role changes and removals by other admins.
  useLive("team", () => {
    if (me && me.role !== "agent") void load(me.role === "admin");
  });

  async function run(fn: () => Promise<unknown>) {
    setErr(null);
    try {
      await fn();
      await load(isAdmin);
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  async function invite() {
    if (!email.trim()) return;
    setBusy(true);
    await run(async () => {
      setFresh(await createInvite(email.trim(), role));
      setEmail("");
      setCopied(false);
    });
    setBusy(false);
  }

  function copy(text: string) {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!me) return null;

  return (
    <section id="team" className="rounded-lg border border-line bg-white p-5">
      <div className="mb-1 flex items-center gap-2">
        <Users size={16} className="text-faint" />
        <h2 className="text-section font-semibold text-ink2">Team</h2>
        <HelpLink slug="team" />
      </div>
      <p className="mb-4 text-sm text-muted">
        {me.role === "agent"
          ? "Ask a workspace admin to invite teammates or change roles."
          : isAdmin
            ? "Invite teammates by link and manage their access. Changes apply immediately."
            : "Your workspace members. Only admins can invite or change roles."}
      </p>

      {isAdmin && (
        <div className="mb-5 rounded-md border border-line bg-panel p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="email"
              placeholder="teammate@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void invite()}
              className={`${field} min-w-0 flex-1`}
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className={field}
              title={ROLE_META[role].desc}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_META[r].label}
                </option>
              ))}
            </select>
            <button
              onClick={() => void invite()}
              disabled={busy || !email.trim()}
              className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
            >
              <UserPlus size={14} /> Create invite link
            </button>
          </div>
          <p className="mt-1.5 text-tiny text-faint">{ROLE_META[role].desc}.</p>

          {fresh && (
            <div className="mt-3 rounded border border-accent-soft2 bg-white p-2.5">
              <p className="mb-1.5 text-tiny text-muted">
                Send this link to <span className="font-medium text-ink">{fresh.email}</span>.
                It works once and expires in 7 days — copy it now, it won&apos;t be shown again.
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-panel px-2 py-1 text-tiny text-ink">
                  {inviteLink(fresh.token)}
                </code>
                <button
                  onClick={() => copy(inviteLink(fresh.token))}
                  className="flex shrink-0 items-center gap-1 rounded border border-line-mid px-2 py-1 text-tiny text-ink hover:bg-hover"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {err && <p className="mb-3 text-sm text-danger-text">{err}</p>}

      {me.role !== "agent" && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-tiny text-faint">
              <th className="py-2 font-medium">Member</th>
              <th className="py-2 font-medium">Role</th>
              <th className="py-2 font-medium">Joined</th>
              {isAdmin && <th className="py-2" />}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const self = m.user_id === me.userId;
              return (
                <tr key={m.user_id} className="border-b border-line last:border-0">
                  <td className="py-2.5">
                    <div className="font-medium text-ink">
                      {m.name}
                      {self && <span className="ml-1.5 text-tiny text-faint">(you)</span>}
                    </div>
                    <div className="text-tiny text-muted">{m.email}</div>
                  </td>
                  <td className="py-2.5">
                    {isAdmin ? (
                      <select
                        value={m.role}
                        onChange={(e) =>
                          void run(() => changeRole(m.user_id, e.target.value as Role))
                        }
                        className={`${field} py-1`}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_META[r].label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="capitalize text-muted">{m.role}</span>
                    )}
                  </td>
                  <td className="py-2.5 text-tiny text-muted">{timeAgo(m.created_at)}</td>
                  {isAdmin && (
                    <td className="py-2.5 text-right">
                      {!self && (
                        <button
                          onClick={() => {
                            if (window.confirm(`Remove ${m.name} from the workspace?`)) {
                              void run(() => removeMember(m.user_id));
                            }
                          }}
                          className="rounded p-1.5 text-faint hover:bg-hover hover:text-danger-text"
                          aria-label={`Remove ${m.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {isAdmin && invites.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-tiny font-medium uppercase tracking-wide text-faint">
            Pending invites
          </h3>
          <ul className="space-y-1.5">
            {invites.map((i) => (
              <li
                key={i.id}
                className="flex items-center justify-between rounded border border-line px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Link2 size={14} className="shrink-0 text-faint" />
                  <span className="truncate text-sm text-ink">{i.email}</span>
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-micro font-medium text-accent">
                    {ROLE_META[i.role].label}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-tiny text-faint">
                    expires {new Date(i.expires_at).toLocaleDateString()}
                  </span>
                  <button
                    onClick={() => void run(() => revokeInvite(i.id))}
                    className="text-tiny text-muted hover:text-danger-text"
                  >
                    Revoke
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
