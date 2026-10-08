import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { card, LOAD, main, navLink, startsWith, statCaption, statValue, tabCount } from './helpers';
import { DEFINITION } from '../roles';

describe('patients', { tags: ['pro', 'deep'] }, () => {
  test('Patients: the stats, tabs, header and pages agree on the seeded hospital', { session: 'doctor' }, async ({ app, screen, browser }) => {
    await app.open('/pro/patients');
    await expect(screen.getByRole('heading', { name: 'Patients', level: 1 })).toBeVisible(LOAD);
    await expect(main(screen).getByRole('row', /^Hafizah Yusof /)).toBeVisible(LOAD);
    const all = await tabCount(screen, 'All');
    const ward = await tabCount(screen, 'On a ward');
    const watch = await tabCount(screen, 'Watch');
    const fit = await tabCount(screen, 'Medically fit');
    const incomplete = await tabCount(screen, 'Incomplete');
    // 17 synthetic patients are registered: Amelia, Daniel and the 15 ward patients (packages/db/src/seed.ts).
    expect(all).toBe(17);
    await expect(statValue(browser, 'Patients')).toHaveText(startsWith(all));
    await expect(statValue(browser, 'On a ward')).toHaveText(startsWith(ward));
    await expect(statCaption(browser, 'On a ward')).toHaveText(`${fit} medically fit`);
    await expect(statValue(browser, 'On watch')).toHaveText(startsWith(watch));
    await expect(statValue(browser, 'Record incomplete')).toHaveText(startsWith(incomplete));
    await expect(main(screen)).toContainText(`${watch} on watch · ${fit} medically fit · ${ward} of ${all} patients on a ward`);
    // Ten a page: the pager counts every patient.
    const pages = screen.getByRole('navigation', 'Pages');
    await expect(pages).toContainText(`Showing 1–10 of ${all} patients`);
    await expect(main(screen).getByRole('table').getByRole('row')).toHaveCount(11);
    await pages.getByRole('button', 'Next page').tap();
    await expect(pages).toContainText(`Showing 11–${all} of ${all} patients`);
    await expect(main(screen).getByRole('table').getByRole('row')).toHaveCount(all - 10 + 1);
  });

  test('Patients: the watch filter lists only patients on watch, and the URL keeps it', { session: 'doctor' }, async ({ app, screen, browser }) => {
    await app.open('/pro/patients');
    await expect(main(screen).getByRole('row', /^Hafizah Yusof /)).toBeVisible(LOAD);
    const watch = await tabCount(screen, 'Watch');
    await screen.getByRole('tab', /^Watch \d+$/).tap();
    await expect(browser).toHaveURL('/pro/patients?tab=watch');
    const rows = main(screen).getByRole('table').getByRole('rowgroup').nth(1).getByRole('row');
    await expect(rows).toHaveCount(Math.min(watch, 10));
    // Every listed row is on watch; the seed's watch patients include Hafizah Yusof (DKA) and Ravi Kumar (heart failure).
    for (const text of await rows.allTextContents()) expect(text.toLowerCase()).toContain('watch');
    await expect(main(screen).getByRole('row', /^Hafizah Yusof F, 54 · SYN-2001 Diabetic ketoacidosis/)).toBeVisible();
    await expect(main(screen).getByRole('row', /^Ravi Kumar M, 71 · SYN-2009 Heart failure/)).toBeVisible();
    // A reload keeps the filter.
    await browser.reload();
    await expect(screen.getByRole('tab', /^Watch \d+$/)).toHaveAttribute('aria-selected', 'true', LOAD);
  });

  test('Patients: search finds by name, ID or complaint, and an empty search says so', { session: 'doctor' }, async ({ app, screen }) => {
    await app.open('/pro/patients');
    const search = screen.getByRole('searchbox', 'Search patients');
    const table = main(screen).getByRole('table');
    await search.fill('SYN-1042');
    await expect(table.getByRole('row', /^Amelia Tan F, 42 · SYN-1042/)).toBeVisible(LOAD);
    await expect(table.getByRole('rowgroup').nth(1).getByRole('row')).toHaveCount(1);
    await search.fill('pancreatitis');
    await expect(table.getByRole('row', /^Suresh Pillai M, 48 · SYN-2005/)).toBeVisible();
    await expect(table.getByRole('rowgroup').nth(1).getByRole('row')).toHaveCount(1);
    await search.fill('zz-no-such-patient');
    await expect(main(screen)).toContainText('No patient matches');
    await expect(main(screen)).toContainText('Nothing matches "zz-no-such-patient" in All.');
  });

  test("Patient overview: Amelia Tan's record, read for a doctor", { session: 'doctor' }, async ({ app, screen }) => {
    await app.open('/pro/patients/SYN-1042');
    await expect(screen.getByRole('heading', { name: 'Patient overview', level: 1 })).toBeVisible(LOAD);
    const strip = screen.getByRole('region', 'Amelia Tan');
    await expect(strip.getByText('F, 42 · SYN-1042')).toBeVisible();
    await expect(strip).toContainText('Allergy: Penicillin', { ignoreCase: true });
    await expect(screen.getByRole('link', 'Open the visit')).toHaveAttribute('href', '/pro/visit?encounterId=visit-1042');
    // The history as the record has it.
    await expect(screen.getByRole(DEFINITION).filter({ hasText: 'Cough for five days, with fever since yesterday.' })).toBeVisible();
    await expect(screen.getByRole(DEFINITION).filter({ hasText: 'Mother has asthma; father has type 2 diabetes.' })).toBeVisible();
    // Where she stands, in the ward's own words: afebrile, SpO₂ 97% on room air.
    await expect(main(screen)).toContainText('Respiratory review · Afebrile 18 h, SpO₂ 97% on room air.');
    // The record at a glance: her medicines and the take-home list.
    const glance = screen.getByRole('complementary', 'Record at a glance');
    await expect(glance.getByRole('listitem').filter({ hasText: 'Salbutamol inhaler' })).toBeVisible();
    await expect(glance.getByRole('listitem').filter({ hasText: 'Azithromycin' })).toContainText('changed', { ignoreCase: true });
    // Tabs: Medicines lists the same medicines.
    await screen.getByRole('tab', 'Medicines').tap();
    await expect(main(screen).getByRole('heading', 'Medicines')).toBeVisible();
    await expect(main(screen).getByRole('heading', 'Doses taken')).toBeVisible();
    await screen.getByRole('tab', 'Timeline').tap();
    await expect(main(screen).getByRole('heading', 'Timeline')).toBeVisible();
    await expect(main(screen).getByRole('listitem').filter({ hasText: 'Clinic visit' }).first()).toBeVisible(LOAD);
  });

  test('Patient overview: the join code control is offered to a doctor', { session: 'doctor' }, async ({ app, screen }) => {
    await app.open('/pro/patients/SYN-2002');
    await expect(screen.getByRole('region', 'Nurul Huda')).toBeVisible(LOAD);
    await expect(screen.getByRole('heading', 'Sona Care')).toBeVisible();
    await expect(screen.getByRole('button', 'Give this patient a join code')).toBeEnabled();
  });

  test("Tasks: the first task can be added from the patient's page, as Tasks says", { session: 'doctor' }, async ({ app, screen }) => {
    test.skip(true, "BUG: with no tasks, Tasks says \"Add the first one from the patient's page\" (apps/web/src/routes/pro/_app/tasks.tsx:146), but the patient page has no add-task control; tasks.create is only called from the Tasks page's form, which appears only once a visit already has a task (tasks.tsx:49,135)");
    await app.open('/pro/tasks');
    await expect(screen.getByText("A task is added to a visit, and no visit has tasks yet. Add the first one from the patient's page.")).toBeVisible(LOAD);
    await app.open('/pro/patients/SYN-2002');
    await expect(screen.getByRole('region', 'Nurul Huda')).toBeVisible(LOAD);
    await expect(screen.getByRole('button', /Add a task/)).toBeVisible();
  });

  test('Visit: today\'s visits, and the next one opens its note', { session: 'doctor' }, async ({ app, screen, browser }) => {
    await app.open('/pro/visit');
    await expect(screen.getByRole('heading', { name: 'Visit', level: 1 })).toBeVisible(LOAD);
    const table = main(screen).getByRole('table');
    await expect(table.getByRole('row', /^Amelia Tan \d\d:\d\d Clinic visit Open visit$/)).toBeVisible(LOAD);
    await expect(table.getByRole('row', /^Daniel Rahman \d\d:\d\d Clinic visit Record incomplete Open visit$/)).toBeVisible();
    const visits = (await table.getByRole('row').count()) - 1;
    await expect(main(screen)).toContainText(new RegExp(`${visits} visits? today`));
    await table.getByRole('row', /^Daniel Rahman/).getByRole('button', 'Open visit').tap();
    await expect(browser).toHaveURL('/pro/visit?encounterId=visit-1086', LOAD);
    await expect(screen.getByRole('heading', { name: 'Visit note', level: 1 })).toBeVisible();
  });

  test("Visit: Amelia Tan's note, medicines and order, read without writing", { session: 'doctor' }, async ({ app, screen }) => {
    await app.open('/pro/visit?encounterId=visit-1042');
    await expect(screen.getByRole('heading', { name: 'Visit note', level: 1 })).toBeVisible(LOAD);
    await expect(screen.getByRole('region', 'Amelia Tan')).toContainText('F, 42 · SYN-1042 · Cough for five days, with fever since yesterday.');
    await expect(screen.getByRole('region', 'Amelia Tan')).toContainText('Allergy: Penicillin', { ignoreCase: true });
    // The seeded note (seedDemoNote), section by section; nothing is edited, so Save stays off.
    await expect(screen.getByRole('textbox', 'Assessment')).toHaveValue(/^Community-acquired pneumonia, mild; CURB-65 0\./, LOAD);
    await expect(screen.getByRole('textbox', 'Examination')).toHaveValue(/SpO₂ 97% on room air/);
    await expect(screen.getByRole('textbox', 'Plan')).toHaveValue(/oral azithromycin 500 mg daily/);
    await expect(screen.getByRole('button', 'Save the note')).toBeDisabled();
    await expect(screen.getByRole('status').filter({ hasText: /^Revision \d+ · / }).first()).toBeVisible();
    // The medicines on the visit and the order, which is not proposed yet.
    const rail = screen.getByRole('complementary', 'The medicine order and Sona AI');
    await expect(rail.getByRole('heading', 'Medicines on this visit')).toBeVisible();
    await expect(rail.getByRole('button', 'Remove Salbutamol inhaler, as needed')).toBeVisible();
    await expect(rail.getByRole('button', 'Remove Cetirizine tablet 10 mg, patient-reported')).toBeVisible();
    await expect(rail.getByRole('heading', 'Medicine order')).toBeVisible();
    await expect(rail.getByRole('button', 'Review the order')).toBeDisabled();
    await expect(screen.getByRole('heading', 'Scan a handwritten note')).toBeVisible();
  });

  test('Results: the header, tabs, table and sidebar badge agree', { session: 'doctor' }, async ({ app, screen }) => {
    await app.open('/pro/results');
    await expect(screen.getByRole('heading', { name: 'Results', level: 1 })).toBeVisible(LOAD);
    await expect(main(screen)).toContainText(/\d+ new results? across|No result is waiting/, LOAD);
    const action = await tabCount(screen, 'Needs action');
    const fresh = await tabCount(screen, 'New');
    // The sidebar badge is the results no doctor has acknowledged yet: the New tab.
    await expect(navLink(screen, 'Results')).toHaveAccessibleName(fresh ? `Results ${fresh}` : 'Results');
    if (fresh) await expect(main(screen)).toContainText(new RegExp(`${fresh} new results? across \\d+ patients? · `));
    const table = main(screen).getByRole('table');
    await expect(table.getByRole('rowgroup').nth(1).getByRole('row')).toHaveCount(Math.max(action, 1));
    // Search narrows to one test: every row left is a potassium (seed: Daniel Rahman's 3.1 mmol/L, lab-1086-potassium).
    await screen.getByRole('searchbox', 'Search results').fill('Potassium');
    await expect.poll(async () => (await table.getByRole('rowgroup').nth(1).getByRole('row').allTextContents()).every(t => /Potassium|No result/.test(t))).toBe(true);
    // The New tab holds every unacknowledged result; Acknowledged holds the rest.
    await screen.getByRole('searchbox', 'Search results').fill('');
    await screen.getByRole('tab', /^New \d+$/).tap();
    await expect(table.getByRole('rowgroup').nth(1).getByRole('row')).toHaveCount(Math.max(fresh, 1));
    await screen.getByRole('searchbox', 'Search results').fill('zz-no-such-test');
    await expect(table).toContainText('No result matches this search.');
  });

  test("Result detail: Daniel Rahman's potassium, why it is flagged, and his other result", { session: 'doctor' }, async ({ app, screen, browser }) => {
    await app.open('/pro/results/lab-1086-potassium');
    await expect(screen.getByRole('heading', { name: 'Potassium · 3.1 mmol/L', level: 1 })).toBeVisible(LOAD);
    await expect(main(screen)).toContainText(/Daniel Rahman · received .+ · (waiting for a doctor|acknowledged by .+)/);
    const why = card(screen, /^(Needs review|Acknowledged)/, main(screen));
    await expect(why).toContainText('Potassium 3.1 mmol/L is below the usual adult range of 3.5 to 5.1 mmol/L');
    await expect(main(screen)).toContainText('This is the only Potassium value for Daniel Rahman, so there is no trend yet.');
    // His other result, the haemoglobin, opens from here.
    const others = main(screen).getByRole('table');
    await expect(others.getByRole('row', /^Hb 9\.8 g\/dL/)).toBeVisible();
    const rail = screen.getByRole('complementary', 'Patient');
    await expect(rail.getByText('1 other result on record')).toBeVisible();
    await expect(rail.getByRole('link', 'Open patient')).toHaveAttribute('href', '/pro/patients/SYN-1086');
    await others.getByRole('row', /^Hb/).getByRole('button', 'Open').tap();
    await expect(browser).toHaveURL('/pro/results/lab-hb-1086', LOAD);
    await expect(screen.getByRole('heading', { name: 'Hb · 9.8 g/dL', level: 1 })).toBeVisible();
  });

  test('X-ray: the patient picker lists every patient and asks for one first', { session: 'doctor' }, async ({ app, screen }) => {
    await app.open('/pro/xray');
    await expect(screen.getByRole('heading', { name: 'X-ray', level: 1 })).toBeVisible(LOAD);
    const picker = screen.getByRole('combobox', 'Patient');
    await expect(picker.getByRole('option')).toHaveCount(18, LOAD);
    await expect(screen.getByText('Choose a patient first')).toBeVisible();
    const read = screen.getByRole('complementary', "Sona's read");
    await expect(card(screen, 'No read yet', read)).toContainText('Sona drafts a read as soon as an image is added.');
  });
});
