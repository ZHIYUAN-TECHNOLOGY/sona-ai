import { describe, test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { signedIn, tab, TAGS } from './care';

const doctor = (name: string, rest: string) => new RegExp(`^${name.replace(/\./g, '\\.')}, ${rest}`);
const AISYAH = doctor('Dr. Aisyah Rahman', 'Cardiology, rated 4\\.9 of 5, next clinic ');
const ARJUN = doctor('Dr. Arjun Menon', 'Rehabilitation, rated 4\\.7 of 5, next clinic ');
const FARAH = doctor('Dr. Farah Idris', 'Family medicine, rated 4\\.5 of 5, next clinic ');
const LIM = doctor('Dr. Lim Wei Jie', 'Respiratory, rated 4\\.8 of 5, in your care team, next clinic ');
const PRIYA = doctor('Dr. Priya Nair', 'General medicine, rated 4\\.7 of 5, in your care team, next clinic ');
const TAN = doctor('Dr. Tan Mei Ling', 'Endocrinology, rated 4\\.6 of 5, next clinic ');

// "Friday 9 October" as the Schedule's capsule writes it: "Fri 9 Oct".
const shortDay = (long: string) => { const [weekday, date, month] = long.split(' '); return `${weekday!.slice(0, 3)} ${date} ${month!.slice(0, 3)}`; };

// One launch: the hospital's directory (seeded synthetic doctors), its search and filters, a doctor's page, and a real
// booking request (care.bookings.request) that the Schedule then shows as requested.
describe('Find a doctor and request a visit', { tags: [...TAGS, 'deep'], serial: true }, () => {
  test('Find a doctor lists the whole directory', async f => {
    const { screen } = f;
    await signedIn(f);
    await tab(screen, 'Doctors').tap();
    await screen.getByRole('button', 'Find a doctor').tap();
    await expect(screen.getByLabel('Find a. doctor')).toBeVisible();
    for (const d of [AISYAH, ARJUN, FARAH, LIM, PRIYA, TAN]) await expect(screen.getByRole('button', d)).toBeVisible();
    // The chosen filter chip also draws its word as text, so the label matches the chip and the word: take the chip.
    await expect(screen.getByLabel('All').first()).toBeVisible();
  });

  test('search finds by specialty, and says when nothing matches', async ({ screen }) => {
    const search = screen.getByPlaceholder('Name or specialty');
    await search.fill('cardio');
    await expect(screen.getByRole('button', AISYAH)).toBeVisible();
    await expect(screen.getByRole('button', LIM)).toBeHidden();
    await search.fill('zzqx');
    await expect(screen.getByText('No doctor matches “zzqx”.')).toBeVisible();
    await search.clear();
    // Return puts the keyboard down so the filters and cards below are reachable.
    await search.press('Enter');
    await expect(screen.getByRole('button', TAN)).toBeVisible();
  });

  test('Care team narrows to her two doctors; Top rated puts the best first', async ({ screen }) => {
    await screen.getByLabel('Care team', { exact: true }).tap();
    await expect(screen.getByRole('button', LIM)).toBeVisible();
    await expect(screen.getByRole('button', PRIYA)).toBeVisible();
    await expect(screen.getByRole('button', AISYAH)).toBeHidden();
    await screen.getByLabel('Top rated', { exact: true }).tap();
    await expect(screen.getByRole('button', /^Dr\. /).first()).toHaveAccessibleName(AISYAH);
    await expect(screen.getByRole('button', /^Dr\. /)).toHaveCount(6);
  });

  test("a doctor's page shows rating, experience, clinic, languages and free times", async ({ screen }) => {
    await screen.getByRole('button', PRIYA).tap();
    await expect(screen.getByLabel(/^Dr\. Priya Nair\. General medicine\. In your care team\. Next clinic /)).toBeVisible();
    await expect(screen.getByLabel('Rated 4.7 of 5 from 188 reviews')).toBeVisible();
    await expect(screen.getByLabel('9 years of practice')).toBeVisible();
    await expect(screen.getByLabel('Clinic: Medical Clinic, Level 1')).toBeVisible();
    await expect(screen.getByLabel('Speaks English, Malay and Tamil')).toBeVisible();
    await expect(screen.getByText('Clinic days')).toBeVisible();
    await expect(screen.getByText('Pick a time, then send a request.')).toBeVisible();
    await expect(screen.getByRole('button', 'Request appointment')).toBeDisabled();
    await expect(screen.getByRole('button', 'Message care team')).toBeVisible();
  });

  test('a picked time is reviewed, requested, and shows on the Schedule as requested', async ({ screen }) => {
    // The free times sit under the page's fixed Request bar until the page is scrolled up.
    await screen.swipe({ direction: 'down' });
    const slot = screen.getByRole('button', /^\d{1,2}:\d{2} [AP]M, [A-Z][a-z]+day \d{1,2} [A-Z][a-z]+$/).first();
    const [time, day] = (await slot.textContent() ?? '').split(', ') as [string, string];
    await slot.tap();
    await expect(screen.getByText('Pick a time, then send a request.')).toBeHidden();
    await screen.getByRole('button', 'Request appointment').tap();
    await expect(screen.getByLabel('Request this visit')).toBeVisible();
    await expect(screen.getByLabel(`Dr. Priya Nair, General medicine. ${day} at ${time}. Medical Clinic, Level 1`)).toBeVisible();
    await expect(screen.getByText(/^This asks your care team for this time\./)).toBeVisible();
    await screen.getByRole('textbox', 'Reason for the visit, optional').fill(`E2E ${Date.now()} still coughing`);
    await screen.getByRole('button', 'Send request').tap();
    await expect(screen.getByLabel(/^Request sent\b/)).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByLabel(`Requested: Dr. Priya Nair, ${day} at ${time}`)).toBeVisible();
    await screen.getByRole('button', 'See my schedule').tap();
    const requested = screen.getByLabel(`${shortDay(day)} · ${time}. Dr. Priya Nair, General medicine. Requested · waiting for the care team.`);
    await screen.scrollUntilVisible(requested);
    await expect(requested).toBeVisible();
  });
});
