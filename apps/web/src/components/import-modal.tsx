"use client";

import Papa from "papaparse";
import { useEffect, useState } from "react";
import { FileSpreadsheet, Upload, X } from "lucide-react";
import { errorMessage } from "@/lib/api";
import {
  connectSheets,
  createSheetSync,
  getIntegrations,
  IntegrationsOverview,
  previewSheet,
  SheetPreview,
} from "@/lib/integrations";
import {
  getImportStatus,
  IMPORTABLE_FIELDS,
  ImportJob,
  uploadImport,
} from "@/lib/leads";
import { isExcel, xlsxToCsvFile } from "@/lib/xlsx-to-csv";

type Stage = "pick" | "map" | "running" | "done";
export type ImportSource = "file" | "sheet";

const field =
  "rounded border border-line-mid bg-surface px-2 py-1 text-sm outline-none focus:border-accent";

/** Auto-map columns whose header matches a lead field name. */
function guessMapping(cols: string[]): Record<string, string> {
  const guess: Record<string, string> = {};
  for (const col of cols) {
    const norm = col.toLowerCase().replace(/[^a-z]/g, "");
    const hit = IMPORTABLE_FIELDS.find(
      (f) => f.toLowerCase() === norm || norm.includes(f.toLowerCase()),
    );
    if (hit) guess[col] = hit;
  }
  return guess;
}

