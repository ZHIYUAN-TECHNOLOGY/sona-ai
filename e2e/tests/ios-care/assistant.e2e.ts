import { describe, test } from '@e2e-dev/mobile';
import { expect, type Screen } from 'e2e';
import { shown, signedIn, TAGS } from './care';

// Where a model answer came from (care.ask with source "model"): her record, a hospital leaflet, or general knowledge.
// A stand-in instead says it can't answer yet, or that Sona Care is starting up.
const PROVENANCE = /^(From your record|From the hospital's leaflet · |General answer · not from your records$)/;
const SAMPLE = [/^I can't answer that yet\. Send it to your care team\?$/, /^Sona Care is starting up/];
const MODEL_WAIT = 120_000;

const ask = async (screen: Screen, question: string) => {
  await screen.getByRole('textbox', /^Ask Sona anything/).fill(question);
  await screen.getByRole('button', 'Send').tap();
  await expect(screen.getByText(question)).toBeVisible();
};
/** The answer settled (the working line gone), with its provenance and no stand-in. */
const modelAnswered = async (screen: Screen) => {
  await expect(screen.getByLabel('Reading your plan…')).toBeHidden({ timeout: MODEL_WAIT });
  await expect(screen.getByLabel(PROVENANCE).last()).toBeVisible();
  for (const sample of SAMPLE) await expect(screen.getByText(sample)).toBeHidden();
};

// One launch: Ask Sona Care with the live models (Gemma via care.ask), in English and Malay, a warning sign and a
// doctor question. Each answer must be the model's, never a sample.
describe('Ask Sona Care', { tags: [...TAGS, 'models'], serial: true }, () => {
  test('opens from the orb with its composer and voice entry points', async f => {
    const { screen } = f;
    await signedIn(f);
    await screen.getByRole('button', 'Ask Sona Care').tap();
    await expect(screen.getByLabel('Ask Sona Care. Ask anything about your health and recovery')).toBeVisible();
    await expect(screen.getByRole('textbox', /^Ask Sona anything/)).toBeVisible();
    await expect(screen.getByRole('button', 'Speak your question')).toBeVisible();
    await expect(screen.getByRole('button', 'Voice mode')).toBeVisible();
    await expect(screen.getByText('Not for emergencies · call 999')).toBeVisible();
  });

  test('an English question gets a model answer, with where it came from and next steps', { tags: ['ai'] }, async ({ screen, agent }) => {
    await ask(screen, 'How much water should I drink each day while I recover from my chest infection?');
    await modelAnswered(screen);
    await expect(screen.getByRole('button', 'Ask my care team').last()).toBeVisible();
    await expect(screen.getByRole('button', 'Helpful').last()).toBeVisible();
    await expect(screen.getByRole('button', 'Not helpful').last()).toBeVisible();
    await agent.assert("Sona's answer below the question about drinking water is in English and gives hydration advice for recovering, not a refusal or a placeholder.");
  });

  test('marking an answer helpful says thanks in place', async ({ screen }) => {
    await screen.getByRole('button', 'Helpful').last().tap();
    await expect(screen.getByRole('button', 'Helpful', { selected: true }).last()).toBeVisible();
  });

  test('a Malay question gets a model answer in Malay', { tags: ['ai'] }, async ({ screen, agent }) => {
    await ask(screen, 'Bilakah temujanji klinik saya yang seterusnya?');
    await modelAnswered(screen);
    // Malay words the question itself does not use: the reply is in her language, not English.
    await expect(screen.getByText(/\b(anda|ialah|adalah|sila|pada)\b/i).last()).toBeVisible();
    await agent.assert("The latest answer from Sona, under the Malay question 'Bilakah temujanji klinik saya yang seterusnya?', is written in Malay and is about the patient's next clinic appointment.");
  });

  test('a warning sign puts Call 999 first, and the care team is told', async ({ screen }) => {
    await ask(screen, `E2E ${Date.now()} I have chest pain and I feel short of breath`);
    await expect(screen.getByRole('button', /^Call 999 now/).last()).toBeVisible({ timeout: 10_000 });
    await expect(screen.getByText("This can't wait for a reply from your care team.").last()).toBeVisible();
    // The question still reaches the server, which makes the care team's task; Sona's line then says so.
    await expect(screen.getByText("I've let your care team know.").last()).toBeVisible({ timeout: MODEL_WAIT });
  });

  test('a doctor question searches the hospital directory', async ({ screen }) => {
    await ask(screen, 'Can you find me a good heart doctor?');
    await expect(screen.getByLabel('Searching for a doctor…')).toBeHidden({ timeout: MODEL_WAIT });
    await expect(screen.getByText(/^Here (is a doctor|are doctors) who may help\b/).last()).toBeVisible();
    // The overline is drawn in capitals.
    await expect(screen.getByText(/^doctors who may help$/i).last()).toBeVisible();
    await expect(screen.getByRole('button', /^Dr\. Aisyah Rahman, Cardiology\. Rated 4\.9\. /).last()).toBeVisible();
  });

  // The live voice call and the microphone cannot be judged on a simulator: only the way in and its states.
  test('Voice mode opens on its voice picker or its mic, and Type a question returns to the chat', async ({ screen }) => {
    await screen.getByRole('button', 'Voice mode').tap();
    // The first time on a phone, Sona's voice is picked before anything is read aloud.
    if (await shown(screen.getByText("Choose Sona's voice"), 5_000)) await screen.getByRole('button', 'Start').tap();
    await expect(screen.getByRole('button', /^(Talk to Sona|Stop)$/)).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('button', 'Back to the chat')).toBeVisible();
    await screen.getByRole('button', 'Type a question').tap();
    await expect(screen.getByRole('textbox', /^Ask Sona anything/)).toBeVisible();
    await expect(screen.getByRole('button', 'Back to the chat')).toBeHidden();
  });
});

test('New chat asks first, then starts over', { tags: [...TAGS, 'deep'] }, async f => {
  const { screen } = f;
  await signedIn(f);
  await screen.getByRole('button', 'Ask Sona Care').tap();
  // Any turn will do, and a doctor question is answered from the hospital directory with no model call, so a slow or
  // busy model (the serial group above judges those) cannot fail what this test is about.
  await ask(screen, 'Which doctor should I see for my lungs?');
  await expect(screen.getByLabel('Searching for a doctor…')).toBeHidden({ timeout: MODEL_WAIT });
  await expect(screen.getByText(/^doctors who may help$/i)).toBeVisible();
  await screen.getByRole('button', 'New chat').tap();
  await expect(screen.getByText('Start a new chat?')).toBeVisible();
  // Two "New chat" buttons now: the screen's, top right, and the alert's, under the alert's line. Their order in the
  // tree depends on how iOS is read (the alert comes first when agent-device falls back to XCTest), so pick by place.
  const line = await screen.getByText('Questions you saved for your visit stay saved.').boundingBox();
  const inAlert = [];
  for (const button of await screen.getByRole('button', 'New chat').all()) if (((await button.boundingBox())?.y ?? 0) > (line?.y ?? Infinity)) inAlert.push(button);
  expect(inAlert).toHaveLength(1);
  await inAlert[0]!.tap();
  await expect(screen.getByLabel('Ask Sona Care. Ask anything about your health and recovery')).toBeVisible();
  await expect(screen.getByText('Which doctor should I see for my lungs?')).toBeHidden();
  await expect(screen.getByText(/^doctors who may help$/i)).toBeHidden();
});
