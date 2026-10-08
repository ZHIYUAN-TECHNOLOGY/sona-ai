import type { Browser } from '@e2e-dev/web';
import type { App, Screen } from 'e2e';
import { expect } from 'e2e';
import { LOG } from '../roles';

// The public demo password the sign-in page prints (packages/db/src/seed.ts), not a secret: filled as plain text so
// screenshots stay available, as in tests/web/auth.setup.e2e.ts.
export const DEMO_PASSWORD = '123';

/** Generous waits for answers the real models write (SageMaker Gemma, MedGemma): 3 to 60 s, more when a box wakes. */
export const MODEL = { timeout: 120_000 };
export const LOAD = { timeout: 20_000 };

export const sidebar = (screen: Screen) => screen.getByRole('navigation', 'Sona Pro');
export const main = (screen: Screen) => screen.getByRole('main');
/** The docked Sona panel on the right of every Pro page but Evidence. */
export const sona = (screen: Screen) => screen.getByRole('complementary', 'Sona');
/** An insight card (an unnamed article) by its heading, within `scope`. A `has` locator is relative, so it is built from the root screen. */
export const card = (screen: Screen, heading: string | RegExp, scope: Screen = screen) => scope.getByRole('article').filter({ has: screen.getByRole('heading', heading) });
/** A sidebar link by its label; a badge count may follow the label in its name ("Results 2"). */
export const navLink = (screen: Screen, label: string) => sidebar(screen).getByRole('link', new RegExp(`^${escape(label)}( \\d+)?$`));

// A stat card is an unnamed <section> (components/primitives.tsx StatCard): no role or label reaches it, so its value is
// found by XPath under its heading. ponytail: CSS last resort; an aria-label on StatCard would make this a role query.
export const statValue = (browser: Browser, title: string) =>
  browser.locator(`xpath=//section[contains(@class,"stat")][.//h3[normalize-space()=${JSON.stringify(title)}]]//p[contains(@class,"stat-value")]`);
export const statCaption = (browser: Browser, title: string) =>
  browser.locator(`xpath=//section[contains(@class,"stat")][.//h3[normalize-space()=${JSON.stringify(title)}]]//p[contains(@class,"stat-caption")]`);

/** The first whole number in a text ("Blocked 7" → 7). */
export const num = (text: string | null | undefined) => Number((text ?? '').replace(/,/g, '').match(/\d+/)?.[0] ?? Number.NaN);
/** A number as the start of a text, not the start of a longer number ("7" matches "7 beds", not "17"). */
export const startsWith = (n: number) => new RegExp(`^${n}(?!\\d)`);
export const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A tab's count, once the tab has rendered ("All 17" → 17). */
export async function tabCount(screen: Screen, label: string) {
  const tab = screen.getByRole('tab', new RegExp(`^${escape(label)} \\d+$`));
  await expect(tab).toBeVisible(LOAD);
  return num(await tab.textContent());
}

/** Signs in through the form with a fresh browser context (no saved session), as a person would. */
export async function signIn(app: App, screen: Screen, browser: Browser, username: string, landing = '/pro/today') {
  await app.open('/pro/sign-in');
  await screen.getByLabel('Username or email').fill(username);
  await screen.getByLabel('Password').fill(DEMO_PASSWORD);
  await screen.getByRole('button', 'Sign in').tap();
  await expect(browser).toHaveURL(landing, LOAD);
}

/** Asks the Sona panel a typed question and returns the turn (an article in the panel's log) it lands in. */
export async function askPanel(screen: Screen, question: string) {
  const panel = sona(screen);
  await panel.getByRole('textbox', 'Ask Sona').fill(question);
  await panel.getByRole('button', 'Send to Sona').tap();
  return panel.getByRole(LOG, "Sona's answers").getByRole('article').filter({ has: screen.getByRole('heading', `You asked: ${question}`) });
}
