import { expect, type Screen } from 'e2e';
import { openSona } from '../../ios';

/** Sona Pro's Metro (judge build, production mode). */
export const PORT = 8093;

type Fixtures = Parameters<typeof openSona>[0];

/** The synthetic demo logins (packages/db/src/seed.ts DEMO_ACCOUNTS): public demo passwords, typed as on the slide. */
export const USERS = {
  doctor: { name: 'Dr Test Aisyah', role: 'Doctor', email: 'doctor@sona.test' },
  nurse: { name: 'Nurse Test Mei Ling', role: 'Nurse', email: 'nurse@sona.test' },
  beds: { name: 'Test Bed Manager Hafiz', role: 'Bed manager', email: 'beds@sona.test' },
  manager: { name: 'Test Manager Farah', role: 'Management', email: 'manager@sona.test' },
} as const;
export type User = keyof typeof USERS;
export const DEMO_PASSWORD = '123';

/** A model's answer label (components/sona/sample-label.ts draftText): never a sample, never "did not answer". */
export const MODEL_LABEL = /^AI draft · .+ · check before acting$/;
/** Every judge-build wording for an answer no model gave (sampleText), so a test can assert none is on screen. */
export const NOT_A_MODEL = /^Sample|model did not answer|model is starting|could not be reached|nothing in its answer kept to the record/;

/**
 * What the home shows once the record is read, per role: doctors and nurses lead with who needs them, bed managers
 * and management with the ward. The signed-out gate covers a home whose record was never read, so neither shows there.
 */
// A section title can be reported twice (its container echoes it), hence the first.
const homeReady = (screen: Screen) => screen.getByText(/^(NEEDS YOU NOW · \d+|WARD NOW)$/).first();

/** Waits for the launch to settle on the gate or on a read home. */
export async function landed(screen: Screen): Promise<'gate' | 'home'> {
  let state: 'gate' | 'home' | undefined;
  await expect.poll(async () => {
    state = (await screen.getByLabel('Username or email').first().isVisible()) ? 'gate' : (await homeReady(screen).isVisible()) ? 'home' : undefined;
    return state;
  }, { timeout: 180_000, interval: 500, message: 'the app neither showed the sign-in gate nor a read home' }).toBeDefined();
  return state!;
}

/** Signs in on the gate standing over the home (not over Settings) and waits for the home that role sees. */
export async function signIn(screen: Screen, user: User, password = DEMO_PASSWORD) {
  await screen.getByLabel('Username or email').fill(user);
  await screen.getByLabel('Password').fill(password);
  await screen.getByRole('button', 'Sign in').tap();
  await signedIn(screen);
}

/**
 * Waits for the home after a sign-in. iOS may first offer to save the password (its own "Save Password?" sheet over the
 * app, from the form's username and password content types); it is not the app's, so it is declined when it comes.
 */
export async function signedIn(screen: Screen) {
  const notNow = screen.getByRole('button', 'Not Now');
  let sheet = false;
  await expect.poll(async () => (sheet = await notNow.isVisible()) || await homeReady(screen).isVisible(),
    { timeout: 60_000, interval: 500, message: 'neither the home nor iOS’s save-password sheet came' }).toBe(true);
  if (sheet) await notNow.tap();
  await expect(homeReady(screen)).toBeVisible({ timeout: 60_000 });
}

/** Opens the sidebar (a no-op when it is already open). */
export async function openMenu(screen: Screen) {
  if (!await screen.getByRole('button', 'Settings').isVisible()) await screen.getByRole('button', 'Menu').tap();
  await expect(screen.getByRole('button', 'Settings')).toBeVisible();
}

/** Closes the sidebar on Today with its Home row (the page edge's "Close menu" is not always in the tree). */
export async function closeMenu(screen: Screen) {
  await screen.getByRole('button', 'Home', { selected: true }).tap();
  await expect(screen.getByRole('button', 'Menu')).toBeVisible();
}

/** Signs out from Settings (sidebar, Settings, Sign out) and waits for the gate. */
export async function signOut(screen: Screen) {
  await openMenu(screen);
  await screen.getByRole('button', 'Settings').tap();
  await screen.getByRole('button', 'Sign out').tap();
  await expect(screen.getByText("Sign in to use your hospital's records.").last()).toBeVisible({ timeout: 30_000 });
}

