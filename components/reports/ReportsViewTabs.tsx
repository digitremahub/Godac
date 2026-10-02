"use client";

import { useRouter } from "next/navigation";

/** Table (structured OCR fields) vs Photos (the raw captures) — same tab-strip pattern as PlanningViewTabs. */
export function ReportsViewTabs({ view }: { view: string }) {
  const router = useRouter();

  return (
    <div className="mb-4 flex rounded-lg bg-navy/5 p-1" style={{ width: "fit-content" }}>
      {[
        { key: "table", label: "Tableau" },
        { key: "photos", label: "Photos" },
      ].map((v) => (
        <button
          key={v.key}
          className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
            view === v.key ? "bg-white shadow-sm" : "text-navy/50 hover:text-navy"
          }`}
          onClick={() => router.push(`/reports?view=${v.key}`)}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
