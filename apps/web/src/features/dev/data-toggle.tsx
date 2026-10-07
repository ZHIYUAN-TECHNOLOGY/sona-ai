/** Dev-only switch between the real data and the worst-case fixtures, fixed at the bottom-centre. Plain chrome, not design. */
export function DataToggle() {
  if (!import.meta.env.DEV) return null;
  const current = new URLSearchParams(window.location.search).get("data") ?? "demo";
  const states = [["demo", "Demo data"], ["worst", "Worst case"], ["empty", "Empty"], ["one", "One"], ["many", "1,200 rows"]] as const;
  return (
    <nav aria-label="Test data" style={{ position: "fixed", left: "50%", bottom: 92, transform: "translateX(-50%)", zIndex: 50, display: "flex", gap: 2, padding: 3, borderRadius: 8, background: "#e5e7eb", font: "12px system-ui" }}>
      {states.map(([id, label]) => (
        <a key={id} href={id === "demo" ? window.location.pathname : `?data=${id}`} aria-current={current === id ? "page" : undefined}
          style={{ padding: "4px 10px", borderRadius: 6, color: "#111", textDecoration: "none", background: current === id ? "#fff" : "transparent" }}>{label}</a>
      ))}
    </nav>
  );
}
