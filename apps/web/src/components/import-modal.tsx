"use client";

import Papa from "papaparse";
import { useState } from "react";
import { X } from "lucide-react";
import {
  getImportStatus,
  IMPORTABLE_FIELDS,
  ImportJob,
  uploadImport,
} from "@/lib/leads";
import { isExcel, xlsxToCsvFile } from "@/lib/xlsx-to-csv";

type Stage = "pick" | "map" | "running" | "done";

export function ImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [stage, setStage] = useState<Stage>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [onDuplicate, setOnDuplicate] = useState<"skip" | "update">("skip");
  const [job, setJob] = useState<ImportJob | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        // auto-map columns whose header matches a field name
        const guess: Record<string, string> = {};
        for (const col of cols) {
          const norm = col.toLowerCase().replace(/[^a-z]/g, "");
          const hit = IMPORTABLE_FIELDS.find(
            (f2) => f2.toLowerCase() === norm || norm.includes(f2.toLowerCase()),
          );
          if (hit) guess[col] = hit;
        }
        setMapping(guess);
        setStage("map");
      },
    });
  }

  async function run() {
    if (!file) return;
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
      const { jobId } = await uploadImport(file, clean, onDuplicate);
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
    } catch {
      setError("Upload failed. Check the file and try again.");
      setStage("map");
    }
  }

  const field =
    "rounded border border-line-mid bg-white px-2 py-1 text-sm outline-none focus:border-accent";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-lg border border-line bg-white shadow-float">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-section font-semibold text-ink2">Import leads</h2>
          <button onClick={onClose} className="text-faint hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-5">
          {stage === "pick" && error && (
            <p className="mb-3 rounded bg-danger-bg px-3 py-2 text-sm text-danger-text">{error}</p>
          )}
          {stage === "pick" && (
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

          {stage === "map" && (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                Map your columns to lead fields. Unmapped columns are ignored.
              </p>
              <div className="space-y-2">
                {headers.map((col) => (
                  <div key={col} className="flex items-center gap-3">
                    <span className="w-40 truncate text-sm text-ink">
                      {col}
                    </span>
                    <span className="text-faint">→</span>
                    <select
                      value={mapping[col] ?? ""}
                      onChange={(e) =>
                        setMapping((m) => ({ ...m, [col]: e.target.value }))
                      }
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
              <label className="flex items-center gap-2 text-sm text-muted">
                On duplicate email
                <select
                  value={onDuplicate}
                  onChange={(e) =>
                    setOnDuplicate(e.target.value as "skip" | "update")
                  }
                  className={field}
                >
                  <option value="skip">Skip</option>
                  <option value="update">Update</option>
                </select>
              </label>
              {error && <p className="text-sm text-danger-text">{error}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setStage("pick")}
                  className="rounded border border-line-mid px-3 py-1.5 text-sm"
                >
                  Back
                </button>
                <button
                  onClick={run}
                  className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
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

          {stage === "done" && job && (
            <div className="space-y-3">
              <p className="text-sm text-ink">
                Imported <b>{job.imported}</b>, updated <b>{job.updated}</b>,
                skipped <b>{job.skipped}</b> of {job.total}.
              </p>
              {job.errors.length > 0 && (
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
