import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/icon";
import { Button, Chip, IconButton } from "@/components/primitives";
import { highlightSegments, type ScanRead, scanPages } from "@/features/library/files";
import "@/styles/pages/scan-review.css";

const ZOOMS = [50, 75, 100, 125, 150, 200];

/**
 * Review before deciding, on the whole page: the scanned page large on the left, the text MedGemma read on the right,
 * each unsure word lit amber in place. Nothing is saved until every page is marked checked; the back arrow and Cancel
 * discard it all, and need no confirm because nothing exists yet.
 */
export function ScanReviewPage({ read, pending, error, onConfirm, onCancel }: { read: ScanRead; pending: boolean; error?: string; onConfirm: (pages: string[]) => void; onCancel: () => void }) {
  const n = read.pages.length;
  const [texts, setTexts] = useState(() => read.pages.map(p => p.text));
  const [checked, setChecked] = useState(() => read.pages.map(() => false));
  // `fade` is off for key-driven switches: someone arrowing through pages wants them to snap.
  const [view, setView] = useState({ page: 0, fade: false });
  const [zoom, setZoom] = useState(100);
  const [empty, setEmpty] = useState<string>();
  const editor = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const go = (page: number, fade = true) => setView({ page: Math.min(Math.max(page, 0), n - 1), fade });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("textarea, input")) return;
      if (e.key === "ArrowLeft") go(view.page - 1, false);
      if (e.key === "ArrowRight") go(view.page + 1, false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const { page } = view;
  const current = read.pages[page]!;
  const text = texts[page]!;
  const done = checked.filter(Boolean).length;
  const all = done === n;
  const unsure = current.unsure.filter(w => text.includes(w));
  const select = (word: string) => {
    const at = text.indexOf(word);
    if (at < 0 || !editor.current) return;
    editor.current.focus();
    editor.current.setSelectionRange(at, at + word.length);
  };
  const submit = () => {
    const pages = scanPages(texts);
    setEmpty("error" in pages ? pages.error : undefined);
    if ("pages" in pages) onConfirm(pages.pages);
  };

  return (
    <div className="sr">
      <header className="sr-bar glass">
        <IconButton icon="chevron-left" label="Back, discard what Sona read" variant="quiet" onClick={onCancel} disabled={pending} />
        <div className="sr-head">
          <h1>Check what Sona read</h1>
          <p>Nothing is added until every page is checked.</p>
        </div>
        <Chip tone={all ? "done" : "neutral"} icon={all ? "check" : undefined}>{done} of {n} page{n === 1 ? "" : "s"} checked</Chip>
      </header>

      <div className="sr-body">
        <section className="sr-viewer" aria-label="The scanned page">
          <div className="sr-viewer-bar">
            <span className="sr-num">Page {page + 1}</span>
            <div className="sr-zoom" role="group" aria-label="Zoom">
              <button type="button" className="sr-zoom-btn" aria-label="Zoom out" onClick={() => setZoom(z => ZOOMS[Math.max(ZOOMS.indexOf(z) - 1, 0)]!)} disabled={zoom === ZOOMS[0]}>−</button>
              <button type="button" className="sr-zoom-btn sr-zoom-reset" onClick={() => setZoom(100)} aria-label={`Zoom ${zoom} percent, reset to fit the width`}>{zoom}%</button>
              <button type="button" className="sr-zoom-btn" aria-label="Zoom in" onClick={() => setZoom(z => ZOOMS[Math.min(ZOOMS.indexOf(z) + 1, ZOOMS.length - 1)]!)} disabled={zoom === ZOOMS.at(-1)}>+</button>
            </div>
          </div>
          <div className="sr-stage">
            <div key={page} className={view.fade ? "sr-fade" : undefined} style={{ width: `${zoom}%` }}>
              <img src={`data:${current.contentType};base64,${current.image}`} alt={`Page ${page + 1} as uploaded`} />
            </div>
          </div>
          <ol className="sr-thumbs" aria-label="Pages">
            {read.pages.map((p, i) => (
              <li key={i}>
                <button type="button" className="sr-thumb" aria-current={i === page ? "page" : undefined} onClick={() => go(i)}
                  aria-label={`Page ${i + 1}${checked[i] ? ", checked" : p.unsure.length ? `, ${p.unsure.length} unsure` : ""}`}>
                  <img src={`data:${p.contentType};base64,${p.image}`} alt="" />
                  <span className="sr-thumb-num">{i + 1}</span>
                  {checked[i] ? <span className="sr-thumb-done" aria-hidden><Icon name="check" size={12} /></span> : p.unsure.length ? <span className="sr-thumb-unsure" aria-hidden /> : null}
                </button>
              </li>
            ))}
          </ol>
        </section>

        <section className="sr-text" aria-label="The text Sona read">
          <p className="section-label">Page {page + 1} of {n}</p>
          {unsure.length > 0 && <Chip tone="soon" icon="alert">{unsure.length} word{unsure.length === 1 ? "" : "s"} Sona was unsure of</Chip>}
          <div className="sr-editor">
            {/* The mirror sits behind the textarea with the same font, padding and wrapping, so each unsure word is lit exactly where it is typed. */}
            <div ref={mirror} className="sr-mirror" aria-hidden>
              {highlightSegments(text, unsure).map((s, i) => (s.unsure ? <mark key={i}>{s.text}</mark> : s.text))}{"\n"}
            </div>
            <textarea ref={editor} value={text} readOnly={pending} placeholder="No text read on this page" aria-label={`Text on page ${page + 1}`}
              onChange={e => setTexts(t => t.map((x, j) => (j === page ? e.target.value : x)))}
              onScroll={e => { if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop; }} />
          </div>
          {unsure.length > 0 && (
            <ul className="sr-words" aria-label="Words Sona was unsure of">
              {unsure.map(w => <li key={w}><button type="button" className="chip" data-tone="soon" data-variant="soft" onClick={() => select(w)} aria-label={`Select "${w}" in the text`}>{w}</button></li>)}
            </ul>
          )}
          <div className="sr-actions">
            <label className="sr-check" data-on={checked[page] || undefined}>
              <input type="checkbox" checked={checked[page]} disabled={pending} onChange={e => setChecked(c => c.map((x, j) => (j === page ? e.target.checked : x)))} />
              <span className="sr-check-box" aria-hidden><Icon name="check" size={14} /></span>
              Mark this page checked
            </label>
            {page < n - 1 && <Button icon="arrow-right" onClick={() => go(page + 1)}>Next page</Button>}
          </div>
        </section>
      </div>

      <footer className="sr-bar sr-foot glass">
        {(empty ?? error) ? <p className="lib-error" role="alert">{empty ?? error}</p> : !all && <p className="sr-hint">Mark each page checked first.</p>}
        <div className="sr-row">
          <Button onClick={onCancel} disabled={pending} aria-label="Cancel and discard what Sona read">Cancel</Button>
          <Button variant="primary" pending={pending} disabled={!all} onClick={submit} aria-label="Checked, add the text to the library">Checked, add to library</Button>
        </div>
      </footer>
    </div>
  );
}
