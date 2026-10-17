import { describe, test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { declineSavePassword, enterDemoCode, homeGreeting, launch, settingsButton, signOut, TAGS, welcomeButton } from './care';

// One launch for the whole sign-in story: it starts signed out (signing out if a previous run left Amelia in) and
// walks the welcome, the phone path (a wrong code, Change number, the demo code), sign out, and the email path, and
// ends signed out.
describe('Sona Care sign-in', { tags: [...TAGS, 'smoke'], serial: true }, () => {
  test('the welcome offers phone, Google, Apple and email', async f => {
    const { screen } = f;
    if (await launch(f) === 'home') await signOut(f);
    await expect(screen.getByLabel('Your recovery, between visits')).toBeVisible();
    await expect(screen.getByText('Check-ins, your discharge plan and your care team, from your hospital.')).toBeVisible();
    await expect(welcomeButton(screen)).toBeVisible();
    await expect(screen.getByRole('button', 'Continue with Google')).toBeVisible();
    await expect(screen.getByRole('button', 'Continue with Apple')).toBeVisible();
    await expect(screen.getByRole('button', 'Use email instead')).toBeVisible();
    await expect(screen.getByRole('button', 'Language: English')).toBeVisible();
  });

  test('the welcome switches to Malay and back before sign-in', async ({ screen }) => {
    await screen.getByRole('button', 'Language: English').tap();
    await expect(screen.getByLabel('Choose your language')).toBeVisible();
    try {
      await screen.getByLabel('Bahasa Melayu', { exact: true }).tap();
      await expect(screen.getByLabel('Pilih bahasa anda')).toBeVisible();
      await screen.getByRole('button', 'Selesai').tap();
      await expect(screen.getByRole('button', 'Teruskan dengan nombor telefon')).toBeVisible();
      await expect(screen.getByRole('button', 'Guna e-mel')).toBeVisible();
      await expect(screen.getByRole('button', 'Bahasa: Bahasa Melayu')).toBeVisible();
      await screen.getByRole('button', 'Bahasa: Bahasa Melayu').tap();
    } finally {
      // Back to English whatever happened above, so later tests read English (the choice is kept on the phone).
      await screen.getByLabel('English', { exact: true }).tap();
      await screen.getByRole('button', 'Done').tap();
    }
    await expect(welcomeButton(screen)).toBeVisible();
    await expect(screen.getByRole('button', 'Language: English')).toBeVisible();
  });

  test('the phone step offers the demo number and sends a code', async ({ screen }) => {
    await welcomeButton(screen).tap();
    await expect(screen.getByLabel("Let's start by adding your number")).toBeVisible();
    await expect(screen.getByRole('button', 'Send code', { disabled: true })).toBeVisible();
    await screen.getByRole('button', /^Demo patient: tap to use 0\d+$/).tap();
    await screen.getByRole('button', 'Send code').tap();
    await expect(screen.getByLabel('Now enter the code we sent')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText(/^Sent by SMS to \+60\d+$/)).toBeVisible();
    await expect(screen.getByLabel('Code, 0 of 6 digits')).toBeVisible();
    await expect(screen.getByRole('button', /^Resend in \d+ s$/)).toBeDisabled();
  });

  test('a wrong code is refused and cleared', async ({ screen, device }) => {
    // The six boxes sit over one hidden field that has focus; type through the number pad.
    for (let i = 0; i < 6; i++) await device.locator('role=key label="9"').tap();
    await expect(screen.getByLabel('Code, 0 of 6 digits')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByLabel('Now enter the code we sent')).toBeVisible();
    await expect(settingsButton(screen)).toBeHidden();
  });

  test('Change number goes back to the number, kept', async ({ screen }) => {
    await screen.getByRole('button', 'Change number').tap();
    await expect(screen.getByLabel("Let's start by adding your number")).toBeVisible();
    await expect(screen.getByRole('textbox')).toHaveValue('1100000000');
  });

  test('the demo number and demo code sign Amelia in', async f => {
    const { screen } = f;
    await screen.getByRole('button', 'Send code').tap();
    await enterDemoCode(f);
    await expect(homeGreeting(screen)).toBeVisible({ timeout: 30_000 });
    await expect(settingsButton(screen)).toBeVisible();
  });

  test('signing out from Settings asks first, then returns to the welcome', async f => {
    await signOut(f);
    await expect(f.screen.getByRole('button', 'Use email instead')).toBeVisible();
  });

  test('a wrong password is refused on the email path', async ({ screen }) => {
    await screen.getByRole('button', 'Use email instead').tap();
    await expect(screen.getByLabel('Sign in with your email')).toBeVisible();
    await expect(screen.getByText('Demo: patient / 123')).toBeVisible();
    await expect(screen.getByRole('button', 'Sign in', { disabled: true })).toBeVisible();
    // The field takes focus by itself as the step rises; typing before that races the keyboard coming up (the runner
    // then cannot confirm the text landed).
    await expect(screen.getByRole('textbox', 'Username or email')).toBeFocused();
    await screen.getByRole('textbox', 'Username or email').fill('patient');
    await screen.getByRole('textbox', 'Password').fill('not-the-password');
    // Go on the keyboard: the Sign in button is under it on this step (see the BUG test below).
    await screen.getByRole('textbox', 'Password').press('Enter');
    await expect(screen.getByText(/invalid|could not sign in/i)).toBeVisible({ timeout: 30_000 });
    await expect(settingsButton(screen)).toBeHidden();
  });

  test('patient / 123 signs in on the email path', async f => {
    const { screen } = f;
    // The public demo password, typed as plain text like the patient would.
    await screen.getByRole('textbox', 'Password').fill('123');
    await screen.getByRole('textbox', 'Password').press('Enter');
    await declineSavePassword(f);
    await expect(homeGreeting(screen)).toBeVisible({ timeout: 60_000 });
  });

  test('signing out again leaves the app on the welcome', async f => {
    // Ends signed out, the state smoke.e2e.ts opens on; the other suites sign themselves in.
    await signOut(f);
  });
});

test('a wrong code says "That code didn\'t work"', { tags: [...TAGS, 'deep'], skip: 'BUG: a wrong code shows better-auth\'s raw "Invalid OTP" (or "OTP not found") instead of in.codeFailed; apps/care/features/sign-in/welcome.tsx:310 prefers error.message' }, async f => {
  const { screen, device } = f;
  if (await launch(f) === 'home') await signOut(f);
  await welcomeButton(screen).tap();
  await screen.getByRole('button', /^Demo patient: tap to use 0\d+$/).tap();
  await screen.getByRole('button', 'Send code').tap();
  for (let i = 0; i < 6; i++) await device.locator('role=key label="9"').tap();
  await expect(screen.getByText("That code didn't work")).toBeVisible({ timeout: 30_000 });
});

test('the email step keeps Sign in above the keyboard', { tags: [...TAGS, 'deep'], skip: 'BUG: the email step turns keyboard avoidance off (apps/care/features/sign-in/welcome.tsx:133, enabled={step !== "email"}) on the claim that its button already sits above the keyboard; on this 402x874 iPhone the keyboard with its Passwords bar covers Sign in, so a tap lands on the keyboard' }, async f => {
  const { screen, device } = f;
  if (await launch(f) === 'home') await signOut(f);
  await screen.getByRole('button', 'Use email instead').tap();
  await expect(screen.getByRole('textbox', 'Username or email')).toBeFocused();
  await screen.getByRole('textbox', 'Username or email').fill('patient');
  await screen.getByRole('textbox', 'Password').fill('123');
  const button = await screen.getByRole('button', 'Sign in').boundingBox();
  const keyboard = await device.locator('role=keyboard').first().boundingBox();
  expect(button!.y + button!.height).toBeLessThanOrEqual(keyboard!.y);
});
