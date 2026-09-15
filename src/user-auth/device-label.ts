// Best-effort browser/OS label from a raw User-Agent string, purely for
// Settings > Security's Device Management/Login History display -- no
// dependency pulled in for this, just enough regex matching to produce
// something like "Chrome on Windows" or "Safari on iOS". Never used for any
// real security decision (session identity is the refresh token's own jti,
// not this label).
export function parseDeviceLabel(userAgent?: string | null): string {
  if (!userAgent) return 'Unknown device';

  const isMobile = /Mobile|Android|iPhone|iPad/i.test(userAgent);

  let browser = 'Unknown browser';
  if (/Edg\//.test(userAgent)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(userAgent)) browser = 'Opera';
  else if (/Chrome\//.test(userAgent) && !/Chromium/.test(userAgent)) browser = 'Chrome';
  else if (/Firefox\//.test(userAgent)) browser = 'Firefox';
  else if (/Safari\//.test(userAgent) && !/Chrome/.test(userAgent)) browser = 'Safari';

  let os = 'Unknown OS';
  if (/Windows/.test(userAgent)) os = 'Windows';
  else if (/iPhone|iPad/.test(userAgent)) os = 'iOS';
  else if (/Mac OS X/.test(userAgent)) os = 'macOS';
  else if (/Android/.test(userAgent)) os = 'Android';
  else if (/Linux/.test(userAgent)) os = 'Linux';

  return `${browser} on ${os}${isMobile && os !== 'iOS' && os !== 'Android' ? ' (Mobile)' : ''}`;
}
