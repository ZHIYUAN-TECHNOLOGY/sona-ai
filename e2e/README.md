# Sona end-to-end tests

Agentic end-to-end tests ([e2e](https://e2e.tester.army/docs)) for all four surfaces, on the real models and a
throwaway database. The e2e skill for coding agents is in `.agents/skills/e2e` (`npx e2e guide`).

| Surface | Tests | Config | Run |
| --- | --- | --- | --- |
| Sona Pro web (`/pro`) | `tests/web/pro` | `e2e.config.ts` | `bun run test:web` |
| Sona Care web (`/care`) | `tests/web/care` | `e2e.config.ts` | `bun run test:web` |
| Sona Pro iOS (judge build) | `tests/ios-pro` | `pro.config.ts` | `bun run test:pro` |
| Sona Care iOS | `tests/ios-care` | `care.config.ts` | `bun run test:care` |
| Across both apps and the insurer | `tests/web/journeys` | `journey.config.ts` | `bun run test:journey` |

Each script resets the demo hospital first (`bun run reset`): it re-times today's seeded visits to 15 and 45 minutes
ahead, so clock-dependent pages read the same on every run. `bun run test:e2e` runs them all in that order; the journey
discharges the demo patient, so it runs last and alone.

## Before a run

1. **Database: a Neon branch, never staging.** Branch `sona-ai-staging` (project `plain-waterfall-81595993`), migrate
   and seed it, and put its URL in the gitignored `apps/server/.env` (`BETTER_AUTH_URL=http://localhost:3002`).
   `bun run reset` refuses to run when that file points at staging.
2. **Worker:** `bun run server` (port 3002, serves `apps/web/dist` at `/pro` and `/care`). The web config attaches to it,
   or starts it.
3. **Simulators:** two iPhone 17 Pro simulators on iOS 27 named `Sona e2e Pro` and `Sona e2e Care`, each with Expo Go
   installed. The iOS configs start Metro themselves (8093 for Pro in the judge build, 8094 for Care, production
   bundles: a dev bundle crashes Expo Go) or attach to one already running. Once per simulator, open the app, tap
   Expo Go's floating gear and switch off **Tools button**: the button sits over the apps' top-right controls.
4. **Agent steps:** `agent.*` calls use Claude through `E2E_ANTHROPIC_API_KEY` in the gitignored `e2e/.env`. Tests
   without agent steps need no key.
5. **Models:** answers come from the SageMaker boxes in Malaysia when they are up (`aws sagemaker list-endpoints`);
   with none up, model routes answer as labelled samples and the `models` tests fail by design.

The iOS engine keeps its own agent-device state in `~/.agent-device-e2e`, apart from any global agent-device daemon.

## Useful runs

- `npx e2e run tests/web/pro/<file>.e2e.ts --headed` watches one web file.
- `npx e2e run --tag smoke` (any config) for the fast checks; `--tag models` for the model-backed ones.
- Failures: `.e2e/<surface>/report.json`, and `failure/screen.txt` under `.e2e/<surface>/artifacts/` shows the
  accessibility tree with the exact names to use in a locator.
