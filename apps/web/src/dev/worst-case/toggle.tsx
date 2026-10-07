// Dev only (mounted by routes/__root.tsx behind import.meta.env.DEV): flips `?data=` and re-reads everything.
import { useLocation, useRouter } from "@tanstack/react-router";

import { queryClient } from "@/lib/orpc";

const STATES = [["", "Demo"], ["worst", "Worst case"], ["empty", "Empty"], ["one", "One"], ["huge", "1,000 rows"]] as const;

export default function DataToggle() {
  const router = useRouter();
  const current = useLocation({ select: location => new URLSearchParams(location.searchStr).get("data") ?? "" });
  const pick = async (data: string) => {
    const url = new URL(window.location.href);
    if (data) url.searchParams.set("data", data);
    else url.searchParams.delete("data");
    await router.navigate({ href: `${url.pathname}${url.search}${url.hash}`, replace: true });
    queryClient.clear(); // the link reads ?data= per call, so every query and the signed-in `me` read again
    await router.invalidate();
  };
  return (
    <div role="radiogroup" aria-label="Data" style={{ position: "fixed", left: "50%", bottom: 4, transform: "translateX(-50%)", zIndex: 2147483647, display: "flex", gap: 2, padding: 2, borderRadius: 999, background: "#e5e5e5", boxShadow: "0 1px 3px rgb(0 0 0 / 0.2)", font: "500 11px/1 system-ui, sans-serif", maxWidth: "calc(100vw - 8px)" }}>
      {STATES.map(([value, label]) => (
        <button key={value} type="button" role="radio" aria-checked={current === value} onClick={() => void pick(value)}
          style={{ border: 0, borderRadius: 999, padding: "5px 9px", whiteSpace: "nowrap", cursor: "pointer", font: "inherit", color: "#111", background: current === value ? "#fff" : "transparent", boxShadow: current === value ? "0 1px 2px rgb(0 0 0 / 0.15)" : "none" }}>
          {label}
        </button>
      ))}
    </div>
  );
}
