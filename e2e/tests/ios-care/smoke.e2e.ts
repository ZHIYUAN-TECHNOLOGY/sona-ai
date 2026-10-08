import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { openSona } from '../../ios';

test('Sona Care opens on the welcome screen', { tags: ['smoke'] }, async (fixtures) => {
  await openSona(fixtures, 8094);
  await expect(fixtures.screen.getByRole('button', 'Continue with phone number')).toBeVisible({ timeout: 180_000 });
});
