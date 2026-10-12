"use client";

import { useRouter } from "next/navigation";

const TABS: { key: string; label: string }[] = [
  { key: "cuves", label: "Cuves" },
  { key: "approvisionnements", label: "Approvisionnements" },
];

/** Same tab-strip pattern as ReportsViewTabs/PlanningViewTabs — /tanks and /tanks/deliveries used to be two separate pages. */
export function TanksPageTabs({ tab }: { tab: string }) {
  const router = useRouter();

  function go(nextTab: string) {
    router.push(nextTab === "cuves" ? "/tanks" : `/tanks?tab=${nextTab}`);
  }

  return (
    <div className="mb-4 flex rounded-lg bg-navy/[0.04] p-1" style={{ width: "fit-content" }}>
      {TABS.map((t) => (
        <button
          key={t.key}
          className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
            tab === t.key ? "bg-white shadow-sm" : "text-navy/65 hover:text-navy"
          }`}
          onClick={() => go(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
