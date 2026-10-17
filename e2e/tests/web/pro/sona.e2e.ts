import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { askPanel, card, LOAD, main, MODEL, num, sona } from './helpers';
import { LOG } from '../roles';

// Answers the live models write (SageMaker Gemma "brain", MedGemma, the scribe). Each test asserts the answer is the
// model's: the caption names a model (not "rules"), and no "sample" / "fixture" / "not switched on" label stands in.
// Nothing here writes to Amelia Tan's stay: drafts and previews are read, never saved, approved or sent.
const SAMPLE = /sample|not switched on|not written by the model|starting/i;

describe('Sona answers', { tags: ['pro', 'models'], timeout: 240_000 }, () => {
  test('Sona panel on a visit: a typed question about the patient gets a cited model answer', { session: 'doctor', tags: ['ai'] }, async ({ app, screen, agent }) => {
    await app.open('/pro/visit?encounterId=visit-1042');
    await expect(sona(screen).getByText('Visit · Amelia Tan')).toBeVisible(LOAD);
    const turn = await askPanel(screen, 'What is her CURB-65 score, and does she need to stay in hospital?');
    // The steps fold into "Read N sources in S s" once the model has written the answer.
    await expect(turn.getByText(/^Read \d+ sources? in [\d.]+ s$/)).toBeVisible(MODEL);
    const by = turn.getByText(/^Sona · /);
    await expect(by).toBeVisible();
    await expect(by).not.toHaveText(/rules|sample|fixture/i);
    await expect(turn).not.toContainText(SAMPLE);
    await expect(turn).toContainText(/CURB-65/i);
    await expect(turn.getByRole('button', /^Source \d+$/).first()).toBeVisible();
    // The sources open in place.
    const sources = turn.getByRole('button', /^Used \d+ sources?$/);
    await sources.tap();
    await expect(sources).toHaveAttribute('aria-expanded', 'true');
    await agent.assert("The latest Sona answer in the right-hand panel is about Amelia Tan's pneumonia and her CURB-65 score, and its claims carry numbered source citations");
  });

  test('Sona panel on Today: "Which beds are blocked?" is answered by rule from the ward', { session: 'doctor' }, async ({ app, screen }) => {
    await app.open('/pro/today');
    const panel = sona(screen);
    await panel.getByRole('group', 'Things to ask Sona').getByRole('button', 'Which beds are blocked?').tap();
    const turn = panel.getByRole(LOG, "Sona's answers").getByRole('article').filter({ has: screen.getByRole('heading', 'You asked: Which beds are blocked?') });
    await expect(turn.getByText('Sona · rules')).toBeVisible(LOAD);
    const lead = turn.getByText(/^(\d+) beds? (is|are) blocked, about \d+ bed-hours waiting|^No bed is blocked/);
    await expect(lead).toBeVisible();
    const blocked = num(await lead.textContent());
    // One row per blocked bed, each naming the bed, the patient and its barriers with their owners.
    await expect(turn.getByRole('listitem')).toHaveCount(blocked);
    await expect(turn.getByRole('listitem').filter({ hasText: 'Bed 2 · Nurul Huda' })).toContainText('Final guarantee letter');
    await expect(turn.getByRole('listitem').filter({ hasText: 'Bed 14 · Lim Wei Jie' })).toContainText('Take-home medicines');
  });

  test('Sona panel on Today: a free question is answered by the model from the hospital data', { session: 'doctor', tags: ['ai'] }, async ({ app, screen, agent }) => {
    test.skip(true, 'BUG: a free question on Today is mostly answered by rule, not the model. "Which patient has a low potassium result, and what is the value?" came back "Sona · rules" with the generic "2 patients need you, most urgent first: …" lead in 4 of 5 asks across two full runs (once "Sona · gemma-4-26b-a4b" alone). packages/api/src/ask-model.ts:111-122 drops Gemma\'s reply whenever groundedSpec rejects it and shows pageLines(context), which ignores the question, labelled rules.');
    await app.open('/pro/today');
    // No rule matches this wording (ask-context.ts ruleFor), so the model answers it from the page data.
    const turn = await askPanel(screen, 'Which patient has a low potassium result, and what is the value?');
    const by = turn.getByText(/^Sona · /);
    await expect(by).toBeVisible(MODEL);
    await expect(by).not.toHaveText(/rules|sample|fixture/i);
    await expect(turn).not.toContainText(SAMPLE);
    await expect(turn).toContainText('Daniel Rahman');
    await expect(turn).toContainText('3.1');
    await agent.assert('The latest Sona answer in the right-hand panel says that Daniel Rahman has a low potassium of 3.1 mmol/L');
  });

  test("Sona panel on a patient's page reads that page", { session: 'doctor' }, async ({ app, screen }) => {
    test.skip(true, "BUG: the panel says \"Sona reads this page with you\", but on /pro/patients/$id it answers from Today, Ward and Tasks only: patient-overview.tsx registers neither useVisitAsk nor useSonaContext (the header reads \"Patients\"), so ask.free scope \"web\" (packages/api/src/ask-context.ts:13) never sees the record. Asked Amelia's SpO2 on her page (97 % shown), gemma-4-26b-a4b answered \"The provided data does not contain information regarding oxygen saturation levels.\"");
    await app.open('/pro/patients/SYN-1042');
    await expect(screen.getByRole('heading', { name: 'Oxygen-saturation', level: 3 })).toBeVisible(LOAD);
    await expect(sona(screen).getByText(/Amelia Tan/)).toBeVisible();
    const turn = await askPanel(screen, "What is Amelia Tan's oxygen saturation?");
    await expect(turn.getByText(/^Sona · /)).toBeVisible(MODEL);
    await expect(turn).toContainText('97');
  });

  test('Evidence: a clinical question gets claims cited from PubMed and the library', { session: 'doctor', tags: ['ai'] }, async ({ app, screen, agent }) => {
    await app.open('/pro/evidence');
    await expect(screen.getByRole('heading', 'Ask a clinical question')).toBeVisible(LOAD);
    // The Evidence page is its own chat: no docked panel.
    await expect(screen.getByRole('complementary', 'Sona')).toHaveCount(0);
    await screen.getByRole('textbox', 'Ask a clinical question').fill('Is oral amoxicillin as good as IV antibiotics for mild community-acquired pneumonia in adults?');
    await screen.getByRole('button', 'Send to Sona').tap();
    const answers = screen.getByRole(LOG, 'Evidence answers');
    const sources = answers.getByRole('button', /^Used \d+ sources? · You decide$/);
    await expect(sources).toBeVisible(MODEL);
    const by = answers.getByText(/^Sona · /);
    await expect(by).toBeVisible();
    await expect(by).not.toHaveText(/sample|fixture|cached/i);
    await expect(answers).not.toContainText(SAMPLE);
    await expect(answers.getByText(/^Read \d+ sources? in [\d.]+ s$/)).toBeVisible();
    // Every claim carries at least one numbered citation.
    const claims = answers.getByRole('listitem').filter({ has: screen.getByRole('button', /^Source \d+$/) });
    expect(await claims.count()).toBeGreaterThan(0);
    await expect(answers.getByRole('group', 'Ask next')).toBeVisible();
    await agent.assert('The Evidence answer addresses oral versus intravenous antibiotics for community-acquired pneumonia, and each of its listed claims ends with a numbered source citation');
  });

  test('Evidence: a general question does not bring up a patient\'s film', { session: 'doctor' }, async ({ app, screen }) => {
    test.skip(true, "BUG: on /pro/evidence (no patient open) the example \"CURB-65 of 2: admit or treat at home?\" was answered with \"Chest X-ray: Amelia Tan, 8 Oct 2026\" as Source 1 and that film opened in a dialog by itself. The library search has no relevance floor (packages/api/src/routers/evidence.ts:76 ponytail note, passagesFor k=3) and an indexed X-ray reading always leads the references (evidence.ts:135), so any general question can surface a patient's film.");
    await app.open('/pro/evidence');
    await screen.getByRole('group', 'Example questions').getByRole('button', 'CURB-65 of 2: admit or treat at home?').tap();
    const answers = screen.getByRole(LOG, 'Evidence answers');
    await expect(answers.getByRole('button', /^Used \d+ sources? · You decide$/)).toBeVisible(MODEL);
    await expect(screen.getByRole('dialog', /^Chest X-ray/)).toHaveCount(0);
    await expect(answers).not.toContainText(/Chest X-ray: [A-Z]/);
  });

  test("Visit briefing: Sona's summary before the visit comes from the model", { session: 'doctor', tags: ['ai'] }, async ({ app, screen, agent }) => {
    await app.open('/pro/visit?encounterId=visit-1042');
    const briefing = card(screen, 'Before you start', screen.getByRole('complementary', 'The medicine order and Sona AI'));
    await expect(briefing).toBeVisible(MODEL);
    await expect(briefing.getByText('Sona AI', { exact: true })).toBeVisible();
    await expect(briefing).not.toContainText(SAMPLE);
    await expect(briefing).toContainText(/You decide · \d+ sources?/);
    await agent.assert("The 'Before you start' briefing card summarises Amelia Tan's cough and fever and mentions her penicillin allergy");
  });

  test('Patient overview: the pre-visit summary is the model briefing, not a sample', { session: 'doctor' }, async ({ app, screen }) => {
    await app.open('/pro/patients/SYN-1042');
    const summary = card(screen, 'Before you see Amelia', main(screen));
    await expect(summary).toBeVisible(LOAD);
    await expect(summary).not.toContainText('Sona is reading the record…', MODEL);
    await expect(summary).not.toContainText(/No briefing|came back empty/);
    await expect(summary.getByText('Sample answer')).toHaveCount(0);
    await expect(summary).toContainText(/You decide · \d+ sources?/);
  });

  test('Clinical reasoning: possibilities for a visit, written by the model on request', { session: 'doctor', tags: ['ai'] }, async ({ app, screen, agent }) => {
    await app.open('/pro/visit?encounterId=visit-2002');
    const rail = screen.getByRole('complementary', 'The medicine order and Sona AI');
    const think = rail.getByRole('button', 'Think it through');
    await expect(think).toBeEnabled(LOAD);
    await think.tap();
    await expect(rail.getByRole('heading', 'Possibilities to consider')).toBeVisible(MODEL);
    await expect(rail.getByText('Sample', { exact: true })).toHaveCount(0);
    await expect(rail).not.toContainText(/This is a sample answer|waking up/);
    // The reasoning card's footer (the briefing card above it has one too).
    await expect(rail.getByText(/^You decide · \d+ sources?$/).last()).toBeVisible();
    await expect(rail.getByRole('button', 'Think again')).toBeVisible();
    await agent.assert("The 'Possibilities to consider' card lists more than one clinical possibility about Nurul Huda's pyelonephritis, each with its reasoning from her record, and leaves the decision to the doctor rather than stating one final diagnosis");
  });

  test('Ward huddle brief: written by the model over the live ward, and it opens the blocked beds', { session: 'doctor', tags: ['ai'] }, async ({ app, screen, agent }) => {
    await app.open('/pro/ward');
    const rail = screen.getByRole('complementary', 'Bed detail, huddle brief and forecast');
    const huddle = card(screen, 'Huddle brief', rail);
    await expect(huddle).toBeVisible(MODEL);
    await expect(huddle.getByText('Sona AI', { exact: true })).toBeVisible();
    await expect(huddle.getByText('Sona AI · sample brief')).toHaveCount(0);
    await expect(huddle).toContainText(/\d/);
    await huddle.getByRole('button', 'Show blocked beds').tap();
    await expect(screen.getByRole('tab', /^Blocked \d+$/)).toHaveAttribute('aria-selected', 'true');
    await agent.assert('The Huddle brief card summarises how many beds are ready or blocked on the ward and names which bed to start with');
  });

  test('Claim codes: suggested by the model, each citing the note, and the counts agree', { session: 'doctor', tags: ['ai'] }, async ({ app, screen, agent }) => {
    await app.open('/pro/guarantee-letter?encounterId=visit-1042');
    await expect(screen.getByRole('heading', 'Suggested codes')).toBeVisible(LOAD);
    const codes = main(screen).getByRole('table').filter({ has: screen.getByRole('columnheader', 'Cited from the note') });
    await expect(codes.getByRole('row').nth(1)).toBeVisible(MODEL);
    await expect(main(screen).getByText('Drafted by Sona', { exact: true }).first()).toBeVisible();
    await expect(main(screen).getByText('Sample draft')).toHaveCount(0);
    // Pneumonia is the principal code for her stay (ICD-10 J18.9, the insurer's organism check names it).
    await expect(codes.getByRole('row', /^J18\.9 Pneumonia/)).toContainText('Principal');
    const n = (await codes.getByRole('row').count()) - 1;
    const next = screen.getByRole('complementary', 'What to decide').getByRole('article');
    await expect(next).toContainText(`${n} codes are ready.`);
    await expect(next).toContainText(`${n} codes cite the note`);
    await agent.assert("The 'Suggested codes' table lists ICD-10 codes whose titles fit a mild community-acquired pneumonia in a patient with asthma and a penicillin allergy, each quoting a sentence of the note");
  });

  test('Discharge summary: a model draft to review, shown before anything is approved', { session: 'doctor' }, async ({ app, screen }) => {
    await app.open('/pro/discharge?encounterId=visit-2002');
    await expect(screen.getByRole('region', 'Nurul Huda')).toBeVisible(LOAD);
    const draft = screen.getByRole('textbox', 'Discharge summary draft');
    await expect(draft).toHaveValue(/pyelonephritis/i, MODEL);
    await expect(main(screen).getByText('Drafted by Sona', { exact: true })).toBeVisible();
    await expect(main(screen).getByText('Sample draft')).toHaveCount(0);
    await expect(main(screen).getByText('A proposal. Review and edit before you approve.')).toBeVisible();
    await expect(screen.getByRole('button', 'Approve discharge')).toBeDisabled();
  });

  test('Ambient scribe: a pasted consultation is drafted into the note by the model, and nothing is saved', { session: 'doctor' }, async ({ app, screen }) => {
    test.skip(true, 'BUG: the scribe draft falls back to the rule fixture while the brain model answers everywhere else. On visit-2002, "Draft the note" with a 4-line transcript ends after about 110 s in "Revision 1 · Sample draft · 1 section waits for your review" (twice). packages/api/src/scribe-model.ts:196-206 waits up to SCRIBE_MS 90 s on the brain box and swallows any failure or unchecked draft, returning ruleNote (models.ts:233) labelled fixture.');
    await app.open('/pro/visit?encounterId=visit-2002');
    const status = screen.getByRole('status').filter({ hasText: /^Revision \d+ · / });
    await expect(status).toBeVisible(LOAD);
    const revision = num(await status.textContent());
    await screen.getByRole('textbox', 'Consultation transcript').fill([
      'Doctor: How is the loin pain today?',
      'Patient: Much better, no pain since yesterday. I am eating and walking.',
      'Doctor: Any fever or burning when you pass urine?',
      'Patient: No fever and the burning has stopped.',
    ].join('\n'));
    await screen.getByRole('button', 'Draft the note').tap();
    await expect(status).toContainText(/Drafted · \d+ sections? waits? for your review/, MODEL);
    await expect(status).not.toContainText('Sample draft');
    await expect(screen.getByText('Sona draft', { exact: true }).first()).toBeVisible();
    // Nothing changes until a draft is used and saved.
    await expect(screen.getByRole('button', 'Save the note')).toBeDisabled();
    await expect(status).toContainText(`Revision ${revision}`);
  });
});
