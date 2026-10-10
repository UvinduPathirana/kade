/**
 * Builds a CSV in the browser and downloads it. Later the reports service generates exports
 * server-side (GET /exports/:report.csv) so large date ranges don't run in the tab.
 */
export function downloadCsv(fileName: string, header: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const body = [header, ...rows].map((r) => r.map(escape).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
