import { expect, type Locator, type Screen } from 'e2e';
import { metroUrl, openSona } from '../../ios';

/** Sona Care's Metro (production mode) for the "Sona e2e Care" simulator. */
export const PORT = 8094;
export const TAGS = ['care', 'ios'];

type Fixtures = Parameters<typeof openSona>[0];

const shown = (l: Locator, timeout: number) => l.waitFor({ state: 'visible', timeout }).then(() => true, () => false);

/** The welcome's lead way in, and home's initials (Amelia's settings): one of them is up once the opening has dissolved. */
export const welcomeButton = (screen: Screen) => screen.getByRole('button', 'Continue with phone number');
export const settingsButton = (screen: Screen) => screen.getByRole('button', 'Amelia Tan. Settings');

/** A fresh launch of Expo Go into Sona Care; resolves to the screen it opened on (the session survives relaunches). */
export async function launch(f: Fixtures): Promise<'welcome' | 'home'> {
  await openSona(f, PORT);
  const welcome = welcomeButton(f.screen), home = settingsButton(f.screen);
  // The opening holds until the session and the record are in (the record waits on a cold Neon branch).
  await expect.poll(async () => (await welcome.isVisible()) || (await home.isVisible()), { timeout: 120_000, message: 'neither the welcome nor home appeared' }).toBe(true);
  return (await home.isVisible()) ? 'home' : 'welcome';
}

/**
 * On the code step: takes the staging demo code (DEMO_SIGN_IN) and lands on home. The demo phone's one stored code is
 * shared by every suite signing in as Amelia at once (web, Pro, Care), and another suite's send can replace it between
 * ours and the verify; a refused code is sent again once, the way a patient would.
 */
export async function enterDemoCode({ screen }: Fixtures) {
  const demoCode = screen.getByRole('button', /^Demo code: \d{6} \(tap to enter\)$/);
  await demoCode.tap();
  if (await shown(settingsButton(screen), 20_000)) return;
  await screen.getByRole('button', 'Change number').tap();
  await screen.getByRole('button', 'Send code').tap();
  await demoCode.tap();
  await expect(settingsButton(screen)).toBeVisible({ timeout: 60_000 });
}

/** The phone path with the staging demo number and its fixed code (DEMO_SIGN_IN), from the welcome. */
export async function phoneSignIn(f: Fixtures) {
  const { screen } = f;
  await welcomeButton(screen).tap();
  await screen.getByRole('button', /^Demo patient: tap to use 0\d+$/).tap();
  await screen.getByRole('button', 'Send code').tap();
  await enterDemoCode(f);
}

/**
 * iOS offers to save the password once the email form is sent. Left up, it covers the app, and its host process
 * lingering afterwards switches agent-device to XCTest snapshots, which read React Native's radios as plain nodes.
 */
export async function declineSavePassword({ screen }: Fixtures) {
  const notNow = screen.getByRole('button', 'Not Now');
  if (await shown(notNow, 15_000)) await notNow.tap();
}

/** Launches Sona Care signed in as Amelia, on home (the phone path: the email path brings up iOS's Save Password?). */
export async function signedIn(f: Fixtures) {
  if (await launch(f) === 'welcome') await phoneSignIn(f);
  await expect(homeGreeting(f.screen)).toBeVisible({ timeout: 30_000 });
}

/** Home's header: "Hello! Amelia" over today's date, read as one heading. */
export const homeGreeting = (screen: Screen) => screen.getByLabel(/^Hello! Amelia, /);

/** From home: Settings, Sign out, then the in-place confirmation; ends on the welcome. */
export async function signOut({ screen }: Fixtures) {
  await settingsButton(screen).tap();
  await screen.getByRole('button', 'Sign out').tap();
  await expect(screen.getByText("Sign out of Sona Care? To come back, you'll need the code on your discharge paper.")).toBeVisible();
  await screen.getByRole('button', 'Sign out').last().tap();
  await expect(welcomeButton(screen)).toBeVisible({ timeout: 60_000 });
}

/** Opens a Sona Care route in the running app (expo-router's `/--/` path in Expo Go). */
export const route = (f: Fixtures, path: string) => f.device.openLink(`${metroUrl(PORT)}/--/${path}`);

/** Dock places: tabs are `other` with `selected` on iOS, so they are found by label. */
export const tab = (screen: Screen, name: 'Home' | 'Schedule' | 'Medicine' | 'Doctors') => screen.getByLabel(name, { exact: true });

/** Scrolls a control at the end of a page into view and clear of the floating dock, which would otherwise take the tap. */
export async function clearOfDock(screen: Screen, target: Locator) {
  await screen.scrollUntilVisible(target);
  const [box, dock] = [await target.boundingBox(), await tab(screen, 'Home').boundingBox()];
  if (box && dock && box.y + box.height > dock.y) await screen.swipe({ direction: 'down', momentum: 'slow' });
}

/** Whether the server reports Amelia discharged: Medicine says "Once you go home" until she is. */
export async function dischargedOnMedicine(screen: Screen) {
  const before = screen.getByText('Once you go home'), after = screen.getByLabel(/^Today's\. Medicines/);
  await expect(after).toBeVisible({ timeout: 30_000 });
  return !(await shown(before, 5_000));
}

export { shown };
