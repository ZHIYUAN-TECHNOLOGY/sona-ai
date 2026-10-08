import { describe, test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { openSona } from '../../ios';
import { DEMO_PASSWORD, landed, openAmeliaVisit, openAs, openMenu, PORT, signedIn, signOut, USERS } from './helpers';

// The judge build's gate (features/live/judge-gate.tsx, sign-in.tsx): nobody signed in sees the hospital record.
describe('sign-in gate', { tags: ['pro', 'ios', 'smoke'], serial: true }, () => {
  test('a wrong password is refused with the server’s reason', async (fixtures) => {
    const { screen } = fixtures;
    await openSona(fixtures, PORT);
    const user = screen.getByLabel('Username or email');
    if (await landed(screen) === 'home') {
      // Someone is still signed in from an earlier run: sign out, then relaunch so the gate stands over the home.
      await signOut(screen);
      await openSona(fixtures, PORT);
      await expect(user).toBeVisible({ timeout: 120_000 });
    }
    await expect(screen.getByText("Sign in to use your hospital's records.")).toBeVisible();
    // Nothing to send yet: the action waits for both fields.
    await expect(screen.getByRole('button', 'Sign in')).toBeDisabled();
    await user.fill('doctor');
    await screen.getByLabel('Password').fill('not-the-password');
    await screen.getByRole('button', 'Sign in').tap();
    await expect(screen.getByText('Invalid email or password')).toBeVisible({ timeout: 30_000 });
    // Still on the gate: no record behind a refused sign-in.
    await expect(screen.getByText(/^NEEDS YOU NOW · \d+$/)).toBeHidden();
  });

  test('the doctor signs in and the app opens on Today', async ({ screen }) => {
    await screen.getByLabel('Password').fill(DEMO_PASSWORD);
    await screen.getByRole('button', 'Sign in').tap();
    await signedIn(screen);
    await expect(screen.getByText(/^NEEDS YOU NOW · \d+$/).first()).toBeVisible();
    await expect(screen.getByText(/^Good (morning|afternoon|evening)$/)).toBeVisible();
    await expect(screen.getByText('Invalid email or password')).toBeHidden();
    await openMenu(screen);
    await expect(screen.getByText(USERS.doctor.name)).toBeVisible();
    await expect(screen.getByLabel('Role: Doctor')).toBeVisible({ timeout: 15_000 });
    await expect(screen.getByRole('button', 'Home', { selected: true })).toBeVisible();
    await expect(screen.getByRole('button', /^Coding audit, /)).toBeVisible();
  });

  test('Settings shows who is signed in, and signing out returns to the gate', async ({ screen }) => {
    await screen.getByRole('button', 'Settings').tap();
    await expect(screen.getByText(`Signed in as ${USERS.doctor.email}`)).toBeVisible({ timeout: 15_000 });
    await expect(screen.getByLabel('Role: Doctor')).toBeVisible();
    await screen.getByRole('button', 'Sign out').tap();
    await expect(screen.getByText("Sign in to use your hospital's records.").last()).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText(`Signed in as ${USERS.doctor.email}`)).toBeHidden();
    await expect(screen.getByLabel('Username or email').last()).toBeVisible();
  });
});

// Roles (packages/api/src/roles.ts): each sees what the server would allow, and a locked action says who can.
describe('roles', { tags: ['pro', 'ios', 'roles'] }, () => {
  test('a nurse sees clinical work but cannot approve a discharge', async (fixtures) => {
    const { screen } = fixtures;
    await openAs(fixtures, 'nurse');
    await openMenu(screen);
    await expect(screen.getByText(USERS.nurse.name)).toBeVisible();
    await expect(screen.getByLabel('Role: Nurse')).toBeVisible({ timeout: 15_000 });
    await expect(screen.getByRole('button', /^Messages, /)).toBeVisible();
    await expect(screen.getByRole('button', /^Shift handover, /)).toBeVisible();
    await expect(screen.getByRole('button', /^Ward, /)).toBeVisible();
    // Oversight and data stewardship are not a nurse's.
    await expect(screen.getByRole('button', /^Coding audit, /)).toBeHidden();
    await expect(screen.getByRole('button', /^Training data/)).toBeHidden();

    await openAmeliaVisit(screen);
    await screen.getByRole('button', /^Discharge\. /).tap();
    const locked = screen.getByRole('button', "Needs a doctor's approval. Locked");
    await screen.scrollUntilVisible(locked, { timeout: 30_000 });
    await locked.tap();
    // A tap says who can, in the server's own words.
    await expect(screen.getByText(/Nurses can.t approve a discharge/)).toBeVisible();
  });

  test('a bed manager sees the ward, not clinical notes or messages', async (fixtures) => {
    const { screen } = fixtures;
    await openAs(fixtures, 'beds');
    await expect(screen.getByText('WARD NOW')).toBeVisible();
    await expect(screen.getByText(/^NEEDS YOU NOW/)).toBeHidden();
    await openMenu(screen);
    await expect(screen.getByText(USERS.beds.name)).toBeVisible();
    await expect(screen.getByLabel('Role: Bed manager')).toBeVisible({ timeout: 15_000 });
    await expect(screen.getByRole('button', /^Ward, /)).toBeVisible();
    await expect(screen.getByRole('button', /^Messages, /)).toBeHidden();
    await expect(screen.getByRole('button', /^Shift handover, /)).toBeHidden();
    await expect(screen.getByRole('button', /^Coding audit, /)).toBeHidden();
    await screen.getByRole('button', /^Follow-up tasks, /).tap();
    await expect(screen.getByText("Read only. Bed managers can't complete a task. Ask a doctor or a nurse.")).toBeVisible({ timeout: 30_000 });
  });

  test('management oversees audit and training data, read only on care', async (fixtures) => {
    const { screen } = fixtures;
    await openAs(fixtures, 'manager');
    await expect(screen.getByText('WARD NOW')).toBeVisible();
    await expect(screen.getByRole('button', /^Hand over\. \d+ patients · read only$/)).toBeVisible();
    await expect(screen.getByRole('button', /^Coding audit\. /)).toBeVisible();
    await expect(screen.getByRole('button', /^Training data\. /)).toBeVisible();
    await openMenu(screen);
    await expect(screen.getByText(USERS.manager.name)).toBeVisible();
    await expect(screen.getByLabel('Role: Management')).toBeVisible({ timeout: 15_000 });
    await expect(screen.getByRole('button', /^Coding audit, /)).toBeVisible();
    await expect(screen.getByRole('button', /^Training data, /)).toBeVisible();

    await openAmeliaVisit(screen);
    await screen.getByRole('button', /^Discharge\. /).tap();
    await screen.scrollUntilVisible(screen.getByRole('button', "Needs a doctor's approval. Locked"), { timeout: 30_000 });
  });
});
