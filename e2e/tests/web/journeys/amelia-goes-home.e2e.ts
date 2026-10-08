import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

/**
 * The demo's spine, across both portals and the insurer, on the real models: the doctor clears Amelia's final
 * guarantee letter, the insurer approves it, the doctor approves her discharge with Sona's Malay summary, her
 * plan reaches Sona Care, and an urgent message from home reaches the doctor and is answered.
 *
 * It changes her stay for good, so it runs on a freshly reset branch (`bun run reset`) and alone: run it after the
 * other web tests (`bun run test:journey`).
 */
const VISIT = 'visit-1042';
const MODEL = 120_000;

type Screen = import('e2e').Screen;
type Browser = import('@e2e-dev/web').Browser;

async function signInPro(screen: Screen, browser: Browser, role: string) {
  await browser.goto('/pro/sign-in');
  await screen.getByLabel('Username or email').fill(role);
  await screen.getByLabel('Password').fill('123'); // the public demo password the page prints
  await screen.getByRole('button', 'Sign in').tap();
  await expect(browser).toHaveURL('/pro/today', { timeout: 20_000 });
}

async function signInCare(screen: Screen, browser: Browser) {
  await browser.goto('/care/sign-in');
  await screen.getByRole('button', /^Demo number/).tap();
  await screen.getByRole('button', 'Send code').tap();
  await screen.getByRole('button', /^Demo code/).tap();
  await screen.getByRole('button', 'Sign in').tap();
  await expect(browser).toHaveURL(/\/care\/home/, { timeout: 20_000 });
}

