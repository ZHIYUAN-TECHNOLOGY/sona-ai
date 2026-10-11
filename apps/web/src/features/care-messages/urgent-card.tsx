import type { ReactNode } from "react";

import "@/styles/pages/care-messages.css";

/**
 * How to get help now. The only red on these pages. Under an answer (features/care-ask/answer.tsx) `title` and
 * `children` say why, in place of the default lines.
 */
export function UrgentCard({ hospital, title = "Need help now?", children }: { hospital?: string; title?: string; children?: ReactNode }) {
  return (
    <section className="cm-urgent" aria-label="Urgent help">
      <h2>{title}</h2>
      {children ?? (
        <>
          <p>If you faint or have chest pain, call 999.</p>
          <p>Messages are not for emergencies.{hospital ? ` ${hospital} replies here within a few hours.` : ""}</p>
        </>
      )}
      <a className="cm-call" href="tel:999">Call 999 now</a>
    </section>
  );
}