/** Column → lead field pickers, shared by file and Google Sheet imports. */
function ColumnMapper({
  headers,
  mapping,
  onChange,
}: {
  headers: string[];
  mapping: Record<string, string>;
  onChange: (m: Record<string, string>) => void;
}) {
  return (
    <div className="space-y-2">
      {headers.map((col) => (
        <div key={col} className="flex items-center gap-3">
          <span className="w-40 truncate text-sm text-ink" title={col}>
            {col}
          </span>
          <span className="text-faint">→</span>
          <select
            value={mapping[col] ?? ""}
            onChange={(e) => onChange({ ...mapping, [col]: e.target.value })}
            className={field}
          >
            <option value="">Ignore</option>
            {IMPORTABLE_FIELDS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

export function ImportModal({
  onClose,
  onImported,
  initialSource = "file",
}: {
  onClose: () => void;
  onImported: () => void;
  /** "sheet" opens on the Google Sheet tab (e.g. back from connecting). */
  initialSource?: ImportSource;
}) {
  const [source, setSource] = useState<ImportSource>(initialSource);
  const [stage, setStage] = useState<Stage>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [onDuplicate, setOnDuplicate] = useState<"skip" | "update">(
    initialSource === "sheet" ? "update" : "skip",
  );
  const [job, setJob] = useState<ImportJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Google Sheet path (T2.8)
  const [overview, setOverview] = useState<IntegrationsOverview | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [preview, setPreview] = useState<SheetPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [keepSyncing, setKeepSyncing] = useState(true);
  const [emptySheet, setEmptySheet] = useState(false);

  useEffect(() => {
    if (source !== "sheet") return;
    let live = true;
    getIntegrations()
      .then((o) => live && setOverview(o))
      .catch(() => live && setOverview(null));
    return () => {
      live = false;
    };
  }, [source]);

  function switchSource(s: ImportSource) {
    setSource(s);
    setError(null);
    setStage("pick");
    setOnDuplicate(s === "sheet" ? "update" : "skip");
  }

  async function choose(f: File) {
    setError(null);
    if (!isExcel(f)) return pick(f);
    try {
      pick(await xlsxToCsvFile(f));
    } catch (e) {
      setError(
        e instanceof Error && e.message.includes("10 MB")
          ? e.message
          : "Couldn't read that Excel file. Save it as .xlsx or CSV and try again.",
      );
    }
  }

  function pick(f: File) {
    setFile(f);
    Papa.parse<string[]>(f, {
      preview: 1,
      complete: (res) => {
        const cols = (res.data[0] as string[]) ?? [];
        setHeaders(cols);
        setMapping(guessMapping(cols));
        setStage("map");
      },
    });
  }

  async function loadSheet(tab?: string) {
    setBusy(true);
    setError(null);
    try {
      const p = await previewSheet(sheetUrl, tab);
      setPreview(p);
      setHeaders(p.headers);
      setMapping(guessMapping(p.headers));
      setStage("map");
    } catch (e) {
      setError(errorMessage(e, "Couldn't open that sheet."));
    }
    setBusy(false);
  }

  async function startConnect() {
    setBusy(true);
    try {
      const { url } = await connectSheets("/leads");
      window.location.assign(url);
    } catch (e) {
      setError(errorMessage(e, "Couldn't start Google sign-in."));
      setBusy(false);
    }
  }

  async function poll(jobId: string) {
    for (let i = 0; i < 120; i++) {
      const s = await getImportStatus(jobId);
      setJob(s);
      if (s.status === "completed" || s.status === "failed") {
        setStage("done");
        if (s.status === "completed") onImported();
        return;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  async function run() {
    const clean = Object.fromEntries(
      Object.entries(mapping).filter(([, v]) => v),
    );
    if (!Object.values(clean).includes("email")) {
      setError("Map one column to Email.");
      return;
    }
    setError(null);
    setStage("running");
    try {
      if (source === "file") {
        if (!file) return;
        const { jobId } = await uploadImport(file, clean, onDuplicate);
        await poll(jobId);
      } else {
        if (!preview) return;
        const r = await createSheetSync({
          spreadsheetId: preview.spreadsheetId,
          sheetTitle: preview.sheet,
          mapping: clean,
          onDuplicate,
          keepSyncing,
        });
        if (r.jobId) await poll(r.jobId);
        else {
          setEmptySheet(true);
          setStage("done");
        }
      }
    } catch (e) {
      setError(
        source === "file"
          ? "Upload failed. Check the file and try again."
          : errorMessage(e, "Import failed. Try again."),
      );
      setStage("map");
    }
  }

  const tab = (s: ImportSource, label: string, Icon: typeof Upload) => (
    <button
      onClick={() => switchSource(s)}
      className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-sm ${
        source === s ? "bg-surface font-medium text-ink shadow-sm" : "text-muted hover:text-ink"
      }`}
    >
      <Icon size={14} /> {label}
    </button>
  );

  const gs = overview?.googleSheets;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-lg border border-line bg-surface shadow-float">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-section font-semibold text-ink2">Import leads</h2>
          <button onClick={onClose} title="Close" className="text-faint hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-5">
          {stage === "pick" && (
            <div className="mb-4 inline-flex gap-1 rounded-lg bg-panel p-1">
              {tab("file", "File", Upload)}
              {tab("sheet", "Google Sheet", FileSpreadsheet)}
            </div>
          )}
          {(stage === "pick" || stage === "map") && error && (
            <p className="mb-3 rounded bg-danger-bg px-3 py-2 text-sm text-danger-text">{error}</p>
          )}

          {stage === "pick" && source === "file" && (
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-line-mid bg-panel py-10 text-sm text-muted hover:bg-hover">
              <span>Choose a CSV or Excel (.xlsx) file to import</span>
              <input
                type="file"
                accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && void choose(e.target.files[0])}
              />
              <span className="rounded bg-accent px-3 py-1.5 text-white">
                Select file
              </span>
            </label>
          )}

          {stage === "pick" && source === "sheet" && (
            <div className="space-y-3">
              {!overview ? (
                <p className="py-6 text-center text-sm text-muted">Loading…</p>
              ) : !gs?.available ? (
                <p className="rounded-lg border border-line bg-panel p-4 text-sm text-muted">
                  Google Sheets isn&apos;t set up on this server yet (Google OAuth
                  credentials missing).
                </p>
              ) : !gs.connected ? (
                <div className="rounded-lg border border-line bg-panel p-4 text-sm">
                  <p className="mb-3 text-muted">
                    Connect a Google account to import from its sheets. SuperSaaS only
                    asks to <b>view</b> your spreadsheets, never to change them.
                  </p>
                  <button
                    onClick={() => void startConnect()}
                    disabled={busy}
                    className="rounded bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent-hover disabled:opacity-60"
                  >
                    {busy ? "Opening Google…" : "Connect Google Sheets"}
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-tiny text-muted">
                    Connected as <b>{gs.accountEmail}</b>. The sheet must be owned by
                    or shared with that account. The first row should be the column
                    names.
                  </p>
                  <div className="flex gap-2">
                    <input
                      value={sheetUrl}
                      onChange={(e) => setSheetUrl(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && sheetUrl.trim() && void loadSheet()}
                      placeholder="https://docs.google.com/spreadsheets/d/…"
                      className={`${field} flex-1 py-1.5`}
                    />
                    <button
                      onClick={() => void loadSheet()}
                      disabled={busy || !sheetUrl.trim()}
                      className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
                    >
                      {busy ? "Loading…" : "Load sheet"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {stage === "map" && (
            <div className="space-y-3">
              {source === "sheet" && preview && (
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                  <FileSpreadsheet size={14} className="text-faint" />
                  <span className="font-medium text-ink">{preview.title}</span>
                  <select
                    value={preview.sheet}
                    onChange={(e) => void loadSheet(e.target.value)}
                    disabled={busy}
                    className={field}
                  >
                    {preview.sheets.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <span>
                    · {preview.totalRows} row{preview.totalRows === 1 ? "" : "s"}
                  </span>
                </div>
              )}
              {headers.length === 0 ? (
                <p className="text-sm text-muted">
                  This tab is empty. Add column names in the first row.
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted">
                    Map your columns to lead fields. Unmapped columns are ignored.
                  </p>
                  <ColumnMapper headers={headers} mapping={mapping} onChange={setMapping} />
                </>
              )}
              <label className="flex items-center gap-2 text-sm text-muted">
                On duplicate email
                <select
                  value={onDuplicate}
                  onChange={(e) => setOnDuplicate(e.target.value as "skip" | "update")}
                  className={field}
                >
                  <option value="skip">Skip</option>
                  <option value="update">Update</option>
                </select>
              </label>
              {source === "sheet" && (
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={keepSyncing}
                    onChange={(e) => setKeepSyncing(e.target.checked)}
                  />
                  Keep in sync: re-import new and changed rows every hour
                </label>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setStage("pick")}
                  className="rounded border border-line-mid px-3 py-1.5 text-sm"
                >
                  Back
                </button>
                <button
                  onClick={run}
                  disabled={headers.length === 0}
                  className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
                >
                  Import
                </button>
              </div>
            </div>
          )}

          {stage === "running" && (
            <p className="py-8 text-center text-sm text-muted">
              Importing… {job ? `${job.imported + job.skipped}/${job.total}` : ""}
            </p>
          )}

          {stage === "done" && (job || emptySheet) && (
            <div className="space-y-3">
              {job ? (
                <p className="text-sm text-ink">
                  Imported <b>{job.imported}</b>, updated <b>{job.updated}</b>,
                  skipped <b>{job.skipped}</b> of {job.total}.
                </p>
              ) : (
                <p className="text-sm text-ink">The sheet has no rows to import yet.</p>
              )}
              {source === "sheet" && keepSyncing && (
                <p className="text-tiny text-muted">
                  It re-syncs every hour. Manage it in Settings → Integrations.
                </p>
              )}
              {job && job.errors.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded border border-line bg-panel p-2 text-tiny text-muted">
                  {job.errors.map((e, i) => (
                    <div key={i}>
                      Row {e.row}: {e.reason}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end">
                <button
                  onClick={onClose}
                  className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
