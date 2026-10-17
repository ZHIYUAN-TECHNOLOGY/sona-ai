import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { card, LOAD, main, navLink, num, startsWith, statCaption, statValue, tabCount } from './helpers';

// Today, Schedule and Tasks for the demo doctor. The seed books today's two visits (Amelia Tan, Daniel Rahman) 15 and 45
// minutes after a reset (packages/db/src/seed.ts), so they are today's until midnight in Kuala Lumpur; counts are read
// from the page and checked against each other, because other writers share this database.
describe('my day', { tags: ['pro', 'deep'] }, () => {
  test('Today: the day in one line, the stats and the visit table agree', { session: 'doctor' }, async ({ app, screen, browser }) => {
    await app.open('/pro/today');
    await expect(screen.getByRole('heading', { name: /^Good (morning|afternoon|evening), Dr Test Aisyah$/, level: 1 })).toBeVisible(LOAD);
    // The tabs count 0 until the day has loaded: wait for a seeded visit first.
    await expect(main(screen).getByRole('row', /Amelia Tan clinic visit/)).toBeVisible(LOAD);
    const all = await tabCount(screen, 'All');
    const upcoming = await tabCount(screen, 'Upcoming');
    const earlier = await tabCount(screen, 'Earlier');
    const incomplete = await tabCount(screen, 'Incomplete');
    expect(all, 'every visit is upcoming or earlier').toBe(upcoming + earlier);
    expect(all, "the seed books two of today's visits").toBeGreaterThanOrEqual(2);
    // The header line states the same counts.
    await expect(main(screen)).toContainText(new RegExp(`· ${all} visits? · .*${incomplete} records? incomplete`));
    await expect(statCaption(browser, 'Visits started')).toContainText(`of ${all} today`);
    await expect(statValue(browser, 'Records incomplete')).toHaveText(startsWith(incomplete));
    // One table row per visit (plus the header row), with the seeded patients.
    const table = main(screen).getByRole('table');
    await expect(table.getByRole('row')).toHaveCount(all + 1);
    await expect(table.getByRole('row', /Amelia Tan clinic visit/)).toBeVisible();
    await expect(table.getByRole('row', /Daniel Rahman clinic visit Record incomplete/)).toBeVisible();
    // The Incomplete tab narrows the table to Daniel, whose history is incomplete.
    await screen.getByRole('tab', /^Incomplete \d+$/).tap();
    await expect(table.getByRole('row')).toHaveCount(incomplete + 1);
    await expect(table.getByRole('row', /Daniel Rahman/)).toBeVisible();
    await expect(table.getByRole('row', /Amelia Tan/)).toHaveCount(0);
  });

  test('Today: Sona points at the incomplete record first and opens it', { session: 'doctor' }, async ({ app, screen, browser }) => {
    await app.open('/pro/today');
    const rail = screen.getByRole('complementary', 'Next steps');
    const next = card(screen, 'Daniel Rahman', rail);
    // "is incomplete" before the visit starts, "is still incomplete" once it has.
    await expect(next).toContainText(/their record is (still )?incomplete/, LOAD);
    await expect(rail.getByRole('button', /^Daniel Rahman Record incomplete/)).toBeVisible();
    await next.getByRole('button', 'Open the visit').tap();
    await expect(browser).toHaveURL('/pro/visit?encounterId=visit-1086', LOAD);
    await expect(screen.getByRole('region', 'Daniel Rahman')).toBeVisible(LOAD);
  });

  test('Today: searching the visits narrows the table, and a miss says so', { session: 'doctor' }, async ({ app, screen }) => {
    await app.open('/pro/today');
    const table = main(screen).getByRole('table');
    await expect(table.getByRole('row', /Amelia Tan/)).toBeVisible(LOAD);
    await screen.getByRole('searchbox', "Search today's visits").fill('Daniel');
    await expect(table.getByRole('row', /Daniel Rahman/)).toBeVisible();
    await expect(table.getByRole('row', /Amelia Tan/)).toHaveCount(0);
    await screen.getByRole('searchbox', "Search today's visits").fill(`zz-no-such-patient-${Date.now()}`);
    await expect(main(screen).getByText('No visits match.')).toBeVisible();
  });

  test('Schedule: the week counts agree with the calendar and the per-day table', { session: 'doctor' }, async ({ app, screen, browser }) => {
    await app.open('/pro/schedule');
    await expect(screen.getByRole('heading', { name: 'Schedule', level: 1 })).toBeVisible(LOAD);
    await expect(screen.getByRole('button', 'This week')).toBeDisabled();
    const calendar = screen.getByRole('group', 'Week calendar');
    await expect(calendar.getByRole('button', /^Amelia Tan \d\d:\d\d$/)).toBeVisible(LOAD);
    await expect(calendar.getByRole('button', /^Daniel Rahman \d\d:\d\d$/)).toBeVisible();
    const visits = await calendar.getByRole('button', /^[A-Z][a-z]+ [A-Za-z ]+ \d\d:\d\d$/).count();
    await expect(statValue(browser, 'Visits this week')).toHaveText(startsWith(visits));
    await expect(main(screen)).toContainText(new RegExp(`Monday \\d+ \\w+ to Sunday \\d+ \\w+ · ${visits} visits?`));
    // The chart's table: one row per day, and its visits add up to the week's.
    const perDay = screen.getByRole('table', 'Visits booked each day this week');
    await expect(perDay.getByRole('row')).toHaveCount(7);
    const days = await perDay.getByRole('cell').allTextContents();
    expect(days.reduce((sum, cell) => sum + num(cell), 0), 'visits per day add up to the week').toBe(visits);
    await expect(statCaption(browser, 'Records incomplete')).toHaveText('First: Daniel Rahman');
    // Opening a visit fills the details rail.
    await calendar.getByRole('button', /^Daniel Rahman/).tap();
    await expect(screen.getByRole('complementary', 'Schedule check and details')).toContainText('Daniel Rahman');
    // Another week has none of this week's visits.
    await screen.getByRole('button', 'Week after').tap();
    await expect(screen.getByRole('button', 'This week')).toBeEnabled();
    await expect(calendar.getByRole('button', /^Amelia Tan/)).toHaveCount(0);
  });

  test('Tasks: the open count, its tab and the sidebar badge agree', { session: 'doctor' }, async ({ app, screen, browser }) => {
    await app.open('/pro/tasks');
    await expect(screen.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible(LOAD);
    // The header line appears once the tasks have loaded; the tabs count 0 before that.
    const lead = /(\d+) open tasks?/;
    await expect(main(screen)).toContainText(lead, LOAD);
    const open = Number(lead.exec((await main(screen).textContent())!)![1]);
    expect(await tabCount(screen, 'Open')).toBe(open);
    await expect(statCaption(browser, 'Done')).toBeVisible();
    await expect(statValue(browser, 'Open')).toHaveText(new RegExp(`^${open} tasks?$`));
    // The sidebar badge counts the same open tasks (none: no badge).
    await expect(navLink(screen, 'Tasks')).toHaveAccessibleName(open ? `Tasks ${open}` : 'Tasks');
    const table = main(screen).getByRole('table');
    await screen.getByRole('tab', /^Open \d+$/).tap();
    if (open === 0) await expect(table).toContainText('No open tasks. The ward is caught up.');
    else await expect(table.getByRole('row')).toHaveCount(open + 1);
    await screen.getByRole('searchbox', 'Search tasks').fill(`zz-nothing-${Date.now()}`);
    await expect(table).toContainText(/No task matches "zz-nothing-\d+"\.|No open tasks/);
  });
});
