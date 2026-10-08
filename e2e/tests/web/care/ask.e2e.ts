import { type Browser, describe, test } from '@e2e-dev/web';
import { expect, type Screen } from 'e2e';

import { type Plan, rpc, settled, type Visit } from './care';
import { LOG } from '../roles';

type Asked = { answer?: string; source?: string; model?: string; waking?: number };
const MODEL = { timeout: 120_000 };

/** Asks on the Ask page's own composer and returns what `care.ask` answered (the page labels only samples, so the source is read here). */
async function ask(screen: Screen, browser: Browser, question: string, send: () => Promise<void> = () => screen.getByRole('button', 'Send to Sona').tap()) {
  const answered = browser.waitForResponse('**/rpc/care/ask', MODEL);
  await screen.getByRole('textbox', 'Ask Sona').fill(question);
  await send();
  const res = await answered;
  expect(res.status).toBe(200);
  return (await res.json() as { json: Asked }).json;
}

/** The turn for one question in the Ask page's thread. */
const turn = (screen: Screen, question: string) =>
  screen.getByRole('region', "Sona's answers").getByRole('article').filter({ has: screen.getByRole('heading', question, { level: 2 }) });

/** A model's answer landed in the page: not a sample, not "can't answer", not "is starting". */
async function expectModelAnswer(screen: Screen, question: string, said: Asked) {
  expect(said.source).toBe('model');
  expect(said.waking).toBeUndefined();
  expect(said.answer?.trim().length).toBeGreaterThan(0);
  const t = turn(screen, question);
  await expect(t.getByText('Sona is thinking…')).toHaveCount(0, MODEL);
  await expect(t.getByText('Sample answer')).toHaveCount(0);
  await expect(t.getByRole('alert')).toHaveCount(0);
  await expect(t).not.toContainText("isn't switched on yet");
  await expect(t).toContainText(said.answer!.trim().split(/\s+/).slice(0, 6).join(' '));
  await expect(t.getByRole('button', 'Listen')).toBeVisible();
  await expect(t.getByRole('button', 'Tell me more')).toBeVisible();
  await expect(t.getByRole('button', 'Ask a follow-up')).toBeVisible();
  return t;
}

