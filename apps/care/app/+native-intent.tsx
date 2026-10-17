/**
 * The discharge QR holds Sona Care web's join link (https://…/care/join?code=…). Opened as a universal
 * link it lands here; the app's own join screen is /join, so the code is carried over to it.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (!path.includes("/care/join")) return path;
    const code = path.match(/[?&]code=([A-Za-z0-9-]+)/)?.[1];
    return code ? `/join?code=${code}` : "/join";
  } catch {
    return path;
  }
}