describe('Amelia goes home', { serial: true, tags: ['journey', 'models'] }, () => {
  const urgent = `E2E ${Date.now()}: since this morning I have chest pain and I am short of breath`;
  let replied = '';

  test('the doctor answers the insurer checklist and sends the guarantee letter', { timeout: 300_000 }, async ({ app, screen, browser }) => {
    await app.open('/pro/sign-in');
    await signInPro(screen, browser, 'doctor');
    await browser.goto(`/pro/guarantee-letter?encounterId=${VISIT}`);
    await expect(screen.getByText('Not sent yet. Check the codes, then send the letter to the insurer.').first()).toBeVisible({ timeout: 20_000 });
    // Codes come from the model, each citing the note.
    await expect(screen.getByText('Drafted by Sona').first()).toBeVisible({ timeout: MODEL });
    await expect(screen.getByRole('cell', 'J18.9')).toBeVisible();

    await screen.getByRole('button', 'Add “Organism not identified.”').tap();
    await screen.getByLabel('Why oral was not used first').fill('Vomiting on admission, could not keep oral antibiotics down.');
    await screen.getByRole('button', 'Add to note').tap();
    await screen.getByRole('button', 'Accept codes and send').tap();
    // The lead shows in the page header and again in the rail.
    await expect(screen.getByText('Sent. The insurer has not decided yet.').first()).toBeVisible({ timeout: MODEL });
  });

  test('the insurer approves the letter on its review page', { timeout: 120_000 }, async ({ screen, browser }) => {
    // The page opens the insurer's link in a new tab; read the same link the page has and go there.
    const link = await browser.evaluate((encounterId: string) => fetch('/rpc/claim/status', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ json: { encounterId } }),
    }).then(r => r.json()).then(r => r.json.reviewUrl as string), VISIT);
    expect(link).toMatch(/\/insurer\//);
    await browser.goto(link);
    await expect(screen.getByRole('heading', 'Amelia Tan')).toBeVisible();
    await screen.getByRole('button', 'Approve guarantee letter').tap();
    await expect(screen.getByText(/^Approved/)).toBeVisible({ timeout: 20_000 });

    await browser.goto(`/pro/guarantee-letter?encounterId=${VISIT}`);
    await expect(screen.getByText(/^Approved on .*Nothing left to do\.$/).first()).toBeVisible({ timeout: 20_000 });
  });

  test('the doctor confirms medicines and follow-up, reviews the Malay summary and approves discharge', { timeout: 300_000 }, async ({ screen, browser }) => {
    await browser.goto(`/pro/discharge?encounterId=${VISIT}`);
    await expect(screen.getByRole('heading', 'Discharge plan')).toBeVisible({ timeout: 20_000 });
    await expect(screen.getByText('Synthetic insurer · requested', { exact: false })).toBeVisible();
    await expect(screen.getByRole('button', 'Approve discharge')).toBeDisabled();

    await screen.getByRole('button', 'Confirm medicines').tap();
    await expect(screen.getByRole('button', 'Medicines confirmed')).toBeDisabled({ timeout: 20_000 });
    await screen.getByRole('group', 'Clinic review in').getByRole('button', '2 wk').tap();
    await expect(screen.getByRole('group', 'Clinic review in').getByRole('button', '2 wk', { pressed: true })).toBeVisible({ timeout: 20_000 });

    // Sona's draft in the saved leaflet language (Bahasa Melayu), from the model, keeping her medicines.
    await expect(screen.getByLabel('Leaflet language')).toHaveValue('ms');
    await expect(screen.getByText('Drafted by Sona')).toBeVisible({ timeout: MODEL });
    await expect(screen.getByLabel('Discharge summary draft')).toHaveValue(/Azithromycin/i);

    await expect(screen.getByText('Nothing is holding', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    await screen.getByRole('button', 'Approve discharge').tap();
    await expect(screen.getByRole('button', 'Discharge approved')).toBeVisible({ timeout: 30_000 });
  });

  test('her plan is on Sona Care: medicines, the clinic review and the warning signs', { timeout: 180_000 }, async ({ app, screen, browser }) => {
    await app.clearState();
    await signInCare(screen, browser);
    await browser.goto('/care/discharge-plan');
    // The stat card and the section share the title; the section is the h2.
    await expect(screen.getByRole('heading', 'Medicines to take', { level: 2 })).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('heading', 'Next follow-up')).toBeVisible();
    await expect(screen.getByText('Azithromycin', { exact: false }).first()).toBeVisible();
    await expect(screen.getByText('Paracetamol', { exact: false }).first()).toBeVisible();
    await expect(screen.getByRole('heading', 'Follow-up')).toBeVisible();
    await expect(screen.getByRole('heading', 'Sona will check on you')).toBeVisible();
    await expect(screen.getByRole('heading', 'Call the hospital now if…')).toBeVisible();
  });

  test('an urgent message from home gets the 999 guidance and reaches the doctor first', { timeout: 300_000 }, async ({ app, screen, browser }) => {
    await browser.goto('/care/messages');
    await screen.getByLabel('Write a message').fill(urgent);
    await screen.getByRole('button', 'Send').tap();
    const thread = screen.getByLabel('Messages with your care team');
    await expect(thread.getByText(urgent)).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('link', 'Call 999')).toBeVisible({ timeout: MODEL });

    await app.clearState();
    await signInPro(screen, browser, 'doctor');
    await browser.goto('/pro/messages?patient=SYN-1042');
    const reply = screen.getByRole('complementary', 'Reply');
    await expect(screen.getByRole('region', 'Messages with Amelia Tan').getByText(urgent)).toBeVisible({ timeout: 30_000 });
    // Triage and the draft come from the model, and the draft waits for the doctor.
    await expect(reply.getByText('Drafted by Sona Med')).toBeVisible({ timeout: MODEL });
    await expect(reply.getByText(/Triage: urgent/)).toBeVisible();
    await expect(reply.getByLabel('Check before sending')).not.toHaveValue('');
    // What the doctor sends is exactly what she should read.
    replied = (await reply.getByLabel('Check before sending').inputValue()).trim();
    await reply.getByRole('button', 'Send reply').tap();
    await expect(reply.getByText('Nothing is waiting here. You can still write.')).toBeVisible({ timeout: 30_000 });
  });

  test('the doctor reply reaches her on Sona Care', { timeout: 120_000 }, async ({ app, screen, browser }) => {
    await app.clearState();
    await signInCare(screen, browser);
    await browser.goto('/care/messages');
    const thread = screen.getByLabel('Messages with your care team');
    await expect(thread.getByText(urgent)).toBeVisible({ timeout: 30_000 });
    const answer = thread.getByRole('listitem').filter({ hasText: 'Care team ·' }).last();
    await expect(answer).toContainText(replied.split(/\s+/).slice(0, 8).join(' '), { timeout: 30_000 });
  });
});
