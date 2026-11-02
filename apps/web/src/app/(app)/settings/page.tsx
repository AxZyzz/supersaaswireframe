"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import {
  ApiKey,
  createApiKey,
  CreatedApiKey,
  listApiKeys,
  revokeApiKey,
} from "@/lib/api-keys";
import { SendersSection } from "@/components/senders-section";
import { KnowledgeSection } from "@/components/knowledge-section";
import { WorkspaceSection } from "@/components/workspace-section";
import { TeamSection } from "@/components/team-section";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function SettingsPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setKeys(await listApiKeys());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    const created = await createApiKey(name.trim());
    setFresh(created);
    setName("");
    setCreating(false);
    await load();
  }
  async function revoke(id: string) {
    await revokeApiKey(id);
    await load();
  }
  function copy(text: string) {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const field =
    "rounded border border-line-mid bg-white px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft2";

  return (
    <div className="mx-auto max-w-shell space-y-6">
      <div>
        <h1 className="text-title font-semibold text-ink2">Settings</h1>
        <p className="text-sm text-muted">
          Workspace profile, branding, team, senders, AI knowledge and API access.
        </p>
      </div>

      <WorkspaceSection />

      <TeamSection />

      <SendersSection />

      <KnowledgeSection />

      <section className="rounded-lg border border-line bg-white p-5">
        <div className="mb-1 flex items-center gap-2">
          <KeyRound size={16} className="text-faint" />
          <h2 className="text-section font-semibold text-ink2">API keys</h2>
        </div>
        <p className="mb-4 text-sm text-muted">
          Push leads into SuperSaaS from external systems. Send the key as an{" "}
          <code className="rounded bg-panel px-1">X-Api-Key</code> header to{" "}
          <code className="rounded bg-panel px-1">POST {API_URL}/v1/leads</code>.
        </p>

        {/* one-time reveal of a freshly created key */}
        {fresh && (
          <div className="mb-4 rounded-lg border border-accent-soft2 bg-accent-soft p-3">
            <p className="mb-2 text-sm font-medium text-ink2">
              Copy your new key now — it won&apos;t be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-white px-2.5 py-1.5 text-sm">
                {fresh.key}
              </code>
              <button
                onClick={() => copy(fresh.key)}
                className="flex items-center gap-1 rounded bg-accent px-2.5 py-1.5 text-sm text-white hover:bg-accent-hover"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                onClick={() => setFresh(null)}
                className="rounded border border-line-mid px-2.5 py-1.5 text-sm"
              >
                Done
              </button>
            </div>
          </div>
        )}

        <div className="mb-4 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
            placeholder="Key name (e.g. Zapier)"
            className={`${field} w-64`}
          />
          <button
            onClick={() => void create()}
            disabled={creating || !name.trim()}
            className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            <Plus size={15} /> Create key
          </button>
        </div>

        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-panel text-left text-tiny uppercase tracking-wide text-faint">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Key</th>
                <th className="px-4 py-2.5 font-medium">Last used</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted">
                    Loading…
                  </td>
                </tr>
              ) : keys.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted">
                    No API keys yet.
                  </td>
                </tr>
              ) : (
                keys.map((k) => (
                  <tr
                    key={k.id}
                    className="border-b border-line last:border-0"
                  >
                    <td className="px-4 py-2.5 font-medium text-ink">
                      {k.name}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-muted">
                      {k.prefix}…
                    </td>
                    <td className="px-4 py-2.5 text-tiny text-faint">
                      {k.last_used_at
                        ? new Date(k.last_used_at).toLocaleString()
                        : "never"}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end">
                        <button
                          onClick={() => void revoke(k.id)}
                          title="Revoke"
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
      </section>
    </div>
  );
}
