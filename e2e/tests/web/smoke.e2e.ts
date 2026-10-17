import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('smoke', { tags: ['smoke'] }, () => {
  test('Sona Pro asks a signed-out visitor to sign in', async ({ app, screen }) => {
    await app.open('/pro/today');
    await expect(screen.getByRole('heading', 'Sign in to your ward')).toBeVisible({ timeout: 15_000 });
  });

  test('Sona Care asks a signed-out visitor for a phone number', async ({ app, screen }) => {
    await app.open('/care/home');
    await expect(screen.getByRole('heading', 'Your recovery, between visits')).toBeVisible({ timeout: 15_000 });
  });

  test('the doctor lands on Today', { session: 'doctor' }, async ({ app, browser, screen }) => {
    await app.open('/pro/today');
    await expect(browser).toHaveURL('/pro/today');
    await expect(screen.getByRole('main')).toBeVisible();
  });

  test('the patient lands on Home', { session: 'patient' }, async ({ app, browser, screen }) => {
    await app.open('/care/home');
    await expect(browser).toHaveURL(/\/care\/home/);
    await expect(screen.getByRole('main')).toBeVisible();
  });
});

describe('agent smoke', { tags: ['smoke', 'ai'] }, () => {
  test('an agent reads the doctor\'s Today page', { session: 'doctor' }, async ({ app, agent, screen }) => {
    await app.open('/pro/today');
    await expect(screen.getByRole('main')).toBeVisible({ timeout: 15_000 });
    await agent.assert('the page is the Sona Pro Today page for a signed-in clinician, with patients or tasks for today');
  });
});
