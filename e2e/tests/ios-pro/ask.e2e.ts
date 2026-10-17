import { describe, test } from '@e2e-dev/mobile';
import { expect, type Screen } from 'e2e';
import { ask, dragUntilVisible, MODEL_LABEL, NOT_A_MODEL, openAmeliaVisit, openAs } from './helpers';

/**
 * The answer carries a model's label ("AI draft · Sona Med · check before acting"), never a sample's or a "did not
 * answer". The label closes the answer, so the page scrolls down to it as it lands; models take 3 to 60 s, longer cold.
 */
async function modelAnswered(screen: Screen) {
  // While Sona answers, the voice button reads "<thinking>. Stop response"; it is "Talk to Sona" again once the answer is in.
  await expect(screen.getByRole('button', /Stop response$/)).toHaveCount(0, { timeout: 150_000 });
  await expect(screen.getByRole('button', 'Talk to Sona')).toBeVisible();
  // The page lands either above the label (a long answer) or past it (at the sources), so look down, then up.
  // The thread's scroll view ignores synthesized scrolls, so it is dragged.
  const label = screen.getByRole('button', MODEL_LABEL).last();
  if (!await dragUntilVisible(screen, label, { timeout: 20_000 }).then(() => true, () => false)) {
    await dragUntilVisible(screen, label, { back: true, timeout: 30_000 });
  }
  await expect(screen.getByText(NOT_A_MODEL)).toHaveCount(0);
  await expect(screen.getByRole('button', NOT_A_MODEL)).toHaveCount(0);
}

/** Back from an answer to the visit page, ready for the next question. */
async function backToVisit(screen: Screen) {
  await screen.getByRole('button', 'Back').tap();
  await expect(screen.getByText('Amelia Tan · 42 · Respiratory review')).toBeVisible({ timeout: 15_000 });
  // The visit page shows no answer. The thread keeps earlier answers above the next one, whose label is the last.
  await expect(screen.getByRole('button', MODEL_LABEL)).toHaveCount(0);
}

// Ask Sona in place on Amelia's visit (SYN-1042): real model answers land in the page with their sources. Viewing only.
describe('Ask Sona about Amelia', { tags: ['pro', 'ios', 'models'], serial: true }, () => {
  test('“What should I know before I see Amelia?” lands a briefing from her record', { tags: ['ai'] }, async (fixtures) => {
    const { screen, agent } = fixtures;
    await openAs(fixtures);
    await openAmeliaVisit(screen);
    await ask(screen, 'What should I know before I see Amelia?');
    await modelAnswered(screen);
    // Her record, not a generic answer: her allergy in the answer, her observations in the card under its label.
    await expect(screen.getByText(/penicillin/i).first()).toBeVisible();
    await expect(screen.getByLabel(/^Temperature, 38\.1 °C/)).toBeVisible();
    await agent.assert('the answer on screen is a clinical briefing about Amelia Tan drawn from her record (her complaint, observations or allergy), not an error or a placeholder');
    // Sources close the answer, under its record cards.
    await screen.scrollUntilVisible(screen.getByRole('link', /^Response source, /).first());
    await backToVisit(screen);
  });

  test('Brief me gives the summary in place', async ({ screen }) => {
    await screen.getByRole('button', /^Brief me\. /).tap();
    await modelAnswered(screen);
    await screen.scrollUntilVisible(screen.getByRole('link', /^Response source, /).first());
    await backToVisit(screen);
  });

  test('a differential comes from the model with its reasoning sourced', { tags: ['ai'] }, async ({ screen, agent }) => {
    await ask(screen, 'What is the differential diagnosis for Amelia?');
    await modelAnswered(screen);
    await agent.assert('the answer on screen weighs possible diagnoses for a patient with cough and fever, such as a chest infection or pneumonia, rather than refusing or erroring');
    await backToVisit(screen);
  });

  // The medicines check is worked out from her record by rules, not by a model, and says what it cannot check.
  test('a medicines check lists her medicines to confirm and the allergy, and says interactions are not checked', { tags: ['ai'] }, async ({ screen, agent }) => {
    // Typed: the suggestion of the same words sits under the voice dock on the visit page, where a tap lands on Talk.
    await ask(screen, 'Check Amelia’s medicines for interactions');
    await expect(screen.getByText('Penicillin allergy still needs confirming')).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByText(/^\d+ medicines? to confirm before prescribing$/)).toBeVisible();
    await expect(screen.getByText('No validated interaction database is connected')).toBeVisible();
    await expect(screen.getByRole('button', /^Salbutamol inhaler, .+Needs confirmation$/)).toBeVisible();
    await agent.assert('the answer on screen reviews Amelia Tan’s medicines: what to confirm before prescribing and her penicillin allergy');
    await backToVisit(screen);
  });

  test('an evidence question answers from PubMed with numbered sources', { tags: ['ai'] }, async ({ screen, agent }) => {
    await ask(screen, 'Should Amelia get steroids for community-acquired pneumonia?');
    await modelAnswered(screen);
    // Under the label: the numbered sources and where they came from.
    await expect(screen.getByText(/^PubMed/).first()).toBeVisible();
    await expect(screen.getByRole('button', /^Source 1, /).first()).toBeVisible();
    // The claims open the answer, under the question.
    await dragUntilVisible(screen, screen.getByText('You: Should Amelia get steroids for community-acquired pneumonia?'), { back: true, timeout: 30_000 });
    await agent.assert('the answer under the steroids question addresses corticosteroids for pneumonia, citing studies');
    await backToVisit(screen);
  });
});
