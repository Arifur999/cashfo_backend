// Best-effort MOBILE/DESKTOP/TABLET classifier for the Device Breakdown
// chart and for the usage events the server writes -- the same User-Agent
// signal user-auth/device-label.ts parses in more detail for Settings >
// Security's device list.
export function classifyDeviceType(userAgent: string | null | undefined): 'MOBILE' | 'DESKTOP' | 'TABLET' {
  if (!userAgent) return 'DESKTOP';
  if (/iPad|Tablet/i.test(userAgent)) return 'TABLET';
  if (/Mobile|Android|iPhone/i.test(userAgent)) return 'MOBILE';
  return 'DESKTOP';
}

// The usage events the server itself writes (UsageEvent.eventType), which
// Analytics > Feature usage counts beside the ones it reads from real tables.
export const USAGE_EVENTS = { REPORT_VIEWED: 'report_viewed', HABIT_CHECKED_IN: 'habit_checked_in' } as const;
export type UsageEventType = (typeof USAGE_EVENTS)[keyof typeof USAGE_EVENTS];

// Whether an event named by key should be written now, remembering it if so:
// false while the same key was written less than windowMs ago. Expired keys
// are dropped once the map holds maxKeys, so a long-running server's memory
// stays bounded.
export function firstWithin(recent: Map<string, number>, key: string, now: number, windowMs: number, maxKeys = 5000): boolean {
  const last = recent.get(key);
  if (last !== undefined && now - last < windowMs) return false;
  if (recent.size >= maxKeys) {
    for (const [seen, at] of recent) if (now - at >= windowMs) recent.delete(seen);
    // Still full of live keys: forget the oldest rather than grow.
    const oldest = recent.keys().next();
    if (recent.size >= maxKeys && !oldest.done) recent.delete(oldest.value);
  }
  recent.set(key, now);
  return true;
}
