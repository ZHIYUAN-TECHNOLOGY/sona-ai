/** How to get help now. The only red on these pages. */
export function UrgentCard({ hospital }: { hospital?: string }) {
  return (
    <section className="cm-urgent" aria-label="Urgent help">
      <h2>Need help now?</h2>
      <p>If you faint or have chest pain, call 999.</p>
      <p>Messages are not for emergencies.{hospital ? ` ${hospital} replies here within a few hours.` : ""}</p>
      <a className="cm-call" href="tel:999">Call 999 now</a>
    </section>
  );
}
