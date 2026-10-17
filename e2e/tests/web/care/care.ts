import type { Browser } from '@e2e-dev/web';
import { expect, type Screen } from 'e2e';

/** Seeded synthetic facts (packages/db/src/seed.ts, demo.ts). */
export const PATIENT = { name: 'Amelia Tan', first: 'Amelia', hospital: 'Demo General Hospital (synthetic)', phone: '011-0000 0000', code: '123456' };
export const TZ = 'Asia/Kuala_Lumpur';

export type Visit = { id: string; date: string; title: string; why: string; inDays: number; status: string };
export type Doctor = { id: string; name: string; specialty: string; room: string; languages: string[]; about?: string; careTeam: boolean; nextSlots: { day: string; times: string[] }[] };
type Med = { name: string; line: string; take?: string; finished?: boolean };
export type Plan = { status: 'in-hospital' } | { status: 'discharged'; dischargedAt: string; warningSigns: string[]; medicines: Record<'new' | 'changed' | 'continue' | 'stopped', Med[]> };

/**
 * One Sona Care API call made by the signed-in page itself (same origin, its session cookie), so a test reads the
 * server's own state rather than hard-coding one that other writers to the shared database may change. Open a /care page first.
 */
export async function rpc<T>(browser: Browser, path: string, input?: unknown): Promise<T> {
  const res = await browser.evaluate(async arg => {
    const { path, input } = arg as { path: string; input: unknown };
    const r = await fetch(`/rpc/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ json: input }) });
    return { status: r.status, body: await r.json() };
  }, { path, input: (input ?? null) as never }) as { status: number; body: { json: unknown } };
  if (res.status !== 200) throw new Error(`${path} answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.json as T;
}

/** A date as the page's own browser formats it (same ICU as the app), in the hospital's time zone. */
export const formatIn = (browser: Browser, iso: string, locale: string, options: Intl.DateTimeFormatOptions) =>
  browser.evaluate(arg => {
    const { iso, locale, options } = arg as { iso: string; locale: string; options: Intl.DateTimeFormatOptions };
    return new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Kuala_Lumpur', ...options }).format(new Date(iso));
  }, { iso, locale, options } as never) as Promise<string>;

/** Follow-ups' "Thu, 8 Oct, 10:30 pm" (features/care-follow-ups/dates.ts whenWords). */
export const whenWords = async (browser: Browser, iso: string, locale = 'en-MY') =>
  `${await formatIn(browser, iso, locale, { weekday: 'short', day: 'numeric', month: 'short' })}, ${await formatIn(browser, iso, locale, { hour: 'numeric', minute: '2-digit' })}`;

/** Signs in on /care/sign-in with the demo number and code the page offers (DEMO_SIGN_IN). */
export async function signIn(screen: Screen) {
  await screen.getByRole('button', `Demo number: ${PATIENT.phone}`).tap();
  await screen.getByRole('button', 'Send code').tap();
  await screen.getByRole('button', `Demo code: ${PATIENT.code}`).tap();
  await screen.getByRole('button', 'Sign in').tap();
}

/** Waits until a Care page has its data: no "Loading…" or "Getting your…" placeholder left in the page. */
export async function settled(screen: Screen) {
  await expect(screen.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
  await expect(screen.getByText(/^(Loading|Getting) your/)).toHaveCount(0, { timeout: 20_000 });
}

/** Care's accessibility floor (docs/web-apps-plan.md, apps/web/README.md): controls under 48 px tall, and text under 15 px. */
export const accessibilityMisses = (browser: Browser) => browser.evaluate(() => {
  const shown = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const name = (el: Element) => (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 50);
  const targets = Array.from(document.querySelectorAll('main button, main a.btn, nav a, nav button, .ai-composer button, main input:not([type=checkbox]):not([type=radio]), main textarea'))
    .filter(shown).flatMap(el => { const h = Math.round(el.getBoundingClientRect().height); return h < 48 ? [`${name(el)}: ${h}px tall`] : []; });
  // Decorative text (a letter avatar, aria-hidden) is not read, so it is not held to the reading size. Chart labels
  // (SVG text, sized in the chart's own units) are measured by chartTextMisses.
  const text = Array.from(document.querySelectorAll('main *')).filter(el => shown(el) && !el.closest('[aria-hidden="true"], svg') && Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent!.trim()))
    .flatMap(el => { const px = parseFloat(getComputedStyle(el).fontSize); return px < 15 ? [`${name(el)}: ${px}px text`] : []; });
  const lead = document.querySelector('main .page-header p');
  const body = lead && parseFloat(getComputedStyle(lead).fontSize) < 17 ? [`page lead: ${getComputedStyle(lead).fontSize}`] : [];
  return [...targets, ...text, ...body];
});

/** Chart labels in the page drawn under 15 CSS px: the SVG's font size times how far its viewBox is scaled on screen. */
export const chartTextMisses = (browser: Browser) => browser.evaluate(() =>
  Array.from(document.querySelectorAll('main figure.chart svg text')).flatMap(t => {
    const svg = t.closest('svg')!, scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    const px = Math.round(parseFloat(getComputedStyle(t).fontSize) * scale * 10) / 10;
    return px < 15 ? [`"${t.textContent}": ${px}px`] : [];
  }));
