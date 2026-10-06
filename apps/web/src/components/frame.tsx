import { Link, Outlet } from "@tanstack/react-router";

import type { NavGroup } from "@/nav";

import { SonaBar } from "./sona-bar";

/** Sidebar, the page, and the Sona bar under every page. `app` picks the theme (tokens.css). */
export function Frame({ app, brand, groups, who }: { app: "pro" | "care"; brand: string; groups: NavGroup[]; who: string }) {
  return (
    <div className={`${app} frame`}>
      <nav className="frame-side" aria-label={brand}>
        <div className="frame-brand">{brand}</div>
        {groups.map(group => (
          <div key={group.label} className="frame-group">
            <div className="frame-group-label">{group.label}</div>
            {group.items.map(item => (
              <Link key={item.to} to={item.to} className="frame-link" activeProps={{ "aria-current": "page" }}>
                {item.label}
              </Link>
            ))}
          </div>
        ))}
        <div className="frame-who">{who}</div>
      </nav>
      <div className="frame-main">
        <main className="frame-scroll">
          <div className="frame-page">
            <Outlet />
          </div>
        </main>
        <div className="frame-bar">
          <SonaBar app={app} />
        </div>
      </div>
    </div>
  );
}