/**
 * Launches Sona Pro fresh and makes sure `user` is the one signed in (sign-in persists across launches): from the gate
 * it signs in; on a home it reads the signed-in name in the sidebar and switches account when it is someone else.
 * Ends on the home, sidebar closed.
 */
export async function openAs(fixtures: Fixtures, user: User = 'doctor') {
  await openSona(fixtures, PORT);
  const { screen } = fixtures;
  if (await landed(screen) === 'home') {
    await openMenu(screen);
    // The name comes with the session at once; the role pill waits for clinician.me.
    if (await screen.getByText(USERS[user].name).isVisible()) {
      await closeMenu(screen);
      await expect(homeReady(screen)).toBeVisible();
      return;
    }
    await screen.getByRole('button', 'Settings').tap();
    await screen.getByRole('button', 'Sign out').tap();
    await expect(screen.getByText("Sign in to use your hospital's records.").last()).toBeVisible({ timeout: 30_000 });
    // Relaunch so the gate stands over the home alone, not over Settings (whose own form would sit under it).
    await openSona(fixtures, PORT);
    await expect(screen.getByLabel('Username or email')).toBeVisible({ timeout: 120_000 });
  }
  await signIn(screen, user);
}

/** Patients list, then Amelia Tan's page (SYN-1042, Bed 6). */
export async function openAmelia(screen: Screen) {
  await openPatients(screen);
  await screen.getByRole('button', /^Amelia Tan, /).tap();
  await expect(screen.getByText('42 · Female · SYN-1042')).toBeVisible({ timeout: 30_000 });
}

export async function openPatients(screen: Screen) {
  await openMenu(screen);
  await screen.getByRole('button', /^Patients, /).tap();
  await expect(screen.getByLabel('Search patients')).toBeVisible({ timeout: 30_000 });
}

/** Amelia's visit page: the workspace with her tools and the composer. */
export async function openAmeliaVisit(screen: Screen) {
  await openAmelia(screen);
  await screen.getByRole('button', 'Open visit with Amelia Tan').tap();
  await expect(screen.getByText('Amelia Tan · 42 · Respiratory review')).toBeVisible({ timeout: 30_000 });
}

/**
 * Types a question into the composer and sends it. The simulator's one-time "Speed up your typing" tip can open
 * over the keyboard; it goes through its Continue first.
 */
export async function ask(screen: Screen, question: string) {
  await screen.getByRole('button', 'Type a message').tap();
  // The field reads as its label and placeholder together ("Ask Sona Ask about Amelia…").
  const field = screen.getByRole('textbox', /^Ask Sona/);
  await expect(field).toBeVisible();
  const tip = screen.getByRole('button', 'Continue');
  if (await tip.isVisible()) await tip.tap();
  await field.fill(question);
  await screen.getByRole('button', 'Send message').tap();
  await expect(screen.getByText(`You: ${question}`)).toBeVisible({ timeout: 30_000 });
}

/**
 * Drags the page up until `locator` shows. For pages whose scroll view ignores synthesized scrolls (the engine's
 * scroll reports "moved nothing") and whose content is still arriving, so it keeps dragging as the content grows.
 */
export async function dragUntilVisible(screen: Screen, locator: Parameters<Screen['scrollUntilVisible']>[0], { timeout = 150_000, back = false } = {}) {
  // Content moves up (the page reads on down), or with `back` down towards the top.
  const [from, to] = back ? [240, 640] : [640, 240];
  await expect.poll(async () => {
    if (await locator.isVisible()) return true;
    // Slow, so the list does not fling on: a tap during momentum only stops the scroll.
    await screen.swipe({ from: { x: 200, y: from }, to: { x: 200, y: to }, duration: 900 });
    return false;
  }, { timeout, interval: 1_000, message: 'never came into view' }).toBe(true);
}

/** Opens a sidebar destination by its row (label, then the live detail line). */
export async function openFromMenu(screen: Screen, label: string) {
  await openMenu(screen);
  await screen.getByRole('button', new RegExp(`^${label}, `)).tap();
}
