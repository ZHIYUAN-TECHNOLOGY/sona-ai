import web from './e2e.config';

// Cross-app journeys on the web portals, run alone on a freshly reset branch: `bun run test:journey`.
export default { ...web, tests: 'tests/web/journeys/**/*.e2e.ts', output: '.e2e/journey', workers: 1 };
