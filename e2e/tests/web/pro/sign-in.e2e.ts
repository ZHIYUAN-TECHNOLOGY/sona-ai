import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { LOAD, signIn, sidebar } from './helpers';

// Every test here signs in through the form in its own browser context, never with a saved session: signing out ends
// the server session, which would sign out every other test sharing a saved one.
describe('Sona Pro sign-in', { tags: ['pro', 'smoke'] }, () => {
  test('a wrong password shows the alert and stays on sign-in', async ({ app, screen, browser }) => {
    await app.open('/pro/sign-in');
    await expect(screen.getByRole('heading', 'Sign in to your ward')).toBeVisible(LOAD);
    await expect(screen.getByText('Demo: doctor / 123, also nurse, beds, manager')).toBeVisible();
    await screen.getByLabel('Username or email').fill('doctor');
    await screen.getByLabel('Password').fill('not-the-password');
    await screen.getByRole('button', 'Sign in').tap();
    const alert = screen.getByRole('alert');
    await expect(alert).toBeVisible(LOAD);
    await expect(alert).toContainText(/password/i);
    await expect(browser).toHaveURL('/pro/sign-in');
    // The form is ready for another try, not stuck on "Signing in…".
    await expect(screen.getByRole('button', 'Sign in')).toBeEnabled();
  });

  test('an unknown username shows the alert', async ({ app, screen, browser }) => {
    await app.open('/pro/sign-in');
    await screen.getByLabel('Username or email').fill(`nobody-${Date.now()}`);
    await screen.getByLabel('Password').fill('123');
    await screen.getByRole('button', 'Sign in').tap();
    await expect(screen.getByRole('alert')).toBeVisible(LOAD);
    await expect(browser).toHaveURL('/pro/sign-in');
  });

  test('a bare username signs in and names the clinician', async ({ app, screen, browser }) => {
    await signIn(app, screen, browser, 'nurse');
    await expect(sidebar(screen)).toContainText('Nurse Test Mei Ling');
    await expect(sidebar(screen).getByText('Nurse', { exact: true })).toBeVisible();
    await expect(screen.getByRole('heading', { name: /, Nurse Test Mei Ling$/, level: 1 })).toBeVisible(LOAD);
  });

  test('a full email signs in too', async ({ app, screen, browser }) => {
    await signIn(app, screen, browser, 'doctor@sona.test');
    await expect(sidebar(screen)).toContainText('Dr Test Aisyah');
  });

  test('a bed manager lands on the ward, not Today', async ({ app, screen, browser }) => {
    await signIn(app, screen, browser, 'beds', '/pro/ward');
    await expect(screen.getByRole('heading', { name: 'Ward', level: 1 })).toBeVisible(LOAD);
    // Today is not theirs: a typed address goes to the ward as well.
    await app.open('/pro/today');
    await expect(browser).toHaveURL('/pro/ward', LOAD);
  });

  test('signing out returns to sign-in and ends the session', async ({ app, screen, browser }) => {
    await signIn(app, screen, browser, 'manager');
    await sidebar(screen).getByRole('button', 'Sign out').tap();
    await expect(browser).toHaveURL('/pro/sign-in', LOAD);
    await expect(screen.getByRole('heading', 'Sign in to your ward')).toBeVisible();
    // The old session no longer opens the app.
    await app.open('/pro/patients');
    await expect(browser).toHaveURL('/pro/sign-in', LOAD);
  });

  test('signing out from Settings works the same', async ({ app, screen, browser }) => {
    await signIn(app, screen, browser, 'nurse');
    await app.open('/pro/settings');
    await screen.getByRole('main').getByRole('button', 'Sign out').tap();
    await expect(browser).toHaveURL('/pro/sign-in', LOAD);
  });

  for (const path of ['/pro/patients/SYN-1042', '/pro/visit?encounterId=visit-1042', '/pro/results/lab-1086-potassium', '/pro/guarantee-letter?encounterId=visit-1042', '/pro/settings']) {
    test(`a signed-out visit to ${path} redirects to sign-in`, async ({ app, screen, browser }) => {
      await app.open(path);
      await expect(browser).toHaveURL('/pro/sign-in', LOAD);
      await expect(screen.getByRole('heading', 'Sign in to your ward')).toBeVisible();
      // Nothing of the record leaks onto the sign-in page.
      await expect(screen.getByText(/Amelia|Daniel/)).toHaveCount(0);
    });
  }
});
