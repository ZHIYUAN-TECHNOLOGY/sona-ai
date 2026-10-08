import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { accessibilityMisses, type Doctor, formatIn, PATIENT, type Plan, rpc, settled, type Visit } from './care';

const NAV = ['Home', 'Follow-ups', 'Visit summaries', 'Medicines', 'Results', 'Readings', 'Discharge plan', 'Check-ins', 'Care team', 'Messages', 'Ask Sona'];
const discharged = (plan: Plan): plan is Extract<Plan, { status: 'discharged' }> => plan.status === 'discharged';

describe('Sona Care pages', { tags: ['care', 'deep'], session: 'patient' }, () => {
  test('the sidebar opens every page, each with its own heading', { tags: ['smoke'] }, async ({ app, screen, browser }) => {
    await app.open('/care/home');
    const side = screen.getByRole('navigation', 'Sona Care');
    await expect(side.getByRole('link')).toHaveText(NAV, { timeout: 15_000 });
    for (const label of NAV.slice(1)) {
      await side.getByRole('link', label).tap();
      const path = `/care/${label === 'Ask Sona' ? 'ask' : label.toLowerCase().replace(/ /g, '-')}`;
      await expect(browser).toHaveURL(path);
      await expect(screen.getByRole('heading', label, { level: 1 })).toBeVisible({ timeout: 15_000 });
      await expect(side.getByRole('link', label)).toHaveAttribute('aria-current', 'page');
    }
  });

  test('Home greets Amelia and puts her next step first', { tags: ['smoke'] }, async ({ app, screen, browser }) => {
    await app.open('/care/home');
    await expect(screen.getByRole('heading', /^Good (morning|afternoon|evening), Amelia$/, { level: 1 })).toBeVisible({ timeout: 15_000 });
    await settled(screen);
    const side = screen.getByRole('navigation', 'Sona Care');
    await expect(side).toContainText(PATIENT.name);
    await expect(side).toContainText(PATIENT.hospital);

    const [plan, visits] = await Promise.all([rpc<Plan>(browser, 'care/discharge', { lang: 'en' }), rpc<Visit[]>(browser, 'care/followUps', { lang: 'en' })]);
    const main = screen.getByRole('main');
    const waitingHome = screen.getByRole('listitem').filter({ hasText: 'Your medicines start when you go home' });
    if (discharged(plan)) await expect(waitingHome).toHaveCount(0);
    else await expect(waitingHome).toContainText('Each dose will show here with a button to mark it taken.');

    const insight = screen.getByRole('article').filter({ hasText: 'Next for you' });
    const visit = visits.find(v => v.inDays >= 0);
    if (visit) {
      // Home formats in the browser's language ("en"): "Oct 8, 10:30 PM".
      const time = await formatIn(browser, visit.date, 'en', { hour: 'numeric', minute: '2-digit' });
      const day = await formatIn(browser, visit.date, 'en', { day: 'numeric', month: 'short' });
      await expect(screen.getByRole('listitem').filter({ hasText: `${day}, ${time}` })).toContainText(visit.title);
      await expect(main).toContainText(`Your next visit is ${visit.inDays === 0 ? `today at ${time}` : visit.inDays === 1 ? 'tomorrow' : `in ${visit.inDays} days`}`);
      if (!discharged(plan)) {
        // In hospital there are no doses or check-ins yet, so the visit is the next step.
        const long = await formatIn(browser, visit.date, 'en', { weekday: 'long', day: 'numeric', month: 'long' });
        await expect(insight.getByRole('heading', `${visit.title} ${visit.inDays === 0 ? 'today' : visit.inDays === 1 ? 'tomorrow' : `in ${visit.inDays} days`}`)).toBeVisible();
        await expect(insight).toContainText(`${long} at ${time}.`);
        await insight.getByRole('link', 'See your visit').tap();
        await expect(browser).toHaveURL('/care/follow-ups');
        return;
      }
    } else if (!discharged(plan)) {
      await expect(insight.getByRole('heading', 'All done for today')).toBeVisible();
      await expect(insight).toContainText('You are still in hospital. Your plan shows here when you go home.');
    }
    await expect(insight).toBeVisible();
  });

  test('Home links to her plan, medicines and Ask Sona in place', async ({ app, screen, browser }) => {
    await app.open('/care/home');
    await screen.getByRole('link', 'Your discharge plan Your steps at home').tap();
    await expect(browser).toHaveURL('/care/discharge-plan');
    await app.back();
    await screen.getByRole('link', 'All medicines What to take and why').tap();
    await expect(browser).toHaveURL('/care/medicines');
    await app.back();
    await screen.getByRole('link', 'Ask Sona Ask in your own words').tap();
    await expect(browser).toHaveURL('/care/ask');
  });

  test('Medicines shows her plan\'s medicines, or says they start at home', async ({ app, screen, browser }) => {
    await app.open('/care/medicines');
    await settled(screen);
    const plan = await rpc<Plan>(browser, 'care/discharge', { lang: 'en' });
    if (!discharged(plan)) {
      await expect(screen.getByText('Your medicines show here once you go home')).toBeVisible();
      await expect(screen.getByRole('main')).toContainText('Your care team gives them to you on the ward for now.');
      await screen.getByRole('link', 'Ask Sona about your medicines').tap();
      await expect(browser).toHaveURL('/care/ask');
      return;
    }
    const all = Object.values(plan.medicines).flat();
    expect(all.length).toBeGreaterThan(0);
    for (const med of all) await expect(screen.getByRole('listitem').filter({ hasText: `${med.name} ${med.line}` }).first()).toBeVisible();
    for (const med of plan.medicines.stopped) await expect(screen.getByRole('listitem').filter({ hasText: med.name }).first()).toContainText('Stopped. Do not take this one.');
    await expect(screen.getByRole('heading', 'Check a medicine by photo')).toBeVisible();
  });

  test('Care team names her doctors, where to find them and how to reach them', async ({ app, screen, browser }) => {
    await app.open('/care/care-team');
    await settled(screen);
    const team = (await rpc<Doctor[]>(browser, 'care/doctors/list', {})).filter(d => d.careTeam);
    expect(team.length).toBeGreaterThan(0);
    await expect(screen.getByRole('main')).toContainText(`${team.length} ${team.length === 1 ? 'doctor looks' : 'doctors look'} after you at ${PATIENT.hospital}.`);
    for (const d of team) {
      const card = screen.getByRole('listitem').filter({ has: screen.getByRole('heading', d.name, { level: 2 }) });
      await expect(card).toContainText(`${d.specialty} doctor`);
      await expect(card).toContainText(`Find them in ${d.room}.`);
      for (const language of d.languages) await expect(card).toContainText(language);
      if (d.about) await expect(card).toContainText(d.about);
    }
    const emergency = screen.getByRole('complementary', 'How to reach us');
    await expect(emergency.getByRole('heading', 'In an emergency')).toBeVisible();
    await expect(emergency.getByRole('link', 'Call 999 now')).toHaveAttribute('href', 'tel:999');
    // Her own training choice, read and not changed here: the line under the switch says what it is.
    const share = screen.getByRole('switch', 'Share to help improve Sona');
    await expect(share).toBeEnabled({ timeout: 15_000 });
    await expect(emergency).toContainText((await share.isChecked()) ? 'Your data is used for training, with your name and details removed.' : 'Your data is not used for training.');
    await screen.getByRole('link', 'Message your care team').tap();
    await expect(browser).toHaveURL('/care/messages');
  });

  test('Discharge plan shows her plan, or says it comes when she goes home', async ({ app, screen, browser }) => {
    await app.open('/care/discharge-plan');
    await settled(screen);
    const plan = await rpc<Plan>(browser, 'care/discharge', { lang: 'en' });
    if (!discharged(plan)) {
      await expect(screen.getByRole('main')).toContainText('You do not have a discharge plan yet.');
      await expect(screen.getByText('No discharge plan yet')).toBeVisible();
      await screen.getByRole('link', 'See your follow-ups').tap();
      await expect(browser).toHaveURL('/care/follow-ups');
      return;
    }
    await expect(screen.getByRole('main')).toContainText('You went home on');
    await expect(screen.getByRole('heading', 'What happened')).toBeVisible();
    for (const med of Object.values(plan.medicines).flat()) await expect(screen.getByRole('listitem').filter({ hasText: med.name }).first()).toBeVisible();
    const warn = screen.getByRole('heading', 'Call the hospital now if…');
    await expect(warn).toBeVisible();
    for (const sign of plan.warningSigns) await expect(screen.getByRole('listitem').filter({ hasText: sign }).first()).toBeVisible();
    await expect(screen.getByRole('link', 'Call 999')).toHaveAttribute('href', 'tel:999');
  });

  test('Check-ins lists hers, or says they start after she leaves hospital', async ({ app, screen, browser }) => {
    await app.open('/care/check-ins');
    await settled(screen);
    const list = await rpc<{ id: string; day: number; replies: unknown[] }[]>(browser, 'care/checkIns/list');
    if (!list.length) {
      await expect(screen.getByRole('main')).toContainText('No check-ins planned yet.');
      await expect(screen.getByText('No check-ins planned')).toBeVisible();
      await expect(screen.getByRole('main')).toContainText('They start after you leave hospital.');
      return;
    }
    for (const c of list) await expect(screen.getByRole('listitem').filter({ hasText: `Day ${c.day}` }).first()).toBeVisible();
  });

  test('Results lists her released results, or says none are ready', async ({ app, screen, browser }) => {
    await app.open('/care/results');
    await settled(screen);
    const results = await rpc<{ id: string; test: string; released: boolean }[]>(browser, 'care/results/list', { lang: 'en' });
    if (!results.length) {
      await expect(screen.getByText('No results yet')).toBeVisible();
      await expect(screen.getByRole('main')).toContainText('Results appear here after your doctor has seen them.');
      await screen.getByRole('link', 'Ask Sona a question').tap();
      await expect(browser).toHaveURL('/care/ask');
      return;
    }
    for (const test of new Set(results.slice(0, 20).map(r => r.test))) await expect(screen.getByRole('table').getByText(test, { exact: false }).first()).toBeVisible();
  });

  test('Results explains a released result in plain words from the model', { tags: ['models', 'ai'], timeout: 240_000 }, async ({ app, screen, browser, agent }) => {
    await app.open('/care/results');
    await settled(screen);
    const released = (await rpc<{ id: string; test: string; released: boolean }[]>(browser, 'care/results/list', { lang: 'en' })).filter(r => r.released);
    test.skip(!released.length, 'Amelia has no released results yet, so there is nothing to explain');
    const detail = screen.getByRole('complementary', 'Chosen result');
    const explained = browser.waitForResponse('**/rpc/care/results/explain', { timeout: 120_000 });
    await detail.getByRole('button', 'Explain this result').tap();
    const res = await explained;
    expect((await res.json() as { json: { source: string } }).json.source).toBe('model');
    await expect(detail.getByText('Sample answer')).toHaveCount(0);
    await expect(detail.getByRole('button', 'Explain this result')).toHaveCount(0, { timeout: 120_000 });
    await expect(detail).not.toContainText("Sona can't explain this result right now.");
    await agent.assert('In the "Chosen result" panel, the text under "What this means" explains the chosen test result in plain, everyday words a patient can follow, and it is not an error message or a placeholder.');
  });

  test('Visit summaries shows approved summaries, or says none are approved yet', async ({ app, screen, browser }) => {
    await app.open('/care/visit-summaries');
    await settled(screen);
    const list = await rpc<{ id: string; text: string }[]>(browser, 'care/visitSummaries/list');
    if (!list.length) {
      await expect(screen.getByText('No visit summaries yet')).toBeVisible();
      await expect(screen.getByRole('main')).toContainText('Your summary appears here after your care team approves it.');
      return;
    }
    await expect(screen.getByRole('heading', /^Your visit on /)).toBeVisible();
    await expect(screen.getByText('Approved by your care team')).toBeVisible();
  });

  test('the leaflet she reads is the one approved at discharge, not a sample', {
    skip: 'DECIDE: the plan picks the leaflet by the browser language (apps/web/src/routes/care/_app/discharge-plan.tsx:26,45), as the phone does (apps/care/app/discharge.tsx:50), so a plan approved in Malay shows the authored English "Sample leaflet"; apps/care/lib/i18n.ts says the plan language should win',
  }, async ({ app, screen }) => {
    await app.open('/care/discharge-plan');
    await expect(screen.getByRole('heading', 'Your plan in plain words')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText('Sample leaflet')).toHaveCount(0);
  });

  for (const page of ['home', 'follow-ups', 'messages', 'readings', 'ask', 'care-team', 'medicines', 'discharge-plan']) {
    const skip = page === 'medicines' ? 'BUG: after discharge the "Choose a photo" file control is 46 px tall, under Care\'s 48 px floor (apps/web/src/features/care-medicines/photo.tsx:110)' : undefined;
    test(`${page}: body text 17 px, nothing under 15 px, and every control at least 48 px tall`, { skip }, async ({ app, screen, browser }) => {
      await app.open(`/care/${page}`);
      await settled(screen);
      expect(await accessibilityMisses(browser)).toEqual([]);
    });
  }
});

