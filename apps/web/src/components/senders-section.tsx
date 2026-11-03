"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  Mail,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  createSender,
  deleteSender,
  DnsCheckResult,
  dnsCheck,
  listSenders,
  Sender,
  testSender,
  verifySender,
  updateSender,
  gmailConnect,
  gmailStatus,
} from "@/lib/senders";
import { errorMessage } from "@/lib/api";
import { HelpLink } from "@/components/help-link";

// Gmail isn't added by hand: it connects through Google sign-in (T3.3).
type Provider = "ses" | "smtp";

export function SendersSection({
  showDnsCheck = true,
  readOnly = false,
}: {
  /** Onboarding has its own domain step, so it hides the inline checker. */
  showDnsCheck?: boolean;
  /** Agents can see senders but not add, verify, test or delete them. */
  readOnly?: boolean;
} = {}) {
  const [senders, setSenders] = useState<Sender[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [provider, setProvider] = useState<Provider>("ses");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [gmailEnabled, setGmailEnabled] = useState(false);

  // `loading` starts true; reloads keep the table on screen instead of
  // flashing "Loading…".
  const load = useCallback(async () => {
    try {
      setSenders(await listSenders());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    gmailStatus()
      .then((r) => setGmailEnabled(r.enabled))
      .catch(() => setGmailEnabled(false));
  }, []);

  async function connectGmail() {
    setBusyId("gmail");
    setNote(null);
    try {
      const { url } = await gmailConnect();
      window.location.assign(url);
    } catch (e) {
      setNote({ ok: false, text: errorMessage(e, "Couldn't start Gmail sign-in.") });
      setBusyId(null);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await createSender({
      provider,
      fromName: String(f.get("fromName")),
      fromEmail: String(f.get("fromEmail")),
      dailyLimit: Number(f.get("dailyLimit")) || undefined,
      smtp:
        provider === "smtp"
          ? {
              host: String(f.get("host")),
              port: Number(f.get("port")) || 587,
              secure: f.get("secure") === "on",
              user: String(f.get("user")),
              pass: String(f.get("pass")),
            }
          : undefined,
    });
    setAdding(false);
    setProvider("ses");
    await load();
  }

  async function verify(id: string) {
    setBusyId(id);
    setNote(null);
    try {
      const r = await verifySender(id);
      setNote({ ok: r.ok, text: r.detail });
    } catch {
      setNote({ ok: false, text: "Verification request failed." });
    }
    setBusyId(null);
    await load();
  }

  async function test(id: string) {
    const to = window.prompt("Send a test email to:");
    if (!to) return;
    setBusyId(id);
    setNote(null);
    try {
      const r = await testSender(id, to);
      setNote({ ok: true, text: `Sent (${r.provider}) — id ${r.messageId}` });
    } catch {
      setNote({ ok: false, text: "Test send failed — verify the sender first." });
    }
    setBusyId(null);
  }

  const field =
    "rounded border border-line-mid bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent";

  return (
    <section id="senders" className="rounded-lg border border-line bg-surface p-5">
      <div className="mb-1 flex items-center gap-2">
        <Mail size={16} className="text-faint" />
        <h2 className="text-section font-semibold text-ink2">
          Sender accounts
        </h2>
        <HelpLink slug="senders" />
        <div className="flex-1" />
        {!readOnly && gmailEnabled && (
          <button
            onClick={() => void connectGmail()}
            disabled={busyId === "gmail"}
            className="flex items-center gap-1.5 rounded border border-line-mid px-3 py-1.5 text-sm font-medium text-ink2 hover:bg-panel disabled:opacity-60"
          >
            <Mail size={15} /> {busyId === "gmail" ? "Opening Google…" : "Connect Gmail"}
          </button>
        )}
        {!readOnly && (
          <button
            onClick={() => setAdding((v) => !v)}
            className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
          >
            <Plus size={15} /> Add sender
          </button>
        )}
      </div>
      <p className="mb-4 text-sm text-muted">
        The identities campaigns send from. SMTP verifies immediately; Gmail
        connects by signing in with Google; SES connects once it&apos;s enabled.
      </p>

      <Suspense fallback={null}>
        <GmailConnectResult />
      </Suspense>

      {adding && (
        <form
          onSubmit={add}
          className="mb-4 flex flex-col gap-2 rounded-lg border border-line bg-panel p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <select
              name="provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
              className={field}
            >
              <option value="ses">SES</option>
              <option value="smtp">SMTP</option>
            </select>
            <input
              name="fromName"
              required
              placeholder="From name"
              className={field}
            />
            <input
              name="fromEmail"
              type="email"
              required
              placeholder="from@domain.com"
              className={field}
            />
            <input
              name="dailyLimit"
              type="number"
              placeholder="Daily limit"
              className={`${field} w-28`}
            />
          </div>

          {provider === "smtp" && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
              <input
                name="host"
                required
                placeholder="smtp.host.com"
                className={field}
              />
              <input
                name="port"
                type="number"
                defaultValue={587}
                placeholder="Port"
                className={`${field} w-24`}
              />
              <label className="flex items-center gap-1.5 text-sm text-muted">
                <input name="secure" type="checkbox" /> TLS
              </label>
              <input
                name="user"
                required
                placeholder="SMTP user"
                className={field}
              />
              <input
                name="pass"
                type="password"
                required
                placeholder="SMTP password"
                className={field}
              />
            </div>
          )}

          <div>
            <button className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover">
              Add
            </button>
          </div>
        </form>
      )}

      {note && (
        <div
          className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
            note.ok
              ? "border-success-text/30 bg-success-bg text-success-text"
              : "border-danger-text/30 bg-danger-bg text-danger-text"
          }`}
        >
          {note.text}
        </div>
      )}

      <div className="mb-6 overflow-hidden rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-panel text-left text-tiny uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5 font-medium">From</th>
              <th className="px-4 py-2.5 font-medium">Provider</th>
              <th className="px-4 py-2.5 font-medium">Daily</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  Loading…
                </td>
              </tr>
            ) : senders.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  No sender accounts yet.
                </td>
              </tr>
            ) : (
              senders.map((s) => (
                <tr key={s.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-ink">{s.from_name}</div>
                    <div className="text-tiny text-muted">{s.from_email}</div>
                  </td>
                  <td className="px-4 py-2.5 uppercase text-muted">
                    {s.provider}
                  </td>
                  <td className="px-4 py-2.5 text-muted">
                    <div>
                      {s.effective_daily_limit}
                      {s.effective_daily_limit < s.daily_limit && (
                        <span className="text-faint"> / {s.daily_limit}</span>
                      )}
                    </div>
                    {s.warmup_day !== null ? (
                      <div className="text-tiny text-warning-text" title="New mailboxes ramp 20 → 50 → 100/day over 30 days to build reputation">
                        Warming up · day {s.warmup_day}
                        {!readOnly && (
                          <button
                            onClick={() =>
                              void updateSender(s.id, { warmupEnabled: false }).then(load)
                            }
                            className="ml-1.5 text-faint underline hover:text-ink"
                          >
                            skip
                          </button>
                        )}
                      </div>
                    ) : (
                      !s.warmup_enabled &&
                      !readOnly && (
                        <button
                          onClick={() =>
                            void updateSender(s.id, {
                              warmupEnabled: true,
                              restartWarmup: true,
                            }).then(load)
                          }
                          className="text-tiny text-faint underline hover:text-ink"
                        >
                          start warm-up
                        </button>
                      )
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-tiny capitalize ${
                        s.status === "verified"
                          ? "bg-success-bg text-success-text"
                          : "bg-warning-bg text-warning-text"
                      }`}
                    >
                      {s.status}
                    </span>
                    {s.provider === "gmail" &&
                      s.status !== "verified" &&
                      gmailEnabled &&
                      !readOnly && (
                        <button
                          onClick={() => void connectGmail()}
                          className="ml-2 text-tiny text-faint underline hover:text-ink"
                        >
                          reconnect
                        </button>
                      )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div
                      className={`flex items-center justify-end gap-3 ${readOnly ? "hidden" : ""}`}
                    >
                      <button
                        onClick={() => void verify(s.id)}
                        disabled={busyId === s.id}
                        title="Verify connection"
                        className="text-faint hover:text-accent disabled:opacity-40"
                      >
                        <ShieldCheck size={15} />
                      </button>
                      <button
                        onClick={() => void test(s.id)}
                        disabled={busyId === s.id}
                        title="Send test email"
                        className="text-faint hover:text-accent disabled:opacity-40"
                      >
                        <Send size={15} />
                      </button>
                      <button
                        onClick={async () => {
                          await deleteSender(s.id);
                          await load();
                        }}
                        title="Delete"
                        className="text-faint hover:text-danger-text"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showDnsCheck && <DnsCheckTool />}
    </section>
  );
}

function DnsCheckTool() {
  const [domain, setDomain] = useState("");
  const [result, setResult] = useState<DnsCheckResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!domain.trim()) return;
    setBusy(true);
    try {
      setResult(await dnsCheck(domain.trim()));
    } finally {
      setBusy(false);
    }
  }

  const row = (label: string, c: DnsCheckResult["spf"]) => (
    <div className="flex items-start gap-2 border-t border-line py-2 text-sm">
      <span className="w-16 font-medium text-ink">{label}</span>
      {c.found ? (
        <Check size={15} className="mt-0.5 shrink-0 text-success-text" />
      ) : (
        <X size={15} className="mt-0.5 shrink-0 text-danger-text" />
      )}
      <span className="text-muted">{c.detail}</span>
    </div>
  );

  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <h3 className="mb-1 text-sm font-semibold text-ink2">
        Domain authentication check
      </h3>
      <p className="mb-3 text-tiny text-muted">
        Verify SPF, DKIM, and DMARC before sending — protects deliverability.
      </p>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
          />
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void run()}
            placeholder="yourdomain.com"
            className="w-full rounded border border-line-mid bg-surface px-2.5 py-1.5 pl-8 text-sm outline-none focus:border-accent"
          />
        </div>
        <button
          onClick={() => void run()}
          disabled={busy}
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
        >
          {busy ? "Checking…" : "Check"}
        </button>
      </div>
      {result && (
        <div className="mt-3 rounded border border-line bg-surface px-3">
          {row("SPF", result.spf)}
          {row("DKIM", result.dkim)}
          {row("DMARC", result.dmarc)}
        </div>
      )}
    </div>
  );
}

/**
 * Shows how "Connect Gmail" went. Google redirects back to
 * /settings?gmail=connected|reconnected|error (see GET /auth/google/callback).
 */
function GmailConnectResult() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const result = params.get("gmail");
  if (!result) return null;
  const ok = result !== "error";
  const text = ok
    ? `Gmail ${result === "reconnected" ? "reconnected" : "connected"}: ${params.get("email") ?? ""}. It's verified and ready to send.`
    : params.get("reason") || "Connecting Gmail failed.";
  return (
    <div
      className={`mb-4 flex items-start gap-3 rounded-lg border px-3 py-2 text-sm ${
        ok
          ? "border-success-text/30 bg-success-bg text-success-text"
          : "border-danger-text/30 bg-danger-bg text-danger-text"
      }`}
    >
      <span className="flex-1">{text}</span>
      <button
        onClick={() => router.replace(pathname)}
        title="Dismiss"
        className="opacity-70 hover:opacity-100"
      >
        <X size={14} />
      </button>
    </div>
  );
}
