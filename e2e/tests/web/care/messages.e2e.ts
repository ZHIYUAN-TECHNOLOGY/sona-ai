import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { PATIENT, settled } from './care';
import { LOG } from '../roles';

const STATUS = /^(Sent\. Your care team will see it\.|Seen by your care team|Replied)$/;

describe('Sona Care messages', { tags: ['care', 'deep'], session: 'patient' }, () => {
  test('the page says who reads her messages and what to do when it cannot wait', async ({ app, screen }) => {
    await app.open('/care/messages');
    await settled(screen);
    await expect(screen.getByRole('heading', 'Your care team', { level: 2 })).toBeVisible();
    await expect(screen.getByRole('main')).toContainText(PATIENT.hospital);
    const rail = screen.getByRole('complementary', 'Before you write');
    await expect(rail).toContainText('Chest pain, fainting or trouble breathing cannot wait for a reply.');
    await expect(rail.getByRole('link', 'Call 999')).toHaveAttribute('href', 'tel:999');
    await expect(rail.getByRole('link', 'Ask Sona')).toHaveAttribute('href', '/care/ask');
    await expect(screen.getByRole('button', 'Send')).toBeDisabled();
  });

  test('a message she sends shows in the thread at once, with its sent state', { tags: ['smoke'] }, async ({ app, screen, browser }) => {
    await app.open('/care/messages');
    await settled(screen);
    const text = `E2E ${Date.now()}: Can I start walking outside again this week?`;
    const box = screen.getByLabel('Write a message');
    await box.fill(text);
    const sent = browser.waitForResponse('**/rpc/care/messages/send', { timeout: 60_000 });
    await screen.getByRole('button', 'Send').tap();
    await expect(box).toHaveValue('');
    expect((await sent).status).toBe(200);

    const mine = screen.getByRole(LOG, 'Messages with your care team').getByRole('listitem').filter({ hasText: text });
    await expect(mine).toBeVisible({ timeout: 30_000 });
    await expect(mine).toContainText(/You · \d{1,2}:\d{2}/);
    await expect(screen.getByText(STATUS)).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('main')).toContainText(/You wrote at .+\. Waiting for a reply\.|Your care team replied/);
    // It is stored, not only shown: a fresh load still has it.
    await browser.reload();
    await expect(screen.getByRole(LOG, 'Messages with your care team').getByRole('listitem').filter({ hasText: text })).toBeVisible({ timeout: 20_000 });
  });

  test('an urgent sign gets Sona\'s call-999 line at once, in red', { tags: ['models'], timeout: 180_000 }, async ({ app, screen, browser }) => {
    await app.open('/care/messages');
    await settled(screen);
    const text = `E2E ${Date.now()}: I have chest pain and I can't breathe properly`;
    const box = screen.getByLabel('Write a message');
    await box.fill(text);
    // Enter sends.
    const sent = browser.waitForResponse('**/rpc/care/messages/send', { timeout: 120_000 });
    await box.press('Enter');
    expect((await sent).status).toBe(200);

    const log = screen.getByRole(LOG, 'Messages with your care team');
    await expect(log.getByRole('listitem').filter({ hasText: text })).toBeVisible({ timeout: 30_000 });
    // Sona's line comes right after her message (it is stored a millisecond after it).
    const after = async () => {
      const items = await log.getByRole('listitem').allTextContents();
      const i = items.findIndex(t => t.includes(text));
      return { i, next: i >= 0 ? items[i + 1] ?? '' : '' };
    };
    await expect.poll(async () => (await after()).next, { timeout: 60_000 }).toContain('Sona · automatic safety reply');
    const alert = log.getByRole('listitem').nth((await after()).i + 1).getByRole('alert');
    // In her language: English while admitted, her discharge leaflet's language (Malay in the demo) once she is home.
    await expect(alert).toContainText(PATIENT.first);
    await expect(alert).toContainText(/\b999\b/);

    // Red is only for "call the hospital now": this bubble wears it, her own does not.
    const colours = await browser.evaluate(() => {
      const probe = document.createElement('i');
      probe.style.color = 'var(--red)';
      document.querySelector('.care')!.append(probe);
      const red = getComputedStyle(probe).color;
      probe.remove();
      const bubbles = Array.from(document.querySelectorAll('.cm-bubble'));
      const urgent = bubbles.filter(b => b.getAttribute('role') === 'alert').at(-1)!;
      const mine = Array.from(document.querySelectorAll('.cm-mine .cm-bubble')).at(-1)!;
      return { red, urgent: getComputedStyle(urgent).boxShadow, mine: `${getComputedStyle(mine).boxShadow} ${getComputedStyle(mine).backgroundColor}` };
    });
    expect(colours.urgent).toContain(colours.red);
    expect(colours.mine).not.toContain(colours.red);
  });
});
