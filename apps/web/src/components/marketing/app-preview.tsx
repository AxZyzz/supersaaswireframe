import {
  BarChart3,
  Inbox,
  LayoutDashboard,
  Send,
  Sparkles,
  Users,
} from "lucide-react";

/** Static, illustrative mock of the app (sample data) for the public pages.
 *  `view` picks which screen the frame shows next to each feature. */
export function AppPreview({
  view = "dashboard",
}: {
  view?: "dashboard" | "ai" | "inbox" | "analytics";
}) {
  return (
    <div
      className="overflow-hidden rounded-lg border border-line bg-white shadow-float"
      aria-hidden="true"
    >
      <div className="flex items-center gap-1.5 border-b border-line bg-panel px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-line-faint" />
        <span className="h-2.5 w-2.5 rounded-full bg-line-faint" />
        <span className="h-2.5 w-2.5 rounded-full bg-line-faint" />
        <span className="ml-2 text-micro text-faint">sample workspace</span>
      </div>
      <div className="flex">
        <div className="hidden w-32 shrink-0 space-y-1 border-r border-line bg-sidebar p-2 sm:block">
          {[
            [LayoutDashboard, "Dashboard", "dashboard"],
            [Users, "Leads", ""],
            [Send, "Campaigns", "ai"],
            [Inbox, "Inbox", "inbox"],
            [BarChart3, "Analytics", "analytics"],
          ].map(([Icon, label, v]) => {
            const I = Icon as typeof Users;
            const active = v === view;
            return (
              <div
                key={label as string}
                className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-[10px] ${
                  active ? "bg-accent-soft font-medium text-accent" : "text-muted"
                }`}
              >
                <I size={11} /> {label as string}
              </div>
            );
          })}
        </div>
        <div className="min-w-0 flex-1 p-3">
          {view === "dashboard" && <DashboardView />}
          {view === "ai" && <AiView />}
          {view === "inbox" && <InboxView />}
          {view === "analytics" && <AnalyticsView />}
        </div>
      </div>
    </div>
  );
}

function Stat({ l, v }: { l: string; v: string }) {
  return (
    <div className="rounded border border-line p-2">
      <div className="text-[9px] text-muted">{l}</div>
      <div className="text-sm font-semibold text-ink2">{v}</div>
    </div>
  );
}

const Pill = ({ tone, children }: { tone: string; children: React.ReactNode }) => (
  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${tone}`}>{children}</span>
);

function DashboardView() {
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-2">
        <Stat l="Leads" v="4,812" />
        <Stat l="Sent (7d)" v="1,240" />
        <Stat l="Reply rate" v="6.8%" />
      </div>
      <div className="rounded border border-line p-2">
        <div className="flex h-16 items-end gap-1.5">
          {[40, 64, 52, 78, 60, 88, 70].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm bg-accent-soft2"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      </div>
      {[
        ["Q4 agency push", "Active", "bg-success-bg text-success-text"],
        ["SaaS founders", "Scheduled", "bg-warning-bg text-warning-text"],
      ].map(([n, s, t]) => (
        <div key={n} className="flex items-center justify-between rounded border border-line px-2 py-1.5">
          <span className="text-[11px] text-ink">{n}</span>
          <Pill tone={t}>{s}</Pill>
        </div>
      ))}
    </div>
  );
}

function AiView() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink2">
        <Sparkles size={12} className="text-accent" /> AI sequence · 3 steps
      </div>
      {[
        ["Day 0", "Quick idea for {{company}}'s outbound"],
        ["Day 3", "Following up — worth a look?"],
        ["Day 7", "Closing the loop"],
      ].map(([d, s]) => (
        <div key={d} className="rounded border border-line p-2">
          <div className="text-[9px] text-faint">{d}</div>
          <div className="text-[11px] font-medium text-ink">{s}</div>
          <div className="mt-1 h-1.5 w-4/5 rounded bg-hover" />
          <div className="mt-1 h-1.5 w-3/5 rounded bg-hover" />
        </div>
      ))}
    </div>
  );
}

function InboxView() {
  return (
    <div className="space-y-1.5">
      {[
        ["Anita S.", "Sounds good — can we talk Tuesday?", "Interested", "bg-success-bg text-success-text"],
        ["Marcus L.", "What does pricing look like?", "Question", "bg-accent-soft text-accent"],
        ["Priya N.", "Out of office until Monday", "Out of office", "bg-warning-bg text-warning-text"],
        ["Tom R.", "Not a fit for us right now", "Not interested", "bg-hover text-muted"],
      ].map(([n, m, c, t]) => (
        <div key={n} className="rounded border border-line px-2 py-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-ink">{n}</span>
            <Pill tone={t}>{c}</Pill>
          </div>
          <div className="truncate text-[10px] text-muted">{m}</div>
        </div>
      ))}
    </div>
  );
}

function AnalyticsView() {
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-2">
        <Stat l="Open" v="48%" />
        <Stat l="Click" v="9.1%" />
        <Stat l="Reply" v="6.8%" />
      </div>
      {[
        ["Sent", 100],
        ["Opened", 48],
        ["Clicked", 9],
        ["Replied", 7],
      ].map(([l, w]) => (
        <div key={l as string} className="flex items-center gap-2">
          <span className="w-12 text-[10px] text-muted">{l}</span>
          <div className="h-2.5 flex-1 rounded bg-hover">
            <div className="h-full rounded bg-accent" style={{ width: `${w as number}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
