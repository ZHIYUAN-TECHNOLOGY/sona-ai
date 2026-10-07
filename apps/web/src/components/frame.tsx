import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef } from "react";

import { formatNumber } from "@/lib/format";
import { EASE_OUT, gsap, moves, useGSAP } from "@/lib/motion";

import { signOut } from "@/lib/session";
import { SonaProvider, SonaThread, useSona } from "@/lib/sona";
import { contextLabel, OWN_CHAT } from "@/lib/sona-panel";
import type { NavGroup } from "@/nav";

import { Composer, focusComposer } from "./ai";
import { Avatar } from "./avatar";
import { Icon } from "./icon";
import { SonaPanel } from "./sona-panel";

type FrameProps = { app: "pro" | "care"; brand: string; groups: NavGroup[]; who: string; /** The signed-in person, for the avatar; `who` then reads as the role line under it. */ name?: string; /** Shown in place of the page (a page this role may not open). */ instead?: ReactNode };

/** Sidebar, the page, and Sona docked on the right (or its orb). `app` picks the theme (tokens.css). */
export function Frame(props: FrameProps) {
  return <SonaProvider app={props.app}><Shell {...props} /></SonaProvider>;
}

function Shell({ app, brand, groups, who, name, instead }: FrameProps) {
  // Each page arrives as one move: its blocks rise into place a beat apart (the phone apps' list stagger).
  const page = useRef<HTMLDivElement>(null);
  const path = useLocation({ select: location => location.pathname });
  useGSAP(() => {
    if (moves() && page.current) gsap.from(page.current.children, { opacity: 0, y: 12, duration: 0.45, ease: EASE_OUT, stagger: 0.05, clearProps: "opacity,transform" });
  }, { dependencies: [path] });

  const { panel, setPanel, context, ask } = useSona();
  // A chat page (Evidence, Care's Ask) is its own composer: the panel and the orb stay away there.
  const own = !instead && OWN_CHAT.has(path);

  // ⌘K / Ctrl+K from anywhere: open Sona and put the cursor in its composer (on a chat page, the page's own).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      if (!own && panel === "closed") setPanel("open");
      focusComposer();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [own, panel, setPanel]);

  return (
    <div className={`${app} frame`} data-sona={own ? "page" : panel}>
      <nav className="frame-side" aria-label={brand}>
        <div className="frame-brand"><span className="frame-brand-tile"><Icon name="activity" size={22} /></span><span className="frame-label">{brand}</span></div>
        <div className="frame-groups">
        {groups.map(group => (
          <div key={group.label} className="frame-group">
            <div className="frame-group-label">{group.label}</div>
            {group.items.map(item => (
              <Link key={item.to} to={item.to} className="frame-link" title={item.label} activeProps={{ "aria-current": "page" }}>
                <Icon name={item.icon} />
                <span className="frame-label">{item.label}</span>
                {item.count ? <span className="frame-count">{formatNumber(item.count)}</span> : null}
              </Link>
            ))}
          </div>
        ))}
        </div>
        <div className="frame-who">
          {name ? <Avatar name={name} size="sm" /> : null}
          <span className="frame-who-text frame-label" title={name ? `${name}, ${who}` : who}>{name ? <strong>{name}</strong> : null}<span>{who}</span></span>
          <button type="button" className="frame-out" onClick={() => signOut(app)} title="Sign out"><Icon name="sign-out" size={18} /><span className="frame-out-text">Sign out</span></button>
        </div>
      </nav>
      {/* Full screen hides the page without unmounting it: its scroll, its state and its Sona handler stay. */}
      <div className="frame-main" inert={!own && panel === "expanded"}>
        <main className="frame-scroll">
          <div className="frame-page" ref={page}>
            {instead ?? (
              <>
                {app === "care" && own ? <SonaThread /> : null}
                <Outlet />
              </>
            )}
          </div>
        </main>
        {/* Care's Ask page keeps its in-page thread, asked from the composer under it. */}
        {app === "care" && own ? <div className="ai-composer-dock"><Composer app="care" onSend={ask} /></div> : null}
      </div>
      {own ? null : <SonaPanel app={app} label={contextLabel(context, groups, path, brand)} />}
    </div>
  );
}
