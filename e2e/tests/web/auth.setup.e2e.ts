import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

// Seeded synthetic demo logins (packages/db/src/seed.ts). The password is the public demo one the sign-in page prints,
// not a secret, and filling it as plain text keeps screenshots and vision available to later tests.
const DEMO_PASSWORD = '123';
const clinicians = ['doctor', 'nurse', 'beds', 'manager'] as const;

for (const role of clinicians) {
  test.setup(`sign in to Sona Pro as ${role}`, { sessions: [role] }, async ({ app, screen, session, browser }) => {
    await app.open('/pro/sign-in');
    await screen.getByLabel('Username or email').fill(role);
    await screen.getByLabel('Password').fill(DEMO_PASSWORD);
    await screen.getByRole('button', 'Sign in').tap();
    // A bed manager's home is the ward; everyone else lands on Today.
    await expect(browser).toHaveURL(role === 'beds' ? '/pro/ward' : '/pro/today', { timeout: 20_000 });
    await session.save(role);
  });
}

test.setup('sign in to Sona Care as the demo patient', { sessions: ['patient'] }, async ({ app, screen, session, browser }) => {
  await app.open('/care/sign-in');
  await screen.getByRole('button', /^Demo number/).tap();
  await screen.getByRole('button', 'Send code').tap();
  await screen.getByRole('button', /^Demo code/).tap();
  await screen.getByRole('button', 'Sign in').tap();
  await expect(browser).toHaveURL(/\/care\/(home|join)/, { timeout: 20_000 });
  await session.save('patient');
});
