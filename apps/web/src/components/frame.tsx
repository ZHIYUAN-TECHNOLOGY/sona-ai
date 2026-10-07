import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { type ReactNode, useRef } from "react";

import { EASE_OUT, gsap, moves, useGSAP } from "@/lib/motion";

import { signOut } from "@/lib/session";
import { SonaAnswers, SonaProvider } from "@/lib/sona";
import type { NavGroup } from "@/nav";

import { Avatar } from "./avatar";
import { Icon } from "./icon";
import { SonaBar } from "./sona-bar";

/** Sidebar, the page, and the Sona bar under every page. `app` picks the theme (tokens.css). */
export function Frame({ app, brand, groups, who, name, instead }: { app: "pro" | "care"; brand: string; groups: NavGroup[]; who: string; /** The signed-in person, for the avatar; `who` then reads as the role line under it. */ name?: string; /** Shown in place of the page (a page this role may not open). */ instead?: ReactNode }) {
  // Each page arrives as one move: its blocks rise into place a beat apart (the phone apps' list stagger).
  const page = useRef<HTMLDivElement>(null);
  const path = useLocation({ select: location => location.pathname });
  useGSAP(() => {
    if (moves() && page.current) gsap.from(page.current.children, { opacity: 0, y: 12, duration: 0.45, ease: EASE_OUT, stagger: 0.05, clearProps: "opacity,transform" });
  }, { dependencies: [path] });

  return (
    <div className={`${app} frame`}>
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
                {item.count ? <span className="frame-count">{item.count}</span> : null}
              </Link>
            ))}
          </div>
        ))}
        </div>
        <div className="frame-who">
          {name ? <Avatar name={name} size="sm" /> : null}
          <span className="frame-who-text frame-label">{name ? <strong>{name}</strong> : null}<span>{who}</span></span>
          <button type="button" className="frame-out" onClick={() => signOut(app)} title="Sign out"><Icon name="sign-out" size={18} /><span className="frame-out-text">Sign out</span></button>
        </div>
      </nav>
      <div className="frame-main">
        <SonaProvider app={app}>
          <main className="frame-scroll">
            <div className="frame-page" ref={page}>
              {instead ?? (
                <>
                  <SonaAnswers />
                  <Outlet />
                </>
              )}
            </div>
          </main>
          <div className="frame-bar">
            <SonaBar app={app} />
          </div>
        </SonaProvider>
      </div>
    </div>
  );
}
