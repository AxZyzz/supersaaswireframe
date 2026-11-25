"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Lock } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { toast } from "@/components/feedback";
import { ClockSelect, WindowEditor } from "@/components/window-editor";
import {
  Campaign,
  describeSendWindow,
  SendWindow,
  updateCampaign,
} from "@/lib/campaigns";
import { getOrg } from "@/lib/org";

const DEFAULT_WINDOW: SendWindow = {
  days: [1, 2, 3, 4, 5],
  startHour: 9,
  endHour: 17,
  tzBasis: "recipient",
};

/**
 * "Only send inside a window" for one campaign (Learning Loop T17). A step that
 * comes due outside the window is not dropped: it waits for the next opening and
 * is spread across it. No window = sends whenever a step is due, as before.
 */
export function SendWindowPanel({
  campaign,
  canManage,
  frozen,
  onSaved,
}: {
  campaign: Pick<Campaign, "id" | "send_window">;
  canManage: boolean;
  /** A test is running: the window is part of the test design. */
  frozen: boolean;
  onSaved?: () => void;
}) {
  const saved = campaign.send_window;
  const [on, setOn] = useState(!!saved);
  const [win, setWin] = useState<SendWindow>(saved ?? DEFAULT_WINDOW);
  const [busy, setBusy] = useState(false);
  const [workspaceZone, setWorkspaceZone] = useState<string | undefined>();

  useEffect(() => {
    let live = true;
    void getOrg()
      .then((o) => live && setWorkspaceZone(o.timezone))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const dirty =
    on !== !!saved || (on && JSON.stringify(win) !== JSON.stringify(saved ?? DEFAULT_WINDOW));
  const locked = !canManage || frozen || busy;

  async function save() {
    setBusy(true);
    try {
      await updateCampaign(campaign.id, { sendWindow: on ? win : null });
      toast(on ? "Send window saved." : "Send window removed: this campaign sends whenever a step is due.");
      onSaved?.();
    } catch (e) {
      toast(errorMessage(e, "Could not save the send window."), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-line bg-panel p-3.5" data-testid="send-window-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarClock size={15} className="text-accent" />
          <span className="text-sm font-semibold text-ink2">Send window</span>
          {frozen && (
            <span className="inline-flex items-center gap-1 rounded bg-accent-soft px-2 py-0.5 text-tiny text-accent">
              <Lock size={11} /> Frozen while a test runs
            </span>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={on}
            disabled={locked}
            onChange={(e) => setOn(e.target.checked)}
            aria-label="Only send inside a window"
          />
          Only send inside a window
        </label>
      </div>

      <p className="mt-1.5 text-tiny text-muted">
        {on
          ? "An email that comes due outside the window waits for the next opening and goes out spread across it, not all at once. Your sender limits and warm-up still apply."
          : "No window: every step is sent as soon as it is due, at any hour or day."}
      </p>

      {on && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <WindowEditor value={win} onChange={setWin} disabled={locked} label="Send window" />
          <ClockSelect
            value={win.tzBasis}
            onChange={(tzBasis) => setWin({ ...win, tzBasis })}
            disabled={locked}
            workspaceZone={workspaceZone}
          />
        </div>
      )}
      {on && win.tzBasis === "recipient" && (
        <p className="mt-2 text-tiny text-muted">
          If we don&apos;t know a person&apos;s timezone we use the workspace timezone
          {workspaceZone ? ` (${workspaceZone})` : ""}. You can change it in Settings.
        </p>
      )}

      {canManage && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={locked || !dirty}
            onClick={() => void save()}
            className="rounded bg-accent px-3 py-1.5 text-tiny font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Save window
          </button>
          {saved && !dirty && (
            <span className="text-tiny text-muted">Saved: {describeSendWindow(saved)}</span>
          )}
        </div>
      )}
    </div>
  );
}
