import type { E2EConfig } from 'e2e';
import { mobile } from '@e2e-dev/mobile';
import { mobileTools } from '@e2e-dev/mobile/tools';
import { homedir } from 'node:os';
import { agents, SERVER } from './shared';

// The suite's own agent-device daemon: a global agent-device of another version (driving the demo simulators)
// holds ~/.agent-device, and two versions cannot share one state directory.
process.env.AGENT_DEVICE_STATE_DIR ??= `${homedir()}/.agent-device-e2e`;

/**
 * One iOS app in Expo Go on its own simulator, served by its own Metro in production mode (a dev bundle crashes
 * Expo Go since Vision Camera). The Worker must already be up (`bun run server`). Tests open the bundle with
 * `device.openLink(metroUrl(port))`.
 */
export function iosConfig({ name, device, appDir, port, env = {} }: { name: string; device: string; appDir: string; port: number; env?: Record<string, string> }) {
  const engine = mobile({ platform: 'ios', device });
  return {
    tests: `tests/${name}/**/*.e2e.ts`,
    output: `.e2e/${name}`,
    workers: 1,
    timeout: 240_000,
    agents: { default: { ...agents.default, tools: mobileTools(engine) } },
    targets: [{
      name,
      engine,
      app: {
        bundleId: 'host.exp.Exponent',
        permissions: { microphone: 'grant', camera: 'grant', photos: 'grant' },
        command: {
          executable: 'bun', args: ['x', 'expo', 'start', '--go', '--lan', '--port', String(port), '--no-dev', '--minify', '--clear'],
          cwd: `../apps/${appDir}`, env: { CI: '1', EXPO_PUBLIC_SERVER_URL: SERVER.replace('localhost', '127.0.0.1'), ...env },
          reuseExisting: true, startupTimeout: 180_000, log: `.e2e/logs/metro-${name}.log`,
        },
        readyUrl: `http://localhost:${port}/status`,
      },
    }],
  } satisfies E2EConfig;
}

export const metroUrl = (port: number) => `exp://127.0.0.1:${port}`;

type Fixtures = { app: { open(): Promise<void> }; device: { openLink(url: string): Promise<void> }; screen: import('e2e').Screen };

/**
 * Launches Expo Go fresh and loads the app's bundle: accepts iOS's "Open in Expo Go?" prompt, and on a fresh simulator
 * Expo Go's one-time developer-menu introduction, which opens over the app.
 */
export async function openSona({ app, device, screen }: Fixtures, port: number) {
  const tapIfShown = async (name: string, timeout: number) => {
    const button = screen.getByRole('button', name);
    if (await button.waitFor({ state: 'visible', timeout }).then(() => true, () => false)) await button.tap();
  };
  await app.open();
  await device.openLink(metroUrl(port));
  await tapIfShown('Open', 20_000);
  if (await screen.getByRole('button', 'Continue').waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)) {
    await screen.getByRole('button', 'Continue').tap();
    await tapIfShown('Close', 5_000);
  }
}
