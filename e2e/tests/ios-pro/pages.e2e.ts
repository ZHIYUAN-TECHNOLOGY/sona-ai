import { describe, test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { dragUntilVisible, MODEL_LABEL, NOT_A_MODEL, openAmeliaVisit, openAs, openFromMenu, openMenu } from './helpers';

// Every page the doctor works from, each with real content from the seeded synthetic hospital. Viewing only.
describe('pages', { tags: ['pro', 'ios', 'deep'] }, () => {
  test('Ward: beds, blockers and Amelia’s bed, and Sona ranks who can go home', async (fixtures) => {
    const { screen } = fixtures;
    await openAs(fixtures);
    await openFromMenu(screen, 'Ward');
    await expect(screen.getByText(/^Now · \d+ beds$/)).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText(/^\d+ discharges blocked · ~\d+ bed.hours waiting$/)).toBeVisible();
    await expect(screen.getByRole('image', /^Beds freeing in the next 24 hours\. /)).toBeVisible();
    const bed6 = screen.getByRole('button', /^Bed 6, Amelia, about \d+ bed-hours waiting$/);
    await screen.scrollUntilVisible(bed6);
    await expect(screen.getByRole('button', 'Send final guarantee letter on Bed 6 to Billing')).toBeVisible();
    await screen.getByRole('button', 'Ask Sona: Who can go home soonest?').tap();
    await expect(screen.getByText('You: Who can go home soonest?')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByLabel(/^Bed 6 · Amelia Tan, Blocked · /)).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByLabel(/^Bed \d+ · .+, Fit to go · nothing holding the bed$/).first()).toBeVisible();
    // The ranking is worked out by fixed rules, and says so.
    await expect(screen.getByRole('button', 'Rule-based')).toBeVisible();
  });

  test('Shift handover: the deck holds every patient on the list', async (fixtures) => {
    const { screen } = fixtures;
    await openAs(fixtures);
    await openMenu(screen);
    const row = screen.getByRole('button', /^Shift handover, \d+ patients?$/);
    const total = Number(/(\d+) patients?/.exec((await row.textContent()) ?? '')?.[1]);
    expect(total).toBeGreaterThan(0);
    await row.tap();
    await expect(screen.getByText(new RegExp(`^\\d+ of ${total} left$`))).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('button', /^Hand over .+/).first()).toBeVisible();
    await expect(screen.getByRole('button', /^Discuss .+ verbally$/).first()).toBeVisible();
  });

  test('Results: today’s results to review, Daniel’s low potassium first', async (fixtures) => {
    const { screen } = fixtures;
    await openAs(fixtures);
    await screen.getByRole('button', /^Results\. /).tap();
    await expect(screen.getByText(/^Today · \d+ results?$/)).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText(/^\d+ to review/)).toBeVisible();
    await expect(screen.getByRole('button', /^Daniel Rahman, \d{2}:\d{2}, Low potassium 3\.1 mmol\/L$/)).toBeVisible();
  });

  test('Messages: the inbox agrees with the sidebar line', async (fixtures) => {
    const { screen } = fixtures;
    await openAs(fixtures);
    await openMenu(screen);
    const row = screen.getByRole('button', /^Messages, /);
    const caughtUp = /All caught up/.test((await row.textContent()) ?? '');
    await row.tap();
    if (caughtUp) await expect(screen.getByText('No patient is waiting for a reply.')).toBeVisible({ timeout: 30_000 });
    else {
      // Waiting threads (Sona Care messages arrive from the Care suite in parallel): the count, then each thread with its triage.
      await expect(screen.getByText(/^\d+ waiting · /)).toBeVisible({ timeout: 30_000 });
      await expect(screen.getByRole('button', /^.+, Bed \d+\. .+ Waiting \d+ (min|h)/).first()).toBeVisible();
    }
  });

  // An additive write with a run-unique title, on Daniel (not Amelia, whose stay another test owns).
  test('Follow-up tasks: a doctor adds a task for Daniel with an owner and a due date', {
    // Not an app bug: the Task field renders its text as children, so the engine's fill and clear fail their text check
    // and typed text does not reach the due-phrase parser. Needs an engine fix or a plain `value` on the field.
    skip: 'engine cannot enter text into the Task composer (children-rendered TextInput); see report',
  }, async (fixtures) => {
    const { screen } = fixtures;
    const title = `E2E ${Date.now()}`;
    await openAs(fixtures);
    await openFromMenu(screen, 'Follow-up tasks');
    // Below every open task (the Care suite adds some in parallel).
    const daniel = screen.getByRole('button', 'Add a follow-up for Daniel Rahman');
    await dragUntilVisible(screen, daniel, { timeout: 60_000 });
    await daniel.tap();
    // The composer reads a due phrase out of the title and offers it.
    // The field starts with a suggested title and renders its text as children (no clear or fill takes), so the
    // run-unique words and a due phrase are typed after it.
    const field = screen.getByLabel('Task');
    await expect(field).toBeVisible({ timeout: 15_000 });
    await field.pressSequentially(` ${title} in 2 weeks`);
    await screen.getByRole('button', /^Due (?!.*\. Change$).+/).tap();
    await screen.getByRole('button', 'Choose an owner').tap();
    await screen.getByRole('button', 'Clinic nurse').tap();
    await expect(screen.getByRole('button', 'Owner, Clinic nurse. Change')).toBeVisible();
    await expect(screen.getByRole('button', /^Due .+\. Change$/)).toBeVisible();
    await screen.getByRole('button', 'Add task').tap();
    await dragUntilVisible(screen, screen.getByRole('checkbox', new RegExp(`${title}, Clinic nurse, due `)), { timeout: 60_000 });
  });

  test('Discharge (view only): what blocks Amelia’s, with a model-drafted summary', async (fixtures) => {
    const { screen } = fixtures;
    await openAs(fixtures);
    await openAmeliaVisit(screen);
    await screen.getByRole('button', /^Discharge\. /).tap();
    await expect(screen.getByText(/^Amelia Tan · Bed 6/)).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText(/\d+ left before Amelia can go home/)).toBeVisible();
    await expect(screen.getByText(/^Frees Bed 6 · creates \d+ follow-up tasks?/)).toBeVisible();
    // A doctor is not locked out; the approval itself belongs to the journey test.
    await expect(screen.getByRole('button', "Needs a doctor's approval. Locked")).toBeHidden();
    await expect(screen.getByRole('button', 'Review codes and send')).toBeVisible();
    // Its summary and leaflet are one model draft, labelled under the leaflet.
    await dragUntilVisible(screen, screen.getByRole('button', MODEL_LABEL));
    await expect(screen.getByText(NOT_A_MODEL)).toHaveCount(0);
  });

  test('Guarantee letter (view only): Amelia’s codes and who coded them', async (fixtures) => {
    const { screen } = fixtures;
    await openAs(fixtures);
    // From her discharge's letter blocker (Today's "Open the guarantee letter" row sits under the voice dock).
    await openAmeliaVisit(screen);
    await screen.getByRole('button', /^Discharge\. /).tap();
    // A tap while Discharge is still sliding in goes nowhere: tap until the letter's own screen (its title is its id) is up.
    await expect.poll(async () => {
      if (await screen.getByTestId('Guarantee letter').isVisible()) return true;
      const review = screen.getByRole('button', 'Review codes and send');
      if (await review.isVisible()) await review.tap();
      return false;
    }, { timeout: 30_000, interval: 1_500 }).toBe(true);
    await expect(screen.getByText(/^Amelia Tan · .+/).first()).toBeVisible({ timeout: 30_000 });
    // The letter's scroll view ignores synthesized scrolls, so it is dragged (and keeps dragging while the codes arrive).
    await dragUntilVisible(screen, screen.getByRole('button', /^[A-Z]\d{2}(\.\d+)?, /).first());
    await dragUntilVisible(screen, screen.getByRole('button', MODEL_LABEL), { timeout: 60_000 });
    await expect(screen.getByText(NOT_A_MODEL)).toHaveCount(0);
    // A doctor may send it, but the send belongs to the journey test: nothing here is locked or tapped.
    await expect(screen.getByRole('button', 'Needs a doctor to send. Locked')).toBeHidden();
  });

  test('Coding audit: the open note and what is at risk', async (fixtures) => {
    const { screen } = fixtures;
    await openAs(fixtures);
    await openFromMenu(screen, 'Coding audit');
    await expect(screen.getByText(/RM [\d,]+/).first()).toBeVisible({ timeout: 30_000 });
  });

  // Amelia has no stored film, so the X-ray read itself is unreachable without uploading one: the empty state is the test.
  test('X-ray with no film: Sona says so in place and invents no findings', async (fixtures) => {
    const { screen } = fixtures;
    await openAs(fixtures);
    await openAmeliaVisit(screen);
    await screen.getByRole('button', 'X-ray. No image').tap();
    await expect(screen.getByText('You: Review Amelia’s chest X-ray')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByLabel('No image is attached, so there are no findings yet.')).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByText('No image is attached and no findings have been generated.')).toBeVisible();
    await expect(screen.getByRole('button', 'Add a teaching image')).toBeVisible();
    await expect(screen.getByRole('button', 'Analyse X-ray')).toBeHidden();
  });

  test('Settings: demo clock, colour key and the workspace', async (fixtures) => {
    const { screen } = fixtures;
    await openAs(fixtures);
    await openMenu(screen);
    await expect(screen.getByRole('button', /^Demo (clock · real time|time · .+)\. Change the demo clock$/)).toBeVisible();
    await screen.getByRole('button', 'Settings').tap();
    await expect(screen.getByText('Live updates connected.')).toBeVisible({ timeout: 30_000 });
    const key = screen.getByLabel('Colour key: Must not miss red, Medicine violet, Diagnosis teal, Symptom blue, Unconfirmed amber');
    await screen.scrollUntilVisible(key);
    await expect(screen.getByText(/^Key words in answers and cards are tinted/)).toBeVisible();
    await screen.scrollUntilVisible(screen.getByRole('button', 'Demo tools · clock'));
    await screen.getByRole('button', 'Demo tools · clock').tap();
    const clock = screen.getByText(/^\w{3} \d{1,2} \w{3} at \d{2}:\d{2} · (real time|demo time.*)$/);
    await screen.scrollUntilVisible(clock);
    await expect(screen.getByRole('button', 'Real time')).toBeVisible();
  });
});
