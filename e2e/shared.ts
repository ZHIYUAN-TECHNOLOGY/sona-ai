// e2e/.env (gitignored) holds E2E_ANTHROPIC_API_KEY. A distinct name, so a shell's own ANTHROPIC_* never bills the suite.
try { process.loadEnvFile(new URL('.env', import.meta.url)); } catch {}
// @ai-sdk/anthropic builds a default client on import and throws on an empty ANTHROPIC_BASE_URL (agent shells set one).
if (!process.env.ANTHROPIC_BASE_URL) delete process.env.ANTHROPIC_BASE_URL;
const { createAnthropic } = await import('@ai-sdk/anthropic');

const anthropic = createAnthropic({ apiKey: process.env.E2E_ANTHROPIC_API_KEY, baseURL: 'https://api.anthropic.com/v1' });

/** The local Worker on the e2e Neon branch (`bun run server`); it also serves the built web app at /pro and /care. */
export const SERVER = process.env.SONA_E2E_SERVER ?? 'http://localhost:3002';

export const agents = {
  default: {
    model: anthropic('claude-sonnet-5-5'),
    system: 'You are a thorough QA agent for a hospital app. Verify every outcome on screen. Never invent patient data.',
    context: [
      'Sona is a hospital assistant. Sona Pro is the clinician app (web /pro, iOS app), Sona Care the patient app (web /care, iOS app).',
      'All data is synthetic. The demo patient is Amelia Tan, record SYN-1042, Bed 6. The demo doctor is Dr Test Aisyah.',
      'The Sona bar or composer takes a typed question; answers appear in the page, not in a separate chat screen.',
      'An answer labelled sample, fixture or "not switched on" came from a stand-in, not a model.',
    ].join('\n'),
  },
};
