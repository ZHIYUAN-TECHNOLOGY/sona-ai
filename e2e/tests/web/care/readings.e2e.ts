import { describe, test } from '@e2e-dev/web';
import { expect, type Screen } from 'e2e';

import { chartTextMisses, rpc, settled } from './care';

type Readings = { series: { kind: string; points: { id: string; at: string; value: number; value2?: number }[] }[] };
const pointsOf = async (browser: Parameters<typeof rpc>[0], kind: string) =>
  (await rpc<Readings>(browser, 'care/readings/list', { days: 90 })).series.find(s => s.kind === kind)?.points ?? [];

const form = (screen: Screen) => screen.getByRole('form', 'Add a reading');
const pick = (screen: Screen, kind: string) => form(screen).getByRole('group', 'What did you measure?').getByRole('button', kind).tap();

describe('Sona Care readings', { tags: ['care', 'deep'], session: 'patient' }, () => {
  test('a weight she adds is saved, listed with today\'s time, and stored', { tags: ['smoke'] }, async ({ app, screen, browser }) => {
    await app.open('/care/readings');
    await settled(screen);
    // A value this run is unlikely to share with another writer's reading.
    const kg = (60 + Math.floor(Math.random() * 400) / 10).toFixed(1).replace(/\.0$/, '');
    await pick(screen, 'Weight');
    await expect(form(screen).getByRole('button', 'Weight')).toHaveAttribute('aria-pressed', 'true');
    await expect(form(screen).getByLabel('Lower number (mmHg)')).toHaveCount(0);
    await form(screen).getByLabel('Weight (kg)').fill(kg);
    await form(screen).getByRole('button', 'Save reading').tap();
    await expect(form(screen).getByRole('status')).toHaveText(`Saved. Weight ${kg} kg.`, { timeout: 15_000 });
    await expect(form(screen).getByLabel('Weight (kg)')).toHaveValue('');

    const recent = screen.getByRole('listitem').filter({ hasText: `Weight ${kg} kg` }).first();
    await expect(recent).toBeVisible();
    await expect(recent).toContainText(/^today \d{1,2}:\d{2}/);
    expect((await pointsOf(browser, 'weight')).some(p => String(p.value) === kg)).toBe(true);
  });

  test('a blood pressure takes both numbers and reads as upper over lower', async ({ app, screen, browser }) => {
    await app.open('/care/readings');
    await settled(screen);
    const upper = 110 + Math.floor(Math.random() * 40), lower = 70 + Math.floor(Math.random() * 15);
    await pick(screen, 'Blood pressure');
    await form(screen).getByLabel('Upper number (mmHg)').fill(String(upper));
    await form(screen).getByLabel('Lower number (mmHg)').fill(String(lower));
    await form(screen).getByRole('button', 'Save reading').tap();
    await expect(form(screen).getByRole('status')).toHaveText(`Saved. Blood pressure ${upper}/${lower} mmHg.`, { timeout: 15_000 });
    await expect(screen.getByRole('listitem').filter({ hasText: `Blood pressure ${upper}/${lower} mmHg` }).first()).toBeVisible();
    expect((await pointsOf(browser, 'blood_pressure')).some(p => p.value === upper && p.value2 === lower)).toBe(true);
    // Blood pressure leads the chart (the server's order).
    await expect(screen.getByRole('heading', 'Blood pressure over time')).toBeVisible();
  });

  test('the chart\'s numbers and days are as readable as the page (15 px or larger)', async ({ app, screen, browser }) => {
    await app.open('/care/readings');
    await settled(screen);
    const series = (await rpc<Readings>(browser, 'care/readings/list', { days: 7 })).series;
    test.skip(!series.some(s => s.points.length > 1), 'Fewer than two readings this week, so no chart is drawn');
    await expect(screen.getByRole('img', /, last 7 days$/).first()).toBeVisible();
    expect(await chartTextMisses(browser)).toEqual([]);
  });

  const refused = [
    { name: 'words instead of a number', kind: 'Heart rate', fields: { 'Heart rate (bpm)': 'seventy' }, says: 'Type the number from your device.' },
    { name: 'zero', kind: 'Heart rate', fields: { 'Heart rate (bpm)': '0' }, says: "That number doesn't look right. Check your device and type it again." },
    { name: 'a heart rate no one has', kind: 'Heart rate', fields: { 'Heart rate (bpm)': '999' }, says: "Heart rate of 999 bpm doesn't look right. Please check the number and try again.", stored: { kind: 'heart_rate', value: 999 } },
    { name: 'a blood pressure written lower first', kind: 'Blood pressure', fields: { 'Upper number (mmHg)': '75', 'Lower number (mmHg)': '125' }, says: 'Blood pressure needs two numbers, the upper one first, like 120 over 80. Please check and try again.', stored: { kind: 'blood_pressure', value: 75 } },
    { name: 'a blood pressure with one number', kind: 'Blood pressure', fields: { 'Upper number (mmHg)': '120' }, says: 'Type both numbers, the upper one first, like 120 and 80.' },
  ];
  for (const r of refused) {
    test(`${r.name} is refused in plain words and not saved`, async ({ app, screen, browser }) => {
      await app.open('/care/readings');
      await settled(screen);
      await pick(screen, r.kind);
      for (const [label, value] of Object.entries(r.fields)) await form(screen).getByLabel(label).fill(value);
      await form(screen).getByRole('button', 'Save reading').tap();
      await expect(form(screen).getByRole('alert')).toHaveText(r.says, { timeout: 15_000 });
      const first = form(screen).getByLabel(Object.keys(r.fields)[0]!);
      await expect(first).toHaveAttribute('aria-invalid', 'true');
      // What she typed stays, to correct.
      await expect(first).toHaveValue(Object.values(r.fields)[0]!);
      await expect(form(screen).getByRole('status')).toHaveText('');
      if (r.stored) expect((await pointsOf(browser, r.stored.kind)).some(p => p.value === r.stored!.value)).toBe(false);
    });
  }
});
