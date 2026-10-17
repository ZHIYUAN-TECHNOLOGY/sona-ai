import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Puts the e2e branch's demo hospital back to its seeded start before a run. The Worker and the reset read the same
// gitignored apps/server/.env; refuse when it points at staging (the 13 Oct demo database), never a branch.
const STAGING = 'ep-curly-recipe-b3hht5ep';
const url = readFileSync(new URL('../apps/server/.env', import.meta.url), 'utf8').match(/^DATABASE_URL=(.*)$/m)?.[1] ?? '';
if (!url || url.includes(STAGING)) throw new Error('apps/server/.env points at staging or nothing: the e2e suite only resets a Neon branch');
execFileSync('bun', ['run', 'db:reset-demo'], { cwd: new URL('../packages/db', import.meta.url), stdio: 'inherit' });
