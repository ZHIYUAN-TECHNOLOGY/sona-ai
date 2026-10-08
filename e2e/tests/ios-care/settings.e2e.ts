import { describe, test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { route, settingsButton, signedIn, tab, TAGS } from './care';

// One launch: Settings from home's initials, Malay across the app and back, and the training consent page.
describe('Sona Care settings', { tags: [...TAGS, 'deep'], serial: true }, () => {
  test('Settings holds language, reminders, help improve and sign out', async f => {
    const { screen } = f;
    await signedIn(f);
    await settingsButton(screen).tap();
    await expect(screen.getByLabel('Your. settings')).toBeVisible();
    await expect(screen.getByLabel('Choose your language')).toBeVisible();
    // The three languages, each named in its own words.
    for (const name of ['English', 'Bahasa Melayu', '中文']) await expect(screen.getByLabel(name, { exact: true })).toBeVisible();
    await expect(screen.getByRole('switch', 'Dose reminders')).toBeVisible();
    await expect(screen.getByRole('button', /^Help improve Sona Care: (On|Off)$/)).toBeVisible();
    await expect(screen.getByRole('button', 'Sign out')).toBeVisible();
  });

  test('Malay changes Sona Care\'s own words at once, and English brings them back', async f => {
    const { screen } = f;
    try {
      await screen.getByLabel('Bahasa Melayu', { exact: true }).tap();
      await expect(screen.getByLabel('Tetapan. anda')).toBeVisible();
      await expect(screen.getByLabel('Pilih bahasa anda')).toBeVisible();
      await expect(screen.getByRole('button', /^Bantu tambah baik Sona Care: (Hidup|Tutup)$/)).toBeVisible();
      await expect(screen.getByRole('button', 'Log keluar')).toBeVisible();
      await screen.getByRole('button', 'Kembali').tap();
      // Home and the dock follow; clinical words the care team wrote would stay as written.
      await expect(screen.getByLabel(/^Helo! Amelia, /)).toBeVisible();
      await expect(screen.getByRole('button', 'Amelia Tan. Tetapan')).toBeVisible();
      for (const place of ['Utama', 'Jadual', 'Ubat', 'Doktor']) await expect(screen.getByLabel(place, { exact: true })).toBeVisible();
      await expect(screen.getByRole('button', 'Tanya Sona Care')).toBeVisible();
      await screen.getByLabel('Jadual', { exact: true }).tap();
      await expect(screen.getByLabel(/^Jadual\. /)).toBeVisible();
    } finally {
      // English again whatever happened above: the choice is kept on the phone for every later test.
      await route(f, 'settings');
      await screen.getByLabel('English', { exact: true }).tap();
    }
    await expect(screen.getByLabel('Your. settings')).toBeVisible();
    await expect(screen.getByLabel('Choose your language')).toBeVisible();
    await screen.getByRole('button', 'Back').tap();
    await expect(tab(screen, 'Schedule')).toBeVisible();
  });

  test('Help improve explains what is shared; switching it on and off again asks first', async f => {
    const { screen } = f;
    await route(f, 'help-improve');
    await expect(screen.getByLabel('Help improve. Sona Care. Off unless you switch it on. Saying no changes nothing about your care.')).toBeVisible();
    await expect(screen.getByLabel("What is used, Your check-in replies, and your doctor's corrected notes about you.")).toBeVisible();
    await expect(screen.getByLabel(/^Never used, Your name, IC and phone number\./)).toBeVisible();
    await expect(screen.getByLabel(/^Who sees it, /)).toBeVisible();
    await expect(screen.getByLabel(/^Change your mind, /)).toBeVisible();
    const share = screen.getByRole('switch', 'Share to help improve');
    // Amelia's consent is off unless a run left it on; this test leaves it off.
    if (await share.isChecked()) {
      await share.tap();
      await screen.getByRole('button', 'Stop sharing').tap();
    }
    await expect(screen.getByText('Off · nothing is shared')).toBeVisible({ timeout: 30_000 });
    await share.tap();
    await expect(share).toBeChecked({ timeout: 30_000 });
    await expect(screen.getByText(/^On since /)).toBeVisible();
    await share.tap();
    await expect(screen.getByText('Stop sharing? Replies and notes not yet used will be taken out.')).toBeVisible();
    await screen.getByRole('button', 'Keep sharing').tap();
    await expect(share).toBeChecked();
    await share.tap();
    await screen.getByRole('button', 'Stop sharing').tap();
    await expect(screen.getByText('Off · nothing is shared')).toBeVisible({ timeout: 30_000 });
    await expect(share).not.toBeChecked();
  });
});
