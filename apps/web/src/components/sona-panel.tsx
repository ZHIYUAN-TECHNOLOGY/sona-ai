import { Composer, focusComposer, SonaMark, Suggestions } from "@/components/ai";
import { SonaTurns, useSona } from "@/lib/sona";

import { Icon } from "./icon";
import { IconButton } from "./primitives";
import "@/styles/sona-panel.css";

// What the empty panel offers, one press each.
const ASK = {
  pro: { lead: "Ask anything. Sona reads this page with you.", questions: ["What needs me first?", "Which beds are blocked?", "What is due today?"] },
  care: { lead: "Ask anything about your health and your care.", questions: ["When is my next visit?", "What medicines do I take today?", "What should I watch for at home?"] },
};

const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
/** The shortcut that opens Sona from anywhere, as the reader's keyboard writes it. */
export const SHORTCUT = mac ? "⌘K" : "Ctrl+K";

/**
 * Sona beside every page: a docked panel on the right (open by default) with the page's turns and the composer, a
 * round orb in the corner when closed (a dot when an answer arrived meanwhile), or the whole main area at the Evidence
 * page's width when expanded. Docked and expanded are the same element, so a draft survives the switch.
 */
export function SonaPanel({ app, label }: { app: "pro" | "care"; /** What the page is about, for the header chip. */ label: string }) {
  const { turns, panel, unseen, setPanel, ask } = useSona();

  if (panel === "closed")
    return (
      <button type="button" className="sona-orb" aria-label={`Ask Sona (${SHORTCUT})${unseen ? ", new answer" : ""}`} title={`Ask Sona · ${SHORTCUT}`}
        onClick={() => { setPanel("open"); focusComposer(); }}>
        <Icon name="sparkle" size={24} />
        {unseen ? <span className="sona-orb-badge" aria-hidden="true" /> : null}
      </button>
    );

  const expanded = panel === "expanded";
  const { lead, questions } = ASK[app];
  return (
    <aside className="sona-panel" data-mode={panel} aria-label="Sona">
      <header className="sona-panel-head">
        <SonaMark />
        <h2>Sona</h2>
        <span className="sona-panel-context" title={label}>{label}</span>
        <IconButton className="sona-panel-expand" icon={expanded ? "collapse" : "expand"} label={expanded ? "Back to the side panel" : "Full screen"} variant="quiet" size="sm"
          onClick={() => setPanel(expanded ? "open" : "expanded")} />
        <IconButton icon="x" label="Close Sona" variant="quiet" size="sm" onClick={() => setPanel("closed")} />
      </header>
      {turns.length ? <SonaTurns className="sona-panel-log" /> : (
        <div className="sona-panel-start">
          <p>{lead}</p>
          <Suggestions items={questions} label="Things to ask Sona" onPick={ask} />
        </div>
      )}
      <div className="sona-panel-foot">
        <Composer app={app} onSend={ask} />
      </div>
    </aside>
  );
}
