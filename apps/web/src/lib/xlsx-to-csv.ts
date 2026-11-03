import Papa from "papaparse";

const MAX_XLSX_BYTES = 10 * 1024 * 1024;

export const isExcel = (f: File) => /\.xlsx$/i.test(f.name);

/**
 * Excel import (T2.5): the first sheet is converted to CSV in the browser and
 * then goes through the normal CSV pipeline (mapping, dedupe, worker). The
 * server never unzips user spreadsheets. Dates become ISO strings.
 */
export async function xlsxToCsvFile(file: File): Promise<File> {
  if (file.size > MAX_XLSX_BYTES) {
    throw new Error("That spreadsheet is over 10 MB — save it as CSV instead.");
  }
  const { readSheet } = await import("read-excel-file/browser");
  const rows = await readSheet(file);
  if (!rows.length) throw new Error("The first sheet is empty.");
  const csv = Papa.unparse(
    rows.map((r) =>
      r.map((cell) =>
        cell instanceof Date ? cell.toISOString() : cell == null ? "" : String(cell),
      ),
    ),
  );
  return new File([csv], file.name.replace(/\.xlsx$/i, ".csv"), { type: "text/csv" });
}
