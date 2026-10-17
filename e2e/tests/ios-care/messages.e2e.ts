import { describe, test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { shown, signedIn, TAGS } from './care';

const composer = (screen: import('e2e').Screen) => screen.getByRole('textbox', /^Message to your care team/);
const status = /^(Sent · \d{2}:\d{2}|Seen by care team · \d{2}:\d{2})$/;
/** A bubble reads as one node: who, the time, then the words ("You, 22:48: …"). */
const mine = (screen: import('e2e').Screen, text: string) => screen.getByLabel(new RegExp(`^You, \\d{2}:\\d{2}: ${text}$`));

// One launch: the thread with the care team (care.messages), a plain message, then one naming a warning sign.
// Every message is a real write to the shared thread, marked E2E and the time.
describe('Messages with the care team', { tags: [...TAGS, 'smoke'], serial: true }, () => {
  test('the thread opens with the care team, likely replies and the emergency line', async f => {
    const { screen } = f;
    await signedIn(f);
    await screen.getByRole('button', /^Messages/).tap();
    await expect(screen.getByLabel('Care team, Demo General Hospital. Usually replies within a few hours')).toBeVisible();
    await expect(composer(screen)).toBeVisible();
    await expect(screen.getByRole('button', 'Send')).toBeDisabled();
    await expect(screen.getByRole('button', /\. Sends this to your care team$/).first()).toBeVisible();
    await expect(screen.getByText('Not for emergencies · call 999')).toBeVisible();
  });

  test('a message is sent and lands in the thread', async ({ screen }) => {
    const text = `E2E ${Date.now()} hello from the iPhone suite`;
    await composer(screen).fill(text);
    await screen.getByRole('button', 'Send').tap();
    await expect(mine(screen, text)).toBeVisible({ timeout: 30_000 });
    await expect(composer(screen)).toHaveValue(/^(Write to your care team…)?$/);
    // Opened again, the thread is the server's: the message is there, with its status under it.
    await screen.getByRole('button', 'Back').tap();
    await screen.getByRole('button', /^Messages/).tap();
    await expect(mine(screen, text)).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText(status)).toBeVisible({ timeout: 30_000 });
  });

  test('a warning sign is answered at once: call 999 now, with a Call 999 button', async ({ screen }) => {
    const text = `E2E ${Date.now()} I have chest pain since this morning`;
    await composer(screen).fill(text);
    await screen.getByRole('button', 'Send').tap();
    await expect(mine(screen, text)).toBeVisible({ timeout: 30_000 });
    // The server's safety rule answers it straight away (until then the app shows what to do while waiting), by name and
    // in her plan's language once she is home (Malay: "Hai Amelia, sila hubungi 999 …"), so only her name and 999 are fixed.
    await expect(screen.getByLabel(/^Sona · automatic safety message, \d{2}:\d{2}: .*\bAmelia\b.*\b999\b/).last()).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('button', 'Call 999').last()).toBeVisible();
    await expect(screen.getByText("Can't call from here? Dial 999 from any phone.").last()).toBeVisible();
  });

  test('likely replies fit where the thread stands', async ({ screen }) => {
    const chip = (p: string) => screen.getByRole('button', `${p}. Sends this to your care team`);
    // After the care team (or Sona's safety rule) has said to call 999 now, that message keeps a Call 999 button and the
    // replies are what the patient did about it; otherwise they follow the patient's own last message.
    if (await shown(chip("I've called 999"), 3_000)) {
      for (const p of ["I'm going to the emergency department", 'Please call me']) await expect(chip(p)).toBeVisible();
      const call = screen.getByRole('button', 'Call 999').last();
      await screen.scrollUntilVisible(call, { direction: 'up' });
      await expect(screen.getByText("Can't call from here? Dial 999 from any phone.").last()).toBeVisible();
    } else {
      for (const p of ['Thank you', 'When is my next visit?']) await expect(chip(p)).toBeVisible();
    }
    await screen.getByRole('button', 'Back').tap();
    await expect(screen.getByRole('button', 'Ask Sona Care')).toBeVisible();
  });
});
