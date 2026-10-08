import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { LOAD, main } from './helpers';

describe('errors and edge states', { tags: ['pro', 'deep'] }, () => {
  test('an unknown patient ID says so and links back to the list', { session: 'doctor' }, async ({ app, screen, browser }) => {
    await app.open('/pro/patients/SYN-0000');
    await expect(main(screen)).toContainText('No patient with this ID at your hospital.', LOAD);
    await expect(screen.getByRole('heading', { name: 'Patient overview', level: 1 })).toHaveCount(0);
    await main(screen).getByRole('link', 'Back to patients').tap();
    await expect(browser).toHaveURL('/pro/patients', LOAD);
  });

  test('an unknown result says so and offers the way back', { session: 'doctor' }, async ({ app, screen, browser }) => {
    await app.open('/pro/results/no-such-result');
    await expect(screen.getByRole('heading', { name: 'Result', level: 1 })).toBeVisible(LOAD);
    await expect(main(screen)).toContainText('No such result');
    await expect(main(screen)).toContainText('It may have been removed, or it belongs to another hospital.');
    await main(screen).getByRole('link', 'Back to results').tap();
    await expect(browser).toHaveURL('/pro/results', LOAD);
  });

  test('an unknown visit says so instead of an empty note', { session: 'doctor' }, async ({ app, screen }) => {
    await app.open('/pro/visit?encounterId=visit-0000');
    await expect(screen.getByRole('heading', { name: 'Visit note', level: 1 })).toBeVisible(LOAD);
    await expect(main(screen)).toContainText('No encounter visit-0000', LOAD);
    // No note is offered for writing, and nothing can be ordered or reasoned about.
    await expect(screen.getByRole('textbox', 'Assessment')).toHaveCount(0);
    await expect(screen.getByRole('button', 'Save the note')).toHaveCount(0);
    await expect(screen.getByRole('button', 'Think it through')).toBeDisabled();
  });

  test('a search that matches nothing says so on every list', { session: 'doctor' }, async ({ app, screen }) => {
    const miss = `zz${Date.now()}`;
    await app.open('/pro/discharge');
    await screen.getByRole('searchbox', 'Search patients by name').fill(miss);
    await expect(main(screen).getByRole('link', 'Open plan →')).toHaveCount(0, LOAD);
    await app.open('/pro/guarantee-letter');
    await screen.getByRole('searchbox', 'Search patients by name').fill(miss);
    await expect(main(screen).getByRole('link', 'Open letter →')).toHaveCount(0, LOAD);
    await app.open('/pro/audit');
    await screen.getByRole('searchbox', 'Search findings').fill(miss);
    await expect(main(screen).getByRole('table')).toContainText(/No findings match|No open items/, LOAD);
  });

  test('an unknown page under /pro does not crash the app', { session: 'doctor' }, async ({ app, screen }) => {
    await app.open('/pro/no-such-page');
    await expect(screen.getByText(/not found|no such page|doesn't exist|does not exist/i).first()).toBeVisible(LOAD);
  });

  test('the Sona panel closes to the orb and opens again', { session: 'doctor' }, async ({ app, screen }) => {
    await app.open('/pro/ward');
    const panel = screen.getByRole('complementary', 'Sona');
    await expect(panel).toBeVisible(LOAD);
    await panel.getByRole('button', 'Close Sona').tap();
    await expect(panel).toHaveCount(0);
    const orb = screen.getByRole('button', /^Ask Sona \((⌘K|Ctrl\+K)\)/);
    await orb.tap();
    await expect(screen.getByRole('complementary', 'Sona')).toBeVisible();
    await expect(screen.getByRole('textbox', 'Ask Sona')).toBeFocused();
    // An empty question cannot be sent.
    await expect(screen.getByRole('button', 'Send to Sona')).toBeDisabled();
  });
});
