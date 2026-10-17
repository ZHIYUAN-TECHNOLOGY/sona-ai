import { describe, test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { dragUntilVisible, openAs, openMenu } from './helpers';

const count = (text: string | null) => Number(/(\d+)$/.exec(text ?? '')?.[1] ?? NaN);

// Today (features/day): who needs the doctor now, ranked, from the seeded synthetic ward; every count agrees.
describe('Today and patients', { tags: ['pro', 'ios', 'deep'], serial: true }, () => {
  let needsYou = 0;

  test('Today greets the doctor and ranks who needs them, with reasons', async (fixtures) => {
    const { screen } = fixtures;
    await openAs(fixtures);
    await expect(screen.getByText(/^Good (morning|afternoon|evening)$/)).toBeVisible();
    await expect(screen.getByRole('button', /^Today \w+day \d{1,2} \w+\. Choose another day$/)).toBeVisible();
    const header = screen.getByText(/^NEEDS YOU NOW · \d+$/);
    needsYou = count(await header.textContent());
    expect(needsYou).toBeGreaterThan(0);
    await expect(screen.getByRole('button', `See all ${needsYou}, needs you now`)).toBeVisible();
    // The seeded reasons, each with its action in place. Which leads moves with live events (a patient's urgent
    // message from Sona Care tops Daniel's low potassium), so the order is not pinned, only the reasons.
    await expect(screen.getByRole('button', /^Most urgent: .+\. /)).toBeVisible();
    await expect(screen.getByRole('button', /^(Most urgent: )?Daniel Rahman\. Low potassium 3\.1 mmol\/L/)).toBeVisible();
    await expect(screen.getByRole('button', 'Review, Daniel Rahman')).toBeVisible();
    await expect(screen.getByRole('button', /^(Most urgent: )?Amelia Tan\. /)).toBeVisible();
    await expect(screen.getByRole('button', /^Hafizah Yusof\. \d+ medicines? unconfirmed$/)).toBeVisible();
    // The keys carry live lines, never "Reading…" once the record is read.
    await expect(screen.getByRole('button', /^Results\. Low potassium · Daniel$/)).toBeVisible();
    await expect(screen.getByRole('button', /^Patients\. Reading/)).toBeHidden();
  });

  test('the blocked discharges agree with the Ward key', async ({ screen }) => {
    // Today's scroll view ignores synthesized scrolls, so it is dragged.
    const blocked = screen.getByText(/^DISCHARGES BLOCKED · \d+$/);
    await dragUntilVisible(screen, blocked, { timeout: 30_000 });
    const n = count(await blocked.textContent());
    expect(n).toBeGreaterThan(0);
    await dragUntilVisible(screen, screen.getByRole('button', /^Bed 6 · Amelia\. /), { timeout: 30_000 });
    await dragUntilVisible(screen, screen.getByRole('button', `Ward. ${n} discharges blocked`), { timeout: 30_000, back: true });
    // The sidebar repeats the same lines.
    await openMenu(screen);
    await expect(screen.getByRole('button', `Ward, ${n} discharges blocked`)).toBeVisible();
  });

  test('Patients agrees with Today: the same count needs you, the same visits today', async ({ screen }) => {
    // After midnight the clinic day is empty: "No visits today".
    const row = screen.getByRole('button', /^Patients, (\d+ visits?|No visits) today$/);
    const visits = Number(/(\d+) visits?/.exec((await row.textContent()) ?? '')?.[1] ?? 0);
    await row.tap();
    await expect(screen.getByLabel('Search patients')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText(new RegExp(`^\\d+ patients · ${needsYou} patients need you`))).toBeVisible();
    await expect(screen.getByRole('button', `Needs you, ${needsYou}`, { selected: true })).toBeVisible();
    // The clinic tab is there only on a day with visits.
    if (visits) await expect(screen.getByRole('button', `Clinic today, ${visits}`)).toBeVisible();
    else await expect(screen.getByRole('button', /^Clinic today, /)).toBeHidden();
    await expect(screen.getByText(`Needs you now · ${needsYou}`)).toBeVisible();
    await expect(screen.getByRole('button', /^Daniel Rahman, .*Low potassium 3\.1 mmol\/L$/)).toBeVisible();
    await expect(screen.getByRole('button', /^Amelia Tan, /)).toBeVisible();
  });

  test('searching finds Amelia by her ID, and a name nobody has finds no one', async ({ screen }) => {
    const search = screen.getByLabel('Search patients');
    await search.fill('SYN-1042');
    await expect(screen.getByRole('button', /^Amelia Tan, /)).toBeVisible();
    await expect(screen.getByRole('button', /^Daniel Rahman, /)).toBeHidden();
    await search.fill('Zzyzx Nobody');
    await expect(screen.getByText('No one matches. Try a name, patient ID or bed.')).toBeVisible();
    await search.fill('');
    await expect(screen.getByRole('button', /^Daniel Rahman, /)).toBeVisible();
  });

  test('Amelia’s page shows her record: ID, allergy, observations, history', async ({ screen }) => {
    await screen.getByRole('button', /^Amelia Tan, /).tap();
    await expect(screen.getByText('42 · Female · SYN-1042')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('button', 'Open visit with Amelia Tan')).toBeVisible();
    await expect(screen.getByRole('button', /^Medicines\. Penicillin allergy · \d+ unconfirmed$/)).toBeVisible();
    await expect(screen.getByRole('button', /^Hand over\. /)).toBeVisible();
    await expect(screen.getByRole('button', 'Pin Amelia Tan to Continue')).toBeVisible();
    await screen.scrollUntilVisible(screen.getByText('38.1 °C'));
    await expect(screen.getByText('Cough for five days, with fever since yesterday.')).toBeVisible();
    await expect(screen.getByText('97%')).toBeVisible();
    await expect(screen.getByText('96 bpm')).toBeVisible();
    await screen.scrollUntilVisible(screen.getByText(/^Asthma since childhood · Medicines: \d+$/));
    await expect(screen.getByRole('button', 'Full history & sources')).toBeVisible();
    // Doctors see who opened the record (PDPA trail): this doctor, just now.
    await screen.scrollUntilVisible(screen.getByLabel(/^Dr Test Aisyah · /).first());
  });
});
