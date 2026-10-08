import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { PATIENT, signIn } from './care';

const GREETING = /^Good (morning|afternoon|evening), Amelia$/;

describe('Sona Care sign-in', { tags: ['care'] }, () => {
  // One demo number means one stored code: a second "Send code" replaces the first, so these run one after another.
  describe('with the demo number', { serial: true }, () => {
    test('the demo number, then the demo code, signs Amelia in to Home', { tags: ['smoke'] }, async ({ app, screen, browser }) => {
      await app.open('/care/sign-in');
      await expect(screen.getByRole('heading', 'Your recovery, between visits')).toBeVisible({ timeout: 15_000 });
      await expect(screen.getByRole('button', 'Send code')).toBeDisabled();
      await screen.getByRole('button', `Demo number: ${PATIENT.phone}`).tap();
      await expect(screen.getByLabel('Mobile number (+60)')).toHaveValue(PATIENT.phone);
      await screen.getByRole('button', 'Send code').tap();

      await expect(screen.getByRole('heading', 'Enter your code')).toBeVisible();
      await expect(screen.getByText(`We sent a 6-digit code to ${PATIENT.phone}.`)).toBeVisible();
      await expect(screen.getByRole('button', 'Sign in')).toBeDisabled();
      await screen.getByRole('button', `Demo code: ${PATIENT.code}`).tap();
      await expect(screen.getByLabel('6-digit code')).toHaveValue(PATIENT.code);
      await screen.getByRole('button', 'Sign in').tap();

      await expect(browser).toHaveURL('/care/home', { timeout: 20_000 });
      await expect(screen.getByRole('heading', GREETING, { level: 1 })).toBeVisible({ timeout: 15_000 });
      const side = screen.getByRole('navigation', 'Sona Care');
      await expect(side).toContainText(PATIENT.name);
      await expect(side).toContainText(PATIENT.hospital);
    });

    test('a wrong code is refused and cleared; "Change number" goes back; the demo code then works', async ({ app, screen, browser }) => {
      await app.open('/care/sign-in');
      await screen.getByRole('button', `Demo number: ${PATIENT.phone}`).tap();
      await screen.getByRole('button', 'Send code').tap();
      await expect(screen.getByRole('heading', 'Enter your code')).toBeVisible();

      const code = screen.getByLabel('6-digit code');
      await code.fill('000000');
      await screen.getByRole('button', 'Sign in').tap();
      await expect(screen.getByRole('alert')).toBeVisible({ timeout: 15_000 });
      await expect(screen.getByRole('alert')).not.toHaveText('');
      await expect(code).toHaveValue('');
      await expect(screen.getByRole('button', 'Sign in')).toBeDisabled();
      await expect(browser).toHaveURL('/care/sign-in');

      await screen.getByRole('button', 'Change number').tap();
      await expect(screen.getByRole('heading', 'Your recovery, between visits')).toBeVisible();
      await expect(screen.getByRole('alert')).toHaveCount(0);
      await expect(screen.getByLabel('Mobile number (+60)')).toHaveValue(PATIENT.phone);

      await screen.getByRole('button', 'Send code').tap();
      await screen.getByRole('button', `Demo code: ${PATIENT.code}`).tap();
      await screen.getByRole('button', 'Sign in').tap();
      await expect(browser).toHaveURL('/care/home', { timeout: 20_000 });
    });

    test('a wrong code is explained in plain words', async ({ app, screen }) => {
      // sign-in.tsx:47 prefers better-auth's message ("Invalid OTP") over its own plain line, so a patient reads "OTP".
      test.skip(true, 'BUG: a wrong sign-in code shows "Invalid OTP" instead of plain words (apps/web/src/routes/care/sign-in.tsx:47)');
      await app.open('/care/sign-in');
      await screen.getByRole('button', `Demo number: ${PATIENT.phone}`).tap();
      await screen.getByRole('button', 'Send code').tap();
      await screen.getByLabel('6-digit code').fill('000000');
      await screen.getByRole('button', 'Sign in').tap();
      await expect(screen.getByRole('alert')).toBeVisible({ timeout: 15_000 });
      await expect(screen.getByRole('alert')).toHaveText('That code did not work. Check it, or send a new one.');
    });

    test('signing out ends the session: Care pages ask for a number again', async ({ app, screen, browser }) => {
      // Its own sign-in, so signing out never revokes the session other tests share.
      await app.open('/care/sign-in');
      await signIn(screen);
      await expect(screen.getByRole('heading', GREETING, { level: 1 })).toBeVisible({ timeout: 20_000 });
      await screen.getByRole('navigation', 'Sona Care').getByRole('button', 'Sign out').tap();
      await expect(browser).toHaveURL('/care/sign-in', { timeout: 15_000 });
      await expect(screen.getByRole('heading', 'Your recovery, between visits')).toBeVisible();
      await app.open('/care/messages');
      await expect(browser).toHaveURL('/care/sign-in', { timeout: 15_000 });
      await expect(screen.getByLabel('Mobile number (+60)')).toBeVisible();
    });
  });

  test('a number that is not a Malaysian mobile cannot be sent', async ({ app, screen }) => {
    await app.open('/care/sign-in');
    const phone = screen.getByLabel('Mobile number (+60)');
    await phone.fill('12345');
    await expect(screen.getByRole('button', 'Send code')).toBeDisabled();
    await phone.fill('012-345 6789');
    await expect(screen.getByRole('button', 'Send code')).toBeEnabled();
  });

  test('the sign-in page offers the phone code only (no email and password on the web)', async ({ app, screen }) => {
    await app.open('/care/sign-in');
    await expect(screen.getByLabel('Mobile number (+60)')).toBeVisible({ timeout: 15_000 });
    await expect(screen.getByText('First time? Sign in, then enter the code on your discharge paper.')).toBeVisible();
    await expect(screen.getByLabel(/password/i)).toHaveCount(0);
    await expect(screen.getByLabel(/email/i)).toHaveCount(0);
  });

  for (const page of ['/care/home', '/care/messages', '/care/medicines', '/care/join']) {
    test(`a signed-out visit to ${page} lands on sign-in`, { tags: ['smoke'] }, async ({ app, screen, browser }) => {
      await app.open(page);
      await expect(browser).toHaveURL('/care/sign-in', { timeout: 15_000 });
      await expect(screen.getByRole('heading', 'Your recovery, between visits')).toBeVisible();
    });
  }
});

