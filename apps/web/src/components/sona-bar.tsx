/** The Sona bar under every page: type, or hold the mic. Answers land in the page, never in a sheet. */
export function SonaBar({ app }: { app: "pro" | "care" }) {
  return (
    <form className="glass" style={{ width: "min(720px, 100%)", borderRadius: 999, padding: "8px 16px" }} onSubmit={event => event.preventDefault()}>
      <input aria-label="Ask Sona" placeholder={app === "pro" ? "Ask Sona" : "Ask Sona anything"} style={{ width: "100%", minHeight: "var(--tap)", border: 0, outline: 0, background: "transparent" }} />
    </form>
  );
}
