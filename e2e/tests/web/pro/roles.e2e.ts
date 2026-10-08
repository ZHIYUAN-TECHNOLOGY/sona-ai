import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import type { Browser } from '@e2e-dev/web';
import type { App, Screen } from 'e2e';

import { escape, LOAD, main, sidebar, signIn } from './helpers';

// tests/web/auth.setup.e2e.ts saves the 'beds' session only after landing on /pro/today, but a bed manager lands on
// /pro/ward (nav.ts homeFor), so that setup fails and every { session: 'beds' } test is skipped. Until the setup accepts
// /pro/ward, bed-manager tests sign in through the form themselves.
type Role = 'doctor' | 'nurse' | 'beds' | 'manager';
const as = (role: Role) => (role === 'beds' ? {} : { session: role });
async function enter(role: Role, app: App, screen: Screen, browser: Browser) {
  if (role === 'beds') await signIn(app, screen, browser, 'beds', '/pro/ward');
}

// What each role's sidebar holds, from apps/web/src/nav.ts PRO_NAV filtered by packages/api/src/roles.ts PERMISSIONS
// (an item shows when the role may call its `needs` route).
const NAV = {
  doctor: ['Today', 'Schedule', 'Tasks', 'Patients', 'Visit', 'Results', 'X-ray', 'Evidence', 'Messages', 'Review queue', 'Ward', 'Handover', 'Check-ins', 'Discharge', 'Guarantee letter', 'Audit', 'Library', 'Settings'],
  nurse: ['Today', 'Schedule', 'Tasks', 'Patients', 'Visit', 'Results', 'X-ray', 'Evidence', 'Messages', 'Review queue', 'Ward', 'Handover', 'Check-ins', 'Discharge', 'Library', 'Settings'],
  beds: ['Tasks', 'Ward', 'Settings'],
  manager: ['Today', 'Schedule', 'Tasks', 'Patients', 'Visit', 'Results', 'X-ray', 'Messages', 'Ward', 'Handover', 'Check-ins', 'Discharge', 'Guarantee letter', 'Audit', 'Library', 'Training data', 'Settings'],
} as const;
const WHO = {
  doctor: ['Dr Test Aisyah', 'Doctor'],
  nurse: ['Nurse Test Mei Ling', 'Nurse'],
  beds: ['Test Bed Manager Hafiz', 'Bed manager'],
  manager: ['Test Manager Farah', 'Management'],
} as const;
const HOME = { doctor: '/pro/today', nurse: '/pro/today', beds: '/pro/ward', manager: '/pro/today' } as const;

// Pages a role may not use, with the refusal the frame shows in their place (roles.ts refusal()).
const REFUSED = {
  doctor: [['/pro/training-data', 'Training data', "Doctors can't see the training data. Ask management."]],
  nurse: [
    ['/pro/audit', 'Audit', "Nurses can't see who opened a record. Ask a doctor or management."],
    ['/pro/guarantee-letter', 'Guarantee letter', "Nurses can't suggest claim codes. Ask a doctor or management."],
    ['/pro/training-data', 'Training data', "Nurses can't see the training data. Ask management."],
  ],
  beds: [
    ['/pro/patients', 'Patients', "Bed managers can't see a patient's trends. Ask a doctor, a nurse or management."],
    ['/pro/patients/SYN-1042', 'Patients', "Bed managers can't see a patient's trends. Ask a doctor, a nurse or management."],
    ['/pro/visit?encounterId=visit-1042', 'Visit', "Bed managers can't open the visit. Ask a doctor, a nurse or management."],
    ['/pro/results', 'Results', "Bed managers can't see results. Ask a doctor, a nurse or management."],
    ['/pro/discharge', 'Discharge', "Bed managers can't read the discharge plan. Ask a doctor, a nurse or management."],
    ['/pro/library', 'Library', "Bed managers can't add to the library. Ask a doctor or management."],
    ['/pro/audit', 'Audit', "Bed managers can't see who opened a record. Ask a doctor or management."],
  ],
  manager: [
    ['/pro/evidence', 'Evidence', "Management can't ask for evidence. Ask a doctor or a nurse."],
    ['/pro/review', 'Review queue', "Management can't see what is waiting for review. Ask a doctor or a nurse."],
  ],
} as const;

