import { describe, test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { clearOfDock, dischargedOnMedicine, homeGreeting, shown, signedIn, tab, TAGS } from './care';

// One launch: home, then every place in the dock, reading what the server holds for Amelia (SYN-1042).
describe('Sona Care home and the dock', { tags: [...TAGS, 'smoke'], serial: true }, () => {
  test('home greets Amelia with her updates, next visit and check-in', async f => {
    const { screen } = f;
    await signedIn(f);
    await expect(homeGreeting(screen)).toBeVisible();
    await expect(screen.getByRole('button', /^Notifications\. /)).toBeVisible();
    await expect(screen.getByLabel("Today's Latest updates")).toBeVisible();
    await expect(screen.getByRole('button', /^Today's medicines\. .+ Open medicines$/)).toBeVisible();
    // Her seeded clinic visit at the synthetic hospital (or none, if a run has moved it on).
    await expect(screen.getByRole('button', /^(Next visit\. .+ Demo General Hospital\. Open my visits|No visit booked|Your visits show here)$/)).toBeVisible();
    await clearOfDock(screen, screen.getByRole('button', 'Synthetic data'));
    await expect(screen.getByLabel("Today's check-in")).toBeVisible();
    await expect(screen.getByText('Not for emergencies · call 999')).toBeVisible();
    for (const place of ['Home', 'Schedule', 'Medicine', 'Doctors'] as const) await expect(tab(screen, place)).toBeVisible();
    await expect(screen.getByRole('button', /^Messages/)).toBeVisible();
    await expect(screen.getByRole('button', 'Ask Sona Care')).toBeVisible();
  });

  test('Synthetic data says every person in the demo is fictional', async ({ screen }) => {
    await screen.getByRole('button', 'Synthetic data').tap();
    await expect(screen.getByText("Every patient, doctor, hospital and insurer in this demo is fictional. No real person's data is used.")).toBeVisible();
    await expect(screen.getByText(/^Answers marked "sample" come from authored examples/)).toBeVisible();
    await screen.getByRole('button', 'Close').tap();
    await expect(screen.getByRole('button', 'Synthetic data')).toBeVisible();
  });

  test('Schedule shows this week, with today picked and its day below', async ({ screen }) => {
    await tab(screen, 'Schedule').tap();
    // The header says what the server holds next: a visit, all done today, or nothing booked.
    await expect(screen.getByLabel(/^Schedule\. (Next: .+|All done today.*|Nothing booked yet)$/)).toBeVisible();
    await expect(screen.getByRole('button', /^Book a visit, (Next .+|Find a doctor)$/)).toBeVisible();
    await expect(screen.getByRole('button', /^Care team, /)).toBeVisible();
    // Today's chip ("Friday 9 October, today, …") is picked, and its day heads the agenda ("TODAY · FRI 9 OCT"),
    // under any requests, so it may be below the fold.
    await expect(screen.getByRole('button', /^[A-Z][a-z]+day \d{1,2} [A-Z][a-z]+, today(, |$)/, { selected: true })).toBeVisible();
    const todayLabel = screen.getByText(/^TODAY · [A-Z]{3} \d{1,2} [A-Z]{3}$/);
    await screen.scrollUntilVisible(todayLabel);
    await expect(todayLabel).toBeVisible();
    const week = screen.getByText(/^\d{1,2} [A-Z][a-z]{2} – \d{1,2} [A-Z][a-z]{2}$/);
    await screen.scrollUntilVisible(week, { direction: 'up' });
    const thisWeek = await week.textContent() ?? '';
    await screen.getByRole('button', 'Next week').tap();
    await expect(week).not.toHaveText(thisWeek);
    await screen.getByRole('button', 'Previous week').tap();
    await expect(week).toHaveText(thisWeek);
  });

  test('the visit review: what to bring, and a question sent to the care team', async ({ screen, device }) => {
    // What the server holds decides the path: the next visit (Book a visit reads "Next …") leads its day as a card with
    // the review and a questions box; a visit earlier today is a stop whose "Before you go" opens the review in place;
    // with neither, today is a free day.
    const card = screen.getByLabel(/^Next visit\. /);
    if (await screen.getByRole('button', /^Book a visit, Next /).count() === 0) {
      const review = screen.getByRole('button', 'Before you go');
      if (await review.count() === 0) {
        await clearOfDock(screen, screen.getByText('A free day. Rest up.'));
        await expect(screen.getByText('A free day. Rest up.')).toBeVisible();
        return;
      }
      await clearOfDock(screen, review);
      await review.tap();
      await expect(screen.getByText(/^Bring your IC/)).toBeVisible();
      await screen.getByRole('button', 'Hide').tap();
      await expect(screen.getByText(/^Bring your IC/)).toBeHidden();
      return;
    }
    // A next visit leads its day's agenda, or sits under today's stops as Next visit; an empty today offers to go to it.
    await screen.scrollUntilVisible(screen.getByText(/^TODAY · /));
    const goTo = screen.getByRole('button', /^Go to /);
    if (await goTo.count() > 0) await goTo.tap();
    const question = `E2E ${Date.now()} can I drive after the visit?`;
    const box = screen.getByRole('textbox', /^Add a question/);
    await screen.scrollUntilVisible(card);
    await expect(card).toBeVisible();
    await clearOfDock(screen, box);
    // The card's own review (an earlier visit today can add a "Before you go" stop of its own above it).
    await expect(screen.getByText(/^Bring your IC/)).toBeVisible();
    await expect(screen.getByText(/^Questions for your doctor/)).toBeVisible();
    await box.fill(question);
    // The keyboard's own done key saves it. press('Enter') types a newline through XCTest, which overran the runner's
    // main-thread watchdog on this field every time, while a tap on the key saves at once.
    // agent-device sometimes refuses a ref tap on a key ("behind the visible keyboard"), so tap the key's own point.
    const done = await device.locator('label="done"').boundingBox();
    if (!done) throw new Error('the keyboard has no done key');
    await screen.tapAt({ x: done.x + done.width / 2, y: done.y + done.height / 2 });
    await expect(screen.getByText(`“${question}”`)).toBeVisible();
    await expect(screen.getByText('Sent to your care team')).toBeVisible({ timeout: 30_000 });
    // It reached the thread as a message.
    await screen.getByRole('button', /^Messages/).tap();
    // A bubble reads as one node ("You, 00:12: Question for my next visit: …").
    await expect(screen.getByLabel(`Question for my next visit: ${question}`, { exact: false })).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('button', 'Back').tap();
    // Removing it only tidies this phone's list.
    await screen.getByRole('button', `Remove question: ${question}`).tap();
    await expect(screen.getByText(`“${question}”`)).toBeHidden();
  });

  test('Medicine shows her medicines, or that they come with discharge', async ({ screen }) => {
    await tab(screen, 'Medicine').tap();
    if (await dischargedOnMedicine(screen)) {
      // Her next dose with how to take it, the way to add one from a photo, the full plan, then her medicines below.
      await expect(screen.getByLabel(/^Today's\. Medicines\. \d+ of \d+ taken/)).toBeVisible();
      await expect(screen.getByLabel(/^Time to take .+, \d{1,2}:\d{2} [AP]M/).first()).toBeVisible();
      await expect(screen.getByRole('button', /^Add from a photo, /)).toBeVisible();
      await expect(screen.getByRole('button', /^Full plan, /)).toBeVisible();
      await screen.scrollUntilVisible(screen.getByLabel('Your medicines'));
      await expect(screen.getByLabel('Your medicines')).toBeVisible();
    } else {
      await expect(screen.getByText("Your medicines show here once you're discharged.")).toBeVisible();
    }
  });

  test('Doctors lists her care team and her records', async ({ screen }) => {
    await tab(screen, 'Doctors').tap();
    await expect(screen.getByLabel('Your. care team')).toBeVisible();
    await expect(screen.getByRole('button', /^Dr\. Lim Wei Jie, Respiratory, rated 4\.8 of 5, in your care team, next clinic /)).toBeVisible();
    await expect(screen.getByRole('button', /^Dr\. Priya Nair, General medicine, rated 4\.7 of 5, in your care team, next clinic /)).toBeVisible();
    await expect(screen.getByRole('button', 'Find a doctor')).toBeVisible();
    await expect(screen.getByLabel('Your records')).toBeVisible();
    const papers = screen.getByText('Your discharge plan and leaflet show here once you go home.');
    if (!(await shown(papers, 3_000))) await expect(screen.getByRole('button', /^Discharge plan, /)).toBeVisible();
  });

  test('Home comes back from the dock', async ({ screen }) => {
    await tab(screen, 'Home').tap();
    await expect(tab(screen, 'Home')).toBeVisible();
    await screen.scrollUntilVisible(homeGreeting(screen), { direction: 'up' });
  });
});
