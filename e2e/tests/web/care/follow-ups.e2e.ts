import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { type Doctor, formatIn, rpc, settled, type Visit, whenWords } from './care';

type Request = { id: string; status: string; doctorName: string; startsAt: string };
/** The doctor these tests ask for: not on Amelia's care team, so the cross-app journey's own bookings stay apart. */
const DOCTOR = 'Dr. Arjun Menon';

describe('Sona Care follow-ups', { tags: ['care', 'deep'], session: 'patient' }, () => {
  test('shows her next visit, the month and her visit list as the server has them', { tags: ['smoke'] }, async ({ app, screen, browser }) => {
    await app.open('/care/follow-ups');
    await settled(screen);
    const [visits, requests] = await Promise.all([rpc<Visit[]>(browser, 'care/followUps', { lang: 'en' }), rpc<Request[]>(browser, 'care/bookings/list')]);
    const upcoming = visits.filter(v => v.inDays >= 0), past = visits.filter(v => v.inDays < 0), open = requests.filter(r => r.status !== 'confirmed');
    const next = upcoming[0];
    const main = screen.getByRole('main');
    if (next) {
      const time = await formatIn(browser, next.date, 'en-MY', { hour: 'numeric', minute: '2-digit' });
      await expect(main).toContainText(`Your next visit is ${next.inDays === 0 ? 'today' : await formatIn(browser, next.date, 'en-MY', { weekday: 'short', day: 'numeric', month: 'short' })} at ${time}.`);
      await expect(screen.getByRole('heading', next.title, { level: 2 })).toBeVisible();
      await expect(main).toContainText(next.why);
      await expect(screen.getByRole('button', 'Add to calendar')).toBeVisible();
    } else {
      await expect(main).toContainText(open.some(r => r.status === 'requested') ? 'waiting for the hospital. Nothing is booked yet.' : 'No visit booked. Book one below.');
    }

    // The calendar opens on this month in Malaysia, today marked, each visit on its day.
    const month = await browser.evaluate(() => new Intl.DateTimeFormat('en-MY', { timeZone: 'Asia/Kuala_Lumpur', month: 'long', year: 'numeric' }).format(new Date()));
    const calendar = screen.getByRole('region', `Calendar, ${month}`);
    await expect(calendar.getByRole('heading', month)).toBeVisible();
    const today = calendar.getByRole('button', /today/);
    await expect(today).toHaveAttribute('aria-current', 'date');
    await expect(today).toHaveAttribute('aria-pressed', 'true');
    for (const v of visits) {
      const key = await formatIn(browser, v.date, 'en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
      const thisMonth = await formatIn(browser, new Date().toISOString(), 'en-CA', { year: 'numeric', month: '2-digit' });
      if (!key.startsWith(thisMonth)) continue;
      const label = `${await formatIn(browser, v.date, 'en-MY', { hour: 'numeric', minute: '2-digit' })} · ${v.title}`;
      await expect(calendar.getByRole('button', new RegExp(`^${Number(key.slice(8))}\\b.*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeVisible();
    }

    const tabs = screen.getByRole('tablist', 'Visits');
    await expect(tabs.getByRole('tab', `Upcoming ${upcoming.length + open.length}`)).toHaveAttribute('aria-selected', 'true');
    for (const v of upcoming) await expect(screen.getByRole('listitem').filter({ hasText: await whenWords(browser, v.date) }).filter({ hasText: v.title }).first()).toBeVisible();
    await tabs.getByRole('tab', `Past ${past.length}`).tap();
    await expect(tabs.getByRole('tab', `Past ${past.length}`)).toHaveAttribute('aria-selected', 'true');
    if (!past.length) await expect(screen.getByText('No past visits yet.')).toBeVisible();
    for (const v of past) await expect(screen.getByRole('listitem').filter({ hasText: v.title }).first()).toBeVisible();
  });

  test('the calendar moves a month at a time and comes back to this month', async ({ app, screen, browser }) => {
    await app.open('/care/follow-ups');
    await settled(screen);
    const [now, next] = await browser.evaluate(() => {
      const f = new Intl.DateTimeFormat('en-MY', { timeZone: 'UTC', month: 'long', year: 'numeric' });
      const d = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date()));
      return [f.format(d), f.format(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)))];
    });
    await screen.getByRole('button', 'Next month').tap();
    await expect(screen.getByRole('region', `Calendar, ${next}`)).toBeVisible();
    await expect(screen.getByRole('region', `Calendar, ${next}`).getByRole('button', /today/)).toHaveCount(0);
    await screen.getByRole('button', 'Back to this month').tap();
    await expect(screen.getByRole('region', `Calendar, ${now}`).getByRole('button', /today/)).toBeVisible();
    await expect(screen.getByRole('button', 'Back to this month')).toHaveCount(0);
  });

  test('picking a day shows its visits and the open clinic times', async ({ app, screen, browser }) => {
    await app.open('/care/follow-ups');
    await settled(screen);
    const doctors = await rpc<Doctor[]>(browser, 'care/doctors/list', {});
    const doctor = doctors.find(d => d.name === DOCTOR)!;
    const slot = doctor.nextSlots[0]!;
    const thisMonth = await formatIn(browser, new Date().toISOString(), 'en-CA', { year: 'numeric', month: '2-digit' });
    const key = await formatIn(browser, slot.times[0]!, 'en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
    if (!key.startsWith(thisMonth)) await screen.getByRole('button', 'Next month').tap();
    await screen.getByRole('button', new RegExp(`^${Number(key.slice(8))}\\b`)).tap();
    const heading = await formatIn(browser, slot.times[0]!, 'en-MY', { weekday: 'long', day: 'numeric', month: 'long' });
    await expect(screen.getByRole('heading', heading, { level: 3 })).toBeVisible();
    await expect(screen.getByText('Open times')).toBeVisible();
    const times = [];
    for (const t of slot.times) times.push(await formatIn(browser, t, 'en-MY', { hour: 'numeric', minute: '2-digit' }));
    await expect(screen.getByText(`${DOCTOR}: ${times.join(', ')}`)).toBeVisible();
  });

  test('a booking request goes doctor, day, time, review, and waits for the hospital', async ({ app, screen, browser }) => {
    await app.open('/care/follow-ups');
    await settled(screen);
    const book = screen.getByRole('region', 'Book a visit');
    const steps = book.getByRole('list', 'Steps');
    await expect(steps.getByRole('listitem').filter({ hasText: '1. Doctor' })).toHaveAttribute('aria-current', 'step');

    const doctor = (await rpc<Doctor[]>(browser, 'care/doctors/list', {})).find(d => d.name === DOCTOR)!;
    test.skip(!doctor.nextSlots.length, `${DOCTOR} has no free times left in the next two weeks`);
    await book.getByRole('button', new RegExp(`^${DOCTOR}`)).tap();
    await expect(book.getByRole('button', new RegExp(`^${DOCTOR}`))).toHaveAttribute('aria-pressed', 'true');
    await expect(steps.getByRole('listitem').filter({ hasText: '2. Day' })).toHaveAttribute('aria-current', 'step');
    await expect(book.getByText('Pick a time to continue.')).toBeVisible();

    const days = book.getByRole('group', 'Clinic days');
    await expect(days.getByRole('button')).toHaveCount(doctor.nextSlots.length);
    await expect(days.getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');
    const time = book.getByRole('group', 'Free times').getByRole('button').first();
    const at = doctor.nextSlots[0]!.times[0]!;
    const when = await whenWords(browser, at);
    await expect(time).toHaveText(await formatIn(browser, at, 'en-MY', { hour: 'numeric', minute: '2-digit' }));
    await time.tap();
    await expect(time).toHaveAttribute('aria-pressed', 'true');
    await expect(steps.getByRole('listitem').filter({ hasText: '4. Review' })).toHaveAttribute('aria-current', 'step');

    // Review before deciding: the whole request in one line, then the optional reason.
    await expect(book.getByRole('heading', '4. Review your request')).toBeVisible();
    await expect(book).toContainText(`You are asking for: ${doctor.specialty} visit with ${DOCTOR}, ${when}, ${doctor.room}.`);
    await book.getByLabel('Reason (optional)').fill(`E2E ${Date.now()}: check my walking after discharge`);
    const sent = browser.waitForResponse('**/rpc/care/bookings/request');
    await book.getByRole('button', 'Confirm request').tap();
    expect((await sent).status).toBe(200);
    await expect(book.getByText('Request sent. The hospital still has to confirm it. Until then it shows as "Waiting for the hospital" under Upcoming.')).toBeVisible({ timeout: 15_000 });

    // Under Upcoming, waiting for the hospital; on the calendar, marked as waiting; the time is no longer offered.
    const row = screen.getByRole('listitem').filter({ hasText: `${when} · ${doctor.specialty}` });
    await expect(row).toContainText(DOCTOR);
    await expect(row).toContainText('Waiting for the hospital', { ignoreCase: true }); // the chip is set in capitals
    const mine = (await rpc<Request[]>(browser, 'care/bookings/list')).find(r => r.doctorName === DOCTOR && new Date(r.startsAt).getTime() === new Date(at).getTime());
    expect(mine?.status).toBe('requested');
    const left = (await rpc<Doctor[]>(browser, 'care/doctors/list', {})).find(d => d.name === DOCTOR)!;
    expect(left.nextSlots.flatMap(s => s.times)).not.toContain(at);
  });

  test('the visit-prep card shows what the doctor will read for her next visit', async ({ app, screen, browser }) => {
    await app.open('/care/follow-ups');
    await settled(screen);
    const prep = await rpc<{ appointment: { startsAt: string } | null; questions: string[]; doctorWillSee: string | null }>(browser, 'care/visitPrep/get');
    test.skip(!prep.appointment, 'No visit is booked ahead, so there is nothing to prepare');
    const form = screen.getByRole('form', 'Get ready for your visit');
    await expect(form).toContainText(`${await whenWords(browser, prep.appointment!.startsAt)}. Ask up to three questions.`);
    for (const [i, q] of [0, 1, 2].map(i => [i, prep.questions[i] ?? ''] as const)) await expect(form.getByLabel(`Question ${i + 1}`)).toHaveValue(q);
    await expect(form.getByRole('switch', 'Share my last 7 days of readings')).toBeVisible();
    await expect(form).toContainText(prep.doctorWillSee ?? 'Nothing yet. Save to see exactly what your doctor will read.');
  });
});
