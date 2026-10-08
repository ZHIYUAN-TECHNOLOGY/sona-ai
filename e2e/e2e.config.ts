import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { agents, SERVER } from './shared';

// Both web portals: Sona Pro at /pro and Sona Care at /care, served by the Worker from apps/web/dist.
export default {
  // The journey changes the demo patient's stay for good: it runs alone, from journey.config.ts.
  tests: ['tests/web/**/*.e2e.ts', '!tests/web/journeys/**'],
  output: '.e2e/web',
  agents,
  targets: [{
    name: 'web',
    engine: web({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Kuala_Lumpur', locale: 'en-MY' }),
    app: {
      url: SERVER,
      command: {
        executable: 'bun', args: ['x', 'alchemy', 'dev', '--no-input'], cwd: '../packages/infra',
        env: { SONA_DEV_PORT: '{port}' }, reuseExisting: true, startupTimeout: 180_000, log: '.e2e/logs/server.log',
      },
    },
  }],
} satisfies E2EConfig;
