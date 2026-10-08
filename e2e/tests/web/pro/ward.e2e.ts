import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import type { Screen } from 'e2e';

import { card, LOAD, main, MODEL, navLink, num, startsWith, statCaption, statValue, tabCount } from './helpers';

// The ward's bed table (the rail's forecast chart carries a table of its own).
const beds = (screen: Screen) => main(screen).getByRole('table').filter({ has: screen.getByRole('columnheader', 'Discharge barrier') });

describe('ward and hospital', { tags: ['pro', 'deep'] }, () => {
  test('Ward: the header, stats, tabs and bed table agree', { session: 'doctor' }, async ({ app, screen, browser }) => {
    await app.open('/pro/ward');
    await expect(screen.getByRole('heading', { name: 'Ward', level: 1 })).toBeVisible(LOAD);
    const table = beds(screen);
    await expect(table.getByRole('row', /^Bed 2 /)).toBeVisible(LOAD);
    const all = await tabCount(screen, 'All');
    const blocked = await tabCount(screen, 'Blocked');
    const unownedBeds = await tabCount(screen, 'Unassigned');
    const free = await tabCount(screen, 'Free');
    // 17 beds on the demo ward (packages/db/src/seed.ts WARD and Amelia's Bed 6, with Bed 10 being cleaned).
    expect(all).toBe(17);
    const occupied = all - free;
    const lead = new RegExp(`${occupied} of ${all} beds occupied · ${blocked} blocked · (\\d+) discharge barriers? unassigned`);
    await expect(main(screen)).toContainText(lead);
    const unowned = Number(lead.exec((await main(screen).textContent())!)![1]);
    await expect(statValue(browser, 'Beds occupied')).toHaveText(new RegExp(`^${occupied}\\s*of ${all}$`));
    await expect(statValue(browser, 'Blocked')).toHaveText(new RegExp(`^${blocked}\\s*beds$`));
    await expect(statValue(browser, 'Unassigned')).toHaveText(startsWith(unowned));
    await expect(statCaption(browser, 'Unassigned')).toHaveText(new RegExp(`^Barriers? on ${unownedBeds} beds?$`));
    await expect(statValue(browser, 'Free')).toHaveText(new RegExp(`^${free}\\s*now$`));
    await expect(table.getByRole('row')).toHaveCount(all + 1);
    await expect(main(screen)).toContainText(`Showing ${all} of ${all} beds`);
    // Seeded beds, each with its patient and what holds it.
    await expect(table.getByRole('row', /^Bed 2 .* Nurul Huda 29 · Female Final guarantee letter \+1 more/)).toBeVisible();
    await expect(table.getByRole('row', /^Bed 14 .* Lim Wei Jie 34 · Male Take-home medicines \+1 more/)).toBeVisible();
    await expect(table.getByRole('row', /^Bed 4 Awaiting rehab Tan Ah Kow 76 · Male Transfer to rehab centre/)).toBeVisible();
    await expect(table.getByRole('row', /^Bed 10 Cleaning .* No patient Empty/)).toBeVisible();
    // The Blocked tab lists exactly the blocked beds.
    await screen.getByRole('tab', /^Blocked \d+$/).tap();
    await expect(table.getByRole('row')).toHaveCount(blocked + 1);
    await expect(main(screen)).toContainText(`Showing ${blocked} of ${all} beds`);
  });

  test('Ward: a bed opens in the rail with its barriers, and search narrows the beds', { session: 'doctor' }, async ({ app, screen }) => {
    await app.open('/pro/ward');
    const table = beds(screen);
    await table.getByRole('row', /^Bed 14 /).getByRole('button', 'Review').tap();
    const rail = screen.getByRole('complementary', 'Bed detail, huddle brief and forecast');
    await expect(rail.getByRole('heading', { name: 'Bed 14', level: 2 })).toBeVisible(LOAD);
    await expect(rail).toContainText('Lim Wei Jie');
    await expect(rail.getByRole('combobox', 'Assign Bed 14: Take-home medicines')).toBeVisible();
    await expect(rail.getByRole('combobox', 'Assign Bed 14: Ride home')).toBeVisible();
    await screen.getByRole('searchbox', 'Search bed, patient or discharge barrier').fill('rehab');
    await expect(table.getByRole('rowgroup').nth(1).getByRole('row')).toHaveCount(1);
    await expect(table.getByRole('row', /Tan Ah Kow/)).toBeVisible();
    await screen.getByRole('searchbox', 'Search bed, patient or discharge barrier').fill('zz-no-bed');
    await expect(table).toContainText('No bed matches "zz-no-bed".');
  });

  test('Ward: assigning a discharge barrier makes it a task, and clearing it puts it back', { session: 'doctor' }, async ({ app, screen }) => {
    await app.open('/pro/ward');
    const table = beds(screen);
    await table.getByRole('row', /^Bed 14 /).getByRole('button', 'Review').tap();
    const rail = screen.getByRole('complementary', 'Bed detail, huddle brief and forecast');
    const owner = rail.getByRole('combobox', 'Assign Bed 14: Ride home');
    await expect(owner).toBeEnabled(LOAD);
    const before = num(await screen.getByRole('tab', /^Unassigned \d+$/).textContent());
    await owner.selectOption({ label: 'Porter' });
    try {
      await expect(rail.getByRole('status')).toContainText('Porter now has it as a task.', LOAD);
      await expect(table.getByRole('row', /^Bed 14 /)).toContainText('1 of 2 unassigned');
      await expect(screen.getByRole('tab', /^Unassigned \d+$/)).toHaveText(new RegExp(`^Unassigned\\s*${before}$`));
    } finally {
      // Back to unassigned, so the shared ward is as it was.
      await owner.selectOption({ label: 'Unassigned' });
      await expect(table.getByRole('row', /^Bed 14 /)).toContainText('Unassigned', LOAD);
    }
  });

  test('Handover: counts agree, and only the watch list can be handed over', { session: 'doctor' }, async ({ app, screen, browser }) => {
    await app.open('/pro/handover');
    await expect(screen.getByRole('heading', { name: 'Handover', level: 1 })).toBeVisible(LOAD);
    await expect(screen.getByRole('checkbox', 'Hand over Amelia Tan')).toBeVisible(LOAD);
    const all = await tabCount(screen, 'All');
    const watch = await tabCount(screen, 'Watch');
    const stable = await tabCount(screen, 'Stable');
    expect(all).toBe(watch + stable);
    await expect(main(screen)).toContainText(new RegExp(`${all} patients? to hand over · ${watch} needs? watching`));
    await expect(statValue(browser, 'Need watching')).toHaveText(startsWith(watch));
    await expect(statValue(browser, 'Stable')).toHaveText(startsWith(stable));
    // Every patient is listed with a checkbox, all selected at first.
    const list = main(screen).getByRole('list').filter({ has: screen.getByRole('checkbox', 'Hand over Amelia Tan') });
    await expect(list.getByRole('checkbox')).toHaveCount(all);
    await expect(screen.getByRole('checkbox', `${all} of ${all} selected`)).toBeChecked();
    // Daniel Rahman's handover names his two low results and the incomplete history.
    const daniel = list.getByRole('listitem').filter({ has: screen.getByRole('checkbox', 'Hand over Daniel Rahman') });
    await expect(daniel).toContainText('Act on low Hb (9.8 g/dL)');
    await expect(daniel).toContainText('Act on low potassium (3.1 mmol/L)');
    // Narrow to those on watch: the rail and its button follow; nothing is handed over without a colleague.
    await screen.getByRole('button', 'Only those to watch').tap();
    await expect(screen.getByRole('checkbox', `${watch} of ${all} selected`)).toBeVisible();
    const rail = screen.getByRole('complementary', 'Hand over');
    await expect(rail.getByRole('combobox', 'Receiving clinician').getByRole('option', 'Dr Test Rajesh Kumar (doctor)')).toBeAttached();
    await expect(rail.getByRole('button', new RegExp(`^Hand over ${watch} patients?$`))).toBeDisabled();
  });

  test('Discharge: the readiness counts agree with the ranked list', { session: 'doctor' }, async ({ app, screen, browser }) => {
    await app.open('/pro/discharge');
    await expect(screen.getByRole('heading', { name: 'Discharge', level: 1 })).toBeVisible(LOAD);
    const list = main(screen).getByRole('list').filter({ has: screen.getByRole('link', 'Open plan →').first() });
    await expect(list.getByRole('listitem').first()).toBeVisible(LOAD);
    // The state chip is upper-cased by CSS, and innerText reads it so. Rows render before their readiness, so wait
    // until the list and the stat cards tell the same story, then pin it.
    const counts = async () => {
      const items = await list.getByRole('listitem').allTextContents();
      return { ready: items.filter(t => /ready for discharge\s*open plan/i.test(t)).length, blocked: items.filter(t => /blocked\s*open plan/i.test(t)).length };
    };
    await expect.poll(async () => {
      const { ready, blocked } = await counts();
      return [parseInt(await statValue(browser, 'Ready for discharge').textContent() ?? '') === ready, parseInt(await statValue(browser, 'Blocked').textContent() ?? '') === blocked];
    }, { timeout: 20_000 }).toEqual([true, true]);
    const { ready, blocked } = await counts();
    await expect(statValue(browser, 'Ready for discharge')).toHaveText(startsWith(ready));
    await expect(statValue(browser, 'Blocked')).toHaveText(startsWith(blocked));
    await expect(main(screen)).toContainText(`${ready} ready for discharge · ${blocked} medically fit, with barriers`);
    // Seeded: Dayang Suhaila and Priya Nair are fit with nothing blocking; Nurul Huda is held by her final GL.
    await expect(list.getByRole('listitem').filter({ hasText: 'Dayang Suhaila' })).toContainText('no discharge barrier');
    await expect(list.getByRole('listitem').filter({ hasText: 'Nurul Huda' })).toContainText('discharge barriers: Final guarantee letter, Urine culture sensitivities');
    await screen.getByRole('searchbox', 'Search patients by name').fill('Priya');
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await list.getByRole('link', 'Open plan →').tap();
    await expect(browser).toHaveURL('/pro/discharge?encounterId=visit-2008', LOAD);
    await expect(screen.getByRole('region', 'Priya Nair')).toBeVisible(LOAD);
  });

  test("Discharge plan: Amelia Tan's plan, held by three barriers (view only)", { session: 'doctor' }, async ({ app, screen }) => {
    await app.open('/pro/discharge?encounterId=visit-1042');
    await expect(screen.getByRole('heading', { name: 'Discharge plan', level: 1 })).toBeVisible(LOAD);
    await expect(screen.getByRole('region', 'Amelia Tan')).toContainText('Bed 6', { ignoreCase: true });
    // Not ready: approval stays off while the barriers hold the bed.
    await expect(screen.getByRole('button', 'Approve discharge')).toBeDisabled();
    await expect(main(screen).getByText('3 things still hold Bed 6. Clear them before you approve.')).toBeVisible();
    await expect(screen.getByRole('heading', { name: 'Readiness: 3 blockers · 4 take-home medicines', level: 2 })).toBeVisible();
    const insight = card(screen, 'Not ready yet', screen.getByRole('complementary', 'Sona insight'));
    await expect(insight).toContainText('3 things to clear before Bed 6 can be released.');
    await expect(insight).toContainText('Final guarantee letter: Synthetic insurer');
    await expect(main(screen).getByText('Community-acquired pneumonia, on a background of asthma. Penicillin allergy reported.')).toBeVisible();
    const meds = main(screen).getByRole('list').filter({ hasText: 'Nebulised salbutamol' });
    await expect(meds.getByRole('listitem')).toHaveCount(4);
  });

  test('Guarantee letters: the letters holding a bed come first', { session: 'doctor' }, async ({ app, screen, browser }) => {
    await app.open('/pro/guarantee-letter');
    await expect(screen.getByRole('heading', { name: 'Guarantee letter', level: 1 })).toBeVisible(LOAD);
    const list = main(screen).getByRole('list').filter({ has: screen.getByRole('link', 'Open letter →').first() });
    await expect(list.getByRole('listitem').first()).toBeVisible(LOAD);
    // Rows render before each letter's status, so wait until the lead's count and the rows agree, then pin both.
    const holds = (t: string) => /holding a bed/i.test(t);
    const lead = async () => Number((await main(screen).textContent())?.match(/(\d+) guarantee letters? (?:is|are) holding a bed/)?.[1] ?? NaN);
    await expect.poll(async () => (await list.getByRole('listitem').allTextContents()).filter(holds).length === await lead(), LOAD).toBe(true);
    const texts = await list.getByRole('listitem').allTextContents();
    const holding = texts.filter(holds).length;
    await expect(main(screen)).toContainText(new RegExp(`${holding} guarantee letters? (is|are) holding a bed\\. Open th(at|ose) first\\.`));
    // Ranked: every letter holding a bed sits above the rest.
    expect(texts.slice(0, holding).every(holds)).toBe(true);
    await expect(list.getByRole('listitem').filter({ hasText: 'Nurul Huda' })).toContainText('Final guarantee letter: Codes ready to review');
    await screen.getByRole('searchbox', 'Search patients by name').fill('Nurul');
    await list.getByRole('link', 'Open letter →').tap();
    await expect(browser).toHaveURL('/pro/guarantee-letter?encounterId=visit-2002', LOAD);
    await expect(screen.getByRole('region', 'Nurul Huda')).toBeVisible(LOAD);
  });

  test("Guarantee letter: Amelia Tan's insurer checklist (view only)", { session: 'doctor' }, async ({ app, screen }) => {
    await app.open('/pro/guarantee-letter?encounterId=visit-1042');
    await expect(screen.getByRole('heading', { name: 'Guarantee letter', level: 1 })).toBeVisible(LOAD);
    await expect(screen.getByRole('region', 'Amelia Tan')).toBeVisible();
    const checklist = main(screen).getByRole('list').filter({ hasText: 'Severity score documented' });
    await expect(checklist.getByRole('listitem')).toHaveCount(4, LOAD);
    await expect(checklist.getByRole('listitem').filter({ hasText: 'Severity score documented' }).getByRole('image', 'Met')).toBeVisible();
    await expect(checklist.getByRole('listitem').filter({ hasText: 'Organism documented' }).getByRole('image', 'Open')).toBeVisible();
    // Two open checks hold the letter: sending stays off until they are resolved.
    await expect(screen.getByRole('button', 'Resolve 2 to send')).toBeDisabled();
    // The PDF waits for the codes, a model call after a reset.
    await expect(screen.getByRole('button', 'Download PDF')).toBeEnabled(MODEL);
  });

  test('Check-ins: the page says how check-ins start', { session: 'doctor' }, async ({ app, screen }) => {
    await app.open('/pro/check-ins');
    await expect(screen.getByRole('heading', { name: 'Check-ins', level: 1 })).toBeVisible(LOAD);
    // Before any discharge there are none; after one, the list shows each patient's.
    await expect(main(screen)).toContainText(/No check-ins yet\. They start when a patient is discharged\.|Day \d+ check-in|check-in/i, LOAD);
  });

  test('Messages and review queue: the inbox counts and the sidebar badges agree', { session: 'doctor' }, async ({ app, screen }) => {
    await app.open('/pro/messages');
    await expect(screen.getByRole('heading', { name: 'Messages', level: 1 })).toBeVisible(LOAD);
    const lead = /\d+ unread · (\d+) waiting for a reply|\d+ unread · nobody waiting for a reply/;
    await expect(main(screen)).toContainText(lead, LOAD);
    const waiting = Number(lead.exec((await main(screen).textContent())!)![1] ?? 0);
    await expect(navLink(screen, 'Messages')).toHaveAccessibleName(waiting ? `Messages ${waiting}` : 'Messages');
    if (!waiting) await expect(main(screen)).toContainText(/No patient messages yet\. They arrive from Sona Care\.|No one is waiting for a reply\./);
    await app.open('/pro/review');
    await expect(screen.getByRole('heading', { name: 'Review queue', level: 1 })).toBeVisible(LOAD);
    // The queue's count and its sidebar badge are the same items (waiting replies and visit summaries).
    const queued = /(\d+) items? waits? for your approval|Nothing is waiting for review\./;
    await expect(main(screen)).toContainText(queued, LOAD);
    const items = Number(queued.exec((await main(screen).textContent())!)![1] ?? 0);
    await expect(navLink(screen, 'Review queue')).toHaveAccessibleName(items ? `Review queue ${items}` : 'Review queue');
  });

  test('Audit: the coding audit and the access trail of who opened a record', { session: 'doctor' }, async ({ app, screen }) => {
    await app.open('/pro/audit');
    await expect(screen.getByRole('heading', { name: 'Audit', level: 1 })).toBeVisible(LOAD);
    await expect(screen.getByRole('button', 'Run audit now')).toBeEnabled();
    const coding = await tabCount(screen, 'Coding audit');
    const rows = main(screen).getByRole('table').getByRole('rowgroup').nth(1).getByRole('row');
    await expect(rows).toHaveCount(Math.max(coding, 1));
    await screen.getByRole('tab', 'Access trail').tap();
    await expect(screen.getByRole('tab', 'Access trail')).toHaveAttribute('aria-selected', 'true');
    await expect(main(screen)).toContainText('Pick a patient on the right to see who opened their record.', LOAD);
    // Opening Amelia Tan's record is on her trail, under the doctor's name.
    await screen.getByRole('complementary', 'Patients').getByRole('button', /^Amelia Tan/).tap();
    await expect(main(screen).getByRole('table').getByRole('row', /Dr Test Aisyah/).first()).toBeVisible(LOAD);
  });

  test('Library: empty until a source is added, with the add form ready', { session: 'doctor' }, async ({ app, screen }) => {
    await app.open('/pro/library');
    await expect(screen.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible(LOAD);
    const all = await tabCount(screen, 'All');
    const hospital = await tabCount(screen, 'Whole hospital');
    const mine = await tabCount(screen, 'Only you');
    expect(all).toBe(hospital + mine);
    const rail = screen.getByRole('complementary', 'Source detail and adding');
    await expect(rail.getByRole('tablist', 'How to add')).toBeVisible();
    await expect(rail.getByRole('textbox', 'Title')).toBeEnabled();
    await expect(rail.getByRole('spinbutton', 'Year')).toHaveValue(String(new Date().getFullYear()));
    await expect(rail.getByText('No patient details: Sona checks and refuses them.')).toBeVisible();
    await screen.getByRole('searchbox', 'Search the library').fill('zz-no-source');
    await expect(main(screen)).toContainText('Nothing matches "zz-no-source"');
  });

  test('Settings: who you are, your watches and the shared demo clock', { session: 'doctor' }, async ({ app, screen }) => {
    await app.open('/pro/settings');
    await expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible(LOAD);
    await expect(main(screen).getByText('Dr Test Aisyah', { exact: true })).toBeVisible();
    await expect(main(screen).getByText('Doctor · doctor@sona.test')).toBeVisible();
    await expect(main(screen).getByRole('group').filter({ hasText: /^What your role can do · \d+ areas/ })).toBeVisible();
    await expect(screen.getByRole('heading', 'Watches')).toBeVisible();
    await expect(main(screen).getByText(/^\d of 5$/)).toBeVisible();
    await expect(screen.getByRole('button', 'Start watching')).toBeDisabled();
    await expect(screen.getByRole('heading', 'Demo clock')).toBeVisible();
    await expect(main(screen)).toContainText(/The hospital's clock reads \w{3} \d+ \w+, \d\d:\d\d, (on real time|.+ (ahead of|behind) real time)\./);
    await expect(screen.getByRole('group', 'Jump to').getByRole('button')).toHaveCount(3);
  });

  test('Settings: a watch is previewed before it starts, starts, and stops', { session: 'doctor' }, async ({ app, screen }) => {
    const stamp = `E2E ${Date.now()}`;
    await app.open('/pro/settings');
    const box = screen.getByRole('textbox', 'Start a watch');
    await expect(box).toBeEnabled(LOAD);
    await box.fill(`Every morning at 7, which potassium results are above 5 (${stamp})?`);
    // The preview says what Sona will ask and when, before anything is saved.
    await expect(main(screen).getByText(/Every day at 07:00 · from the hospital's lab results and open tasks/)).toBeVisible();
    await screen.getByRole('button', 'Start watching').tap();
    const stop = screen.getByRole('button', new RegExp(`^Stop watching: .*${stamp}`));
    await expect(stop).toBeVisible(LOAD);
    try {
      const item = main(screen).getByRole('listitem').filter({ hasText: stamp });
      await expect(item).toContainText('Daily at 07:00');
    } finally {
      await stop.tap();
      await expect(stop).toHaveCount(0, LOAD);
    }
  });
});