describe('Ask Sona Care', { tags: ['care'], session: 'patient' }, () => {
  test('the page offers questions that fit her day, and a two-letter minimum', { tags: ['deep'] }, async ({ app, screen, browser }) => {
    await app.open('/care/ask');
    await settled(screen);
    const [visits, plan] = await Promise.all([rpc<Visit[]>(browser, 'care/followUps', { lang: 'en' }), rpc<Plan>(browser, 'care/discharge', { lang: 'en' })]);
    const meds = plan.status === 'discharged' && Object.values(plan.medicines).some(g => g.length);
    const expected = [
      ...(visits.some(v => v.inDays === 0) ? ['What should I bring to my visit today?'] : []),
      ...(meds ? ['When is my next dose?'] : []),
      'When is my next visit?', 'What medicines do I take today?', 'What should I eat this week?', 'Is it normal to feel tired?',
    ].slice(0, 6);
    await expect(screen.getByRole('list', 'Suggested questions').getByRole('button')).toHaveText(expected);
    // The Ask page is its own chat: no docked Sona panel beside it.
    await expect(screen.getByRole('complementary', 'Sona')).toHaveCount(0);
    const box = screen.getByRole('textbox', 'Ask Sona');
    await box.fill('a');
    await expect(screen.getByRole('button', 'Send to Sona')).toBeDisabled();
    await box.fill('ok');
    await expect(screen.getByRole('button', 'Send to Sona')).toBeEnabled();
  });

  test('a typed question about her care gets a model answer in the page', { tags: ['models', 'smoke'], timeout: 180_000 }, async ({ app, screen, browser }) => {
    await app.open('/care/ask');
    await settled(screen);
    const question = 'When is my next clinic visit?';
    const said = await ask(screen, browser, question);
    const t = await expectModelAnswer(screen, question, said);
    // Her visit is in her record: the answer speaks to it.
    await expect(t).toContainText(/clinic|visit|appointment/i);
    await expect(screen.getByRole('textbox', 'Ask Sona')).toHaveValue('');
  });

  test('a question in Malay is answered in Malay by the model', { tags: ['models'], timeout: 180_000 }, async ({ app, screen, browser }) => {
    await app.open('/care/ask');
    await settled(screen);
    const question = 'Bilakah temujanji klinik saya yang seterusnya?';
    // Enter sends.
    const said = await ask(screen, browser, question, () => screen.getByRole('textbox', 'Ask Sona').press('Enter'));
    await expectModelAnswer(screen, question, said);
    expect(said.answer).toMatch(/\b(anda|awak|sila|untuk|dengan|klinik|temujanji|boleh|pada)\b/i);
    expect(said.answer).not.toMatch(/\b(the|your|please|appointment)\b/i);
  });

  test('a suggested question, then "Tell me more", each get a model answer', { tags: ['models', 'deep'], timeout: 240_000 }, async ({ app, screen, browser }) => {
    await app.open('/care/ask');
    await settled(screen);
    const question = 'What should I eat this week?';
    let answered = browser.waitForResponse('**/rpc/care/ask', MODEL);
    await screen.getByRole('list', 'Suggested questions').getByRole('button', question).tap();
    let res = await answered;
    const first = await expectModelAnswer(screen, question, (await res.json() as { json: Asked }).json);

    answered = browser.waitForResponse('**/rpc/care/ask', MODEL);
    await first.getByRole('button', 'Tell me more').tap();
    res = await answered;
    await expectModelAnswer(screen, `Tell me more about this: ${question}`, (await res.json() as { json: Asked }).json);
    // Both turns stay, in the order asked.
    await expect(screen.getByRole('region', "Sona's answers").getByRole('heading', { level: 2 })).toHaveText([question, `Tell me more about this: ${question}`]);
  });

  test('"Listen" reads an answer in Sona\'s own voice and stops on a second press', { tags: ['models', 'deep'], timeout: 240_000 }, async ({ app, screen, browser }) => {
    await app.open('/care/ask');
    await settled(screen);
    const question = 'What time is my clinic visit?';
    const t = await expectModelAnswer(screen, question, await ask(screen, browser, question));
    const spoken = browser.waitForResponse('**/rpc/care/speak', MODEL);
    await t.getByRole('button', 'Listen').tap();
    const stop = t.getByRole('button', 'Stop');
    await expect(stop).toHaveAttribute('aria-pressed', 'true');
    await stop.tap();
    const voice = (await (await spoken).json() as { json: { source: string; audio?: string } }).json;
    expect(voice.source).toBe('model');
    expect(voice.audio?.length).toBeGreaterThan(1000);
    await expect(t.getByRole('button', 'Listen')).toHaveAttribute('aria-pressed', 'false', MODEL);
  });

  test('"Talk to Sona" opens the call stage and says plainly when there is no microphone', { tags: ['deep'] }, async ({ app, screen }) => {
    await app.open('/care/ask');
    await settled(screen);
    await screen.getByRole('button', 'Talk to Sona').tap();
    const stage = screen.getByRole('region', 'Voice call with Sona');
    await expect(stage).toBeVisible();
    // Headless Chromium has no microphone: the call never starts, and the stage says what to do.
    await expect(stage.getByRole('alert')).toHaveText('Microphone blocked. Allow it in your browser, then try again.', { timeout: 15_000 });
    await expect(stage).toContainText('Nothing is being recorded.');
    await expect(stage.getByRole('button', 'Try again')).toBeVisible();
    await stage.getByRole('button', 'Close').tap();
    await expect(stage).toHaveCount(0);
    await expect(screen.getByRole('button', 'Talk to Sona')).toBeVisible();
  });

  test('the composer\'s mic says plainly when there is no microphone, and typing still works', { tags: ['deep'] }, async ({ app, screen }) => {
    await app.open('/care/ask');
    await settled(screen);
    const mic = screen.getByRole('button', 'Speak to Sona');
    await mic.tap();
    await expect(screen.getByText(/^(No microphone was found\. Type instead\.|The microphone is blocked\. Allow it in your browser's site settings, or type instead\.)$/)).toBeVisible({ timeout: 15_000 });
    await expect(screen.getByRole('button', 'Speak to Sona')).toHaveAttribute('aria-pressed', 'false');
    await screen.getByRole('textbox', 'Ask Sona').fill('Hello Sona');
    await expect(screen.getByText(/Type instead\.|type instead\./)).toHaveCount(0);
    await expect(screen.getByRole('button', 'Send to Sona')).toBeEnabled();
  });

  test('the Sona panel beside Home answers from the model too', { tags: ['models', 'deep'], timeout: 180_000 }, async ({ app, screen, browser }) => {
    await app.open('/care/home');
    await settled(screen);
    const panel = screen.getByRole('complementary', 'Sona');
    await expect(panel.getByText('Home', { exact: true })).toBeVisible();
    const question = 'Which clinic is my next visit at?';
    const answered = browser.waitForResponse('**/rpc/care/ask', MODEL);
    await panel.getByRole('textbox', 'Ask Sona').fill(question);
    await panel.getByRole('button', 'Send to Sona').tap();
    const said = (await (await answered).json() as { json: Asked }).json;
    expect(said.source).toBe('model');
    const log = panel.getByRole(LOG, "Sona's answers");
    const t = log.getByRole('article').filter({ has: screen.getByRole('heading', `You asked: ${question}`) });
    await expect(t).toContainText(said.answer!.trim().split(/\s+/).slice(0, 6).join(' '), MODEL);
    await expect(t.getByRole('alert')).toHaveCount(0);
  });
});

// Judgments of meaning on live model answers: an agent reads the page once each answer has landed.
describe('Ask Sona Care, judged', { tags: ['care', 'models', 'ai'], session: 'patient' }, () => {
  test('an English answer speaks to her question about her next visit', { timeout: 240_000 }, async ({ app, screen, browser, agent }) => {
    await app.open('/care/ask');
    await settled(screen);
    const question = 'When is my next clinic visit?';
    await expectModelAnswer(screen, question, await ask(screen, browser, question));
    await expect(turn(screen, question).getByRole('button', 'Listen')).toBeVisible();
    await agent.assert(`Under the question "${question}", Sona's answer is in English and tells the patient about her next clinic visit or appointment (a date, a time, a place or a doctor). It is not an error message, a placeholder or a refusal.`);
  });

  test('a Malay question about her medicines is answered in Malay, about her medicines', { timeout: 240_000 }, async ({ app, screen, browser, agent }) => {
    await app.open('/care/ask');
    await settled(screen);
    const question = 'Apakah ubat yang saya ambil sekarang?';
    await expectModelAnswer(screen, question, await ask(screen, browser, question));
    await expect(turn(screen, question).getByRole('button', 'Listen')).toBeVisible();
    await agent.assert(`Under the question "${question}", Sona's answer is written in Malay (Bahasa Melayu), not English, and addresses the patient's question about her medicines. It is not an error message or a placeholder.`);
  });
});
