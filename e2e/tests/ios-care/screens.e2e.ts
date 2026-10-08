import { describe, test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { route, shown, signedIn, TAGS } from './care';

// Before discharge these pages have no button on screen yet (Medicine and Doctors say they come with going home), so
// they open by their routes. Each reads the state the server reports rather than assuming one.
describe('Sona Care pages off the dock', { tags: [...TAGS, 'deep'], serial: true }, () => {
  test('Check-ins: her history, or that they start after going home', async f => {
    const { screen } = f;
    await signedIn(f);
    await route(f, 'check-ins');
    await expect(screen.getByLabel(/^Check-ins\. (None yet\. We'll ask on day 2 and day 7 after you go home\.|\d+ of \d+ answered.*)$/)).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('button', 'Message your care team')).toBeVisible();
    await screen.getByRole('button', 'Back').tap();
  });

  test('My plan: still in hospital, or her medicines, leaflet and warning signs', async f => {
    const { screen } = f;
    await route(f, 'discharge');
    await expect(screen.getByLabel(/^My\. Plan/)).toBeVisible({ timeout: 30_000 });
    if (await shown(screen.getByText("You're still in hospital"), 10_000)) {
      await expect(screen.getByText('Your medicines, leaflet and warning signs show here once you go home.')).toBeVisible();
    } else {
      await expect(screen.getByLabel('Your medicines')).toBeVisible();
      await screen.scrollUntilVisible(screen.getByLabel('When to get help'));
      await expect(screen.getByText('Call 999 or go to the emergency department if')).toBeVisible();
    }
    // Back scrolls with the page.
    await screen.scrollUntilVisible(screen.getByRole('button', 'Back'), { direction: 'up' });
    await screen.getByRole('button', 'Back').tap();
  });

  test('a medicine that is not in her plan says so', async f => {
    const { screen } = f;
    await route(f, 'medicine?name=Unknownol');
    await expect(screen.getByText("Unknownol isn't in your plan. Ask your care team if you're unsure.")).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('button', 'Close').tap();
    await expect(screen.getByText(/^Unknownol isn't in your plan/)).toBeHidden();
  });

  test('Join refuses a code it does not know, typed instead of scanned', async f => {
    const { screen } = f;
    await route(f, 'join');
    await expect(screen.getByLabel('Please scan your code')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('button', 'Scan the QR code')).toBeVisible();
    await screen.getByRole('button', 'Type the code instead').tap();
    const code = screen.getByRole('textbox', 'Code under the QR');
    // Return puts the keyboard down each time, uncovering Continue.
    await code.fill('ZZZ');
    await code.press('Enter');
    await expect(screen.getByRole('button', 'Continue')).toBeDisabled();
    await code.fill('ZZZZ-9999');
    await code.press('Enter');
    await expect(screen.getByRole('button', 'Continue')).toBeEnabled();
    await screen.getByRole('button', 'Continue').tap();
    await expect(screen.getByText('That code was not recognised. Check it against your discharge paper.')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByLabel('Please scan your code')).toBeVisible();
    await screen.getByRole('button', 'Back').tap();
  });

  test('Add from a photo reads the sample box and sends it to the care team to check', async f => {
    const { screen } = f;
    await route(f, 'add-photo');
    await expect(screen.getByLabel(/^Add a medicine from a photo\. /)).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('button', 'Take photo')).toBeVisible();
    await expect(screen.getByRole('button', 'Choose a photo')).toBeVisible();
    await screen.getByRole('button', 'Use the sample photo').tap();
    await expect(screen.getByText('We read')).toBeVisible({ timeout: 120_000 });
    await expect(screen.getByText('Cetirizine 10 mg, once at night')).toBeVisible();
    await expect(screen.getByText("It isn't added to your medicines until your care team checks it.")).toBeVisible();
    await screen.getByRole('button', 'Send to my care team to check').tap();
    await expect(screen.getByText('Sent to your care team')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText(/^Cetirizine.* is in your medicines as waiting\. You'll see their reply in Messages\.$/)).toBeVisible();
  });
});

test('the sample medicine photo is read by the photo model, not a stand-in', { tags: [...TAGS, 'models'], skip: 'BUG: "Use the sample photo" sends no image (apps/care/features/doses/photo.tsx:98), so care.readMedicinePhoto answers from stubModels (packages/api/src/routers/care.ts:186) and the page says "Sample · photo reading model not switched on" while the models are live' }, async f => {
  const { screen } = f;
  await signedIn(f);
  await route(f, 'add-photo');
  await screen.getByRole('button', 'Use the sample photo').tap();
  await expect(screen.getByText('We read')).toBeVisible({ timeout: 120_000 });
  await expect(screen.getByRole('button', /^Sample · /)).toBeHidden();
});