describe('Sona Care join', { tags: ['care'] }, () => {
  test('a code that is not on any discharge paper is refused in plain words, and nothing is joined', { session: 'patient' }, async ({ app, screen, browser }) => {
    await app.open('/care/join');
    await expect(screen.getByRole('heading', 'Join your care plan')).toBeVisible({ timeout: 15_000 });
    const check = screen.getByRole('button', 'Check code');
    await expect(check).toBeDisabled();
    await screen.getByLabel('Your code').fill('ZZZZ-9999');
    await check.tap();
    await expect(screen.getByRole('alert')).toHaveText('That code was not recognised. Check it against your discharge paper.', { timeout: 15_000 });
    await expect(screen.getByRole('button', /^Yes, I am/)).toHaveCount(0);
    await expect(browser).toHaveURL('/care/join');
    // Still Amelia's account and record.
    await app.open('/care/home');
    await expect(screen.getByRole('heading', GREETING, { level: 1 })).toBeVisible({ timeout: 15_000 });
  });

  test('a code too short to be one is refused in plain words', {
    session: 'patient',
    // join.tsx:19 shows any Error's message; care.preview's input schema (packages/api/src/routers/care.ts:45, min 8) refuses
    // "AB12" with oRPC's "Input validation failed", so the patient reads that instead of the page's plain fallback (join.tsx:39).
    skip: 'BUG: a short join code shows "Input validation failed" (apps/web/src/routes/care/join.tsx:19, 39)',
  }, async ({ app, screen }) => {
    await app.open('/care/join');
    await screen.getByLabel('Your code').fill('AB12');
    await screen.getByRole('button', 'Check code').tap();
    await expect(screen.getByRole('alert')).toHaveText(/^(That code was not recognised\. Check it against your discharge paper\.|We could not use that code\. Check it, or ask the ward for a new one\.)$/, { timeout: 15_000 });
  });
});