describe('role access', { tags: ['pro', 'roles'] }, () => {
  for (const role of ['doctor', 'nurse', 'beds', 'manager'] as const) {
    test(`${role}: the sidebar shows exactly the pages the role may use`, as(role), async ({ app, screen, browser }) => {
      await enter(role, app, screen, browser);
      await app.open(HOME[role]);
      await expect(browser).toHaveURL(HOME[role], LOAD);
      const nav = sidebar(screen);
      // Exactly these links, in this order (a badge count may follow a label).
      await expect(nav.getByRole('link')).toHaveText(NAV[role].map(label => new RegExp(`^${escape(label)}\\s*\\d*$`)), LOAD);
      await expect(nav).toContainText(WHO[role][0]);
      await expect(nav.getByText(WHO[role][1], { exact: true })).toBeVisible();
    });

    for (const [path, title, refusal] of REFUSED[role]) {
      test(`${role}: ${path} is refused in plain words`, as(role), async ({ app, screen, browser }) => {
        await enter(role, app, screen, browser);
        await app.open(path);
        await expect(main(screen).getByRole('heading', { name: title, level: 1 })).toBeVisible(LOAD);
        await expect(main(screen).getByText(refusal)).toBeVisible();
        // Only the refusal: no table, tabs or form of the page behind it.
        await expect(main(screen).getByRole('table')).toHaveCount(0);
        await expect(main(screen).getByRole('tablist')).toHaveCount(0);
        await expect(main(screen).getByRole('textbox')).toHaveCount(0);
      });
    }
  }

  test('nurse: reads a visit note but cannot write it or ask for clinical reasoning', { session: 'nurse' }, async ({ app, screen }) => {
    await app.open('/pro/visit?encounterId=visit-2002');
    await expect(screen.getByRole('heading', { name: 'Visit note', level: 1 })).toBeVisible(LOAD);
    await expect(screen.getByRole('region', 'Nurul Huda')).toBeVisible();
    await expect(screen.getByText('Only a doctor can write the note. You are reading the saved one.')).toBeVisible();
    await expect(screen.getByRole('textbox', 'Assessment')).toHaveAttribute('readonly');
    await expect(screen.getByRole('textbox', 'Assessment')).toHaveValue('Acute pyelonephritis, uncomplicated; qSOFA 0 on admission.');
    await expect(screen.getByRole('button', 'Save the note')).toHaveCount(0);
    await expect(screen.getByText('Only doctors can ask Sona for clinical reasoning.')).toBeVisible();
    await expect(screen.getByRole('button', 'Think it through')).toHaveCount(0);
    await expect(screen.getByText('Only a doctor can review and place a medicine order.')).toBeVisible();
  });

  test('manager: sees the ward but cannot assign a discharge barrier', { session: 'manager' }, async ({ app, screen }) => {
    await app.open('/pro/ward');
    await expect(screen.getByText('Your role can see the ward but cannot assign discharge barriers.')).toBeVisible(LOAD);
    await expect(screen.getByRole('tab', /^Blocked \d+$/)).toBeVisible();
    await expect(screen.getByRole('combobox', /^Assign Bed/)).toHaveCount(0);
  });

  test('bed manager: may assign a discharge barrier on the ward', async ({ app, screen, browser }) => {
    await enter('beds', app, screen, browser);
    await expect(screen.getByRole('tab', /^Blocked \d+$/)).toBeVisible(LOAD);
    await expect(screen.getByRole('combobox', /^Assign Bed \d+: /).first()).toBeEnabled();
    await expect(screen.getByText('Your role can see the ward but cannot assign discharge barriers.')).toHaveCount(0);
  });

  test('manager: opens a patient record but cannot give a Sona Care join code', { session: 'manager' }, async ({ app, screen }) => {
    await app.open('/pro/patients/SYN-1042');
    await expect(screen.getByRole('heading', { name: 'Patient overview', level: 1 })).toBeVisible(LOAD);
    await expect(screen.getByRole('region', 'Amelia Tan')).toBeVisible();
    await expect(screen.getByRole('tab', 'Overview')).toBeVisible();
    await expect(screen.getByRole('button', 'Give this patient a join code')).toHaveCount(0);
  });

  test('manager: reviews the training data the hospital would contribute', { session: 'manager' }, async ({ app, screen }) => {
    await app.open('/pro/training-data');
    await expect(screen.getByRole('heading', { name: 'Training data', level: 1 })).toBeVisible(LOAD);
    await expect(screen.getByRole('switch')).toBeVisible();
    await expect(screen.getByRole('tablist', 'Samples by status')).toBeVisible();
    await expect(screen.getByRole('searchbox', 'Search samples')).toBeVisible();
  });

  test('bed manager: Settings has no watches, which read results the role may not see', async ({ app, screen, browser }) => {
    await enter('beds', app, screen, browser);
    await app.open('/pro/settings');
    await expect(screen.getByText('Bed manager · beds@sona.test')).toBeVisible(LOAD);
    await expect(screen.getByRole('heading', 'Demo clock')).toBeVisible();
    await expect(screen.getByRole('heading', 'Watches')).toHaveCount(0);
  });
});