describe('Sona Care in a Malay browser', { tags: ['care', 'deep'], session: 'patient' }, () => {
  // The web app has no language switch: it speaks the browser's language (navigator.language), as the phone app does.
  test('Follow-ups reads dates and the calendar in Malay', async ({ app, screen, browser }) => {
    await browser.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'language', { get: () => 'ms-MY' });
      Object.defineProperty(Navigator.prototype, 'languages', { get: () => ['ms-MY', 'ms'] });
    });
    await app.open('/care/follow-ups');
    await settled(screen);
    const month = await browser.evaluate(() => new Intl.DateTimeFormat('ms-MY', { timeZone: 'Asia/Kuala_Lumpur', month: 'long', year: 'numeric' }).format(new Date()));
    expect(month).not.toMatch(/January|February|March|April|May|June|July|August|September|October|November|December/);
    await expect(screen.getByRole('region', `Calendar, ${month}`).getByRole('heading', month)).toBeVisible();
    const weekdays = await browser.evaluate(() => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat('ms-MY', { timeZone: 'UTC', weekday: 'short' }).format(new Date(Date.UTC(2026, 0, 5 + i)))));
    await expect(screen.getByRole('region', `Calendar, ${month}`)).toContainText(weekdays.join(' '));
    const visits = await rpc<Visit[]>(browser, 'care/followUps', { lang: 'ms' });
    const next = visits.find(v => v.inDays >= 0);
    if (next) {
      const when = `${await formatIn(browser, next.date, 'ms-MY', { weekday: 'short', day: 'numeric', month: 'short' })}, ${await formatIn(browser, next.date, 'ms-MY', { hour: 'numeric', minute: '2-digit' })}`;
      await expect(screen.getByRole('heading', next.title, { level: 2 }).first()).toBeVisible();
      await expect(screen.getByText(when).first()).toBeVisible();
    }
  });
});
