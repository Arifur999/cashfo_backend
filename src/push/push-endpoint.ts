// The push services browsers subscribe through. The server POSTs to the
// endpoint a client sends, so only these hosts are taken -- an address on
// the server's own network could otherwise be made a target.
//   Chrome, Edge (Chromium), Opera, Samsung Internet, Brave: FCM
//   Firefox: Mozilla autopush
//   Safari (macOS, iOS 16.4+ Home Screen apps): Apple
//   Legacy Edge / Windows: WNS
export const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];

export const MAX_ENDPOINT_LENGTH = 2048;

// Whether an endpoint is an https address on one of the push services (the
// host itself or a subdomain of it).
export function isPushEndpoint(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > MAX_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}
