"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { exportAll, type ExportSheets } from "@/lib/exportAll";

export default function ExportAllButton({ name, load }: { name: string; load: () => Promise<ExportSheets> }) {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await exportAll(name, await load());
    } catch (error) {
      window.alert(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      title="Download all records as JSON + Excel"
      className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-wait disabled:opacity-50"
    >
      <Download className="h-4 w-4" />
      {busy ? "Exporting…" : "Export All"}
    </button>
  );
}
