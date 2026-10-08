import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { openSona } from '../../ios';
import { landed, PORT, signOut } from './helpers';

test('Sona Pro opens on the sign-in gate', { tags: ['pro', 'ios', 'smoke'] }, async (fixtures) => {
  const { screen } = fixtures;
  await openSona(fixtures, PORT);
  const user = screen.getByLabel('Username or email');
  // Sign-in persists across launches: a signed-in doctor (the other files leave one) signs out first.
  if (await landed(screen) === 'home') {
    await signOut(screen);
    await openSona(fixtures, PORT);
  }
  await expect(user).toBeVisible({ timeout: 180_000 });
  await expect(screen.getByText("Sign in to use your hospital's records.")).toBeVisible();
});
