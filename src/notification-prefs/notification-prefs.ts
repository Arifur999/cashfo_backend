// Settings › Notifications: which alert reaches the person where (the bell,
// email, SMS, push), quiet hours, how early loan and event reminders come,
// and the daily or weekly summary. Stored as one JSON value on the user
// (User.notificationPrefs); null or a missing part reads as the defaults.

export const CHANNELS = ['app', 'email', 'sms', 'push'] as const;
export type Channel = (typeof CHANNELS)[number];

export interface AlertDef {
  key: string;
  // The defaults for app, email, SMS and push.
  on: [boolean, boolean, boolean, boolean];
  // Channels that stay on whatever is picked (security: the bell and email).
  locked?: Channel[];
}

// The board's seventeen, in its order.
export const ALERTS: readonly AlertDef[] = [
  { key: 'bigTx', on: [true, false, false, true] },
  { key: 'budget', on: [true, true, false, true] },
  { key: 'income', on: [true, false, false, false] },
  { key: 'loanDue', on: [true, true, true, true] },
  { key: 'collect', on: [true, false, false, true] },
  { key: 'goalCheck', on: [true, false, false, false] },
  { key: 'goalDone', on: [true, true, false, true] },
  { key: 'grpEntry', on: [true, false, false, false] },
  { key: 'grpClose', on: [true, true, false, true] },
  { key: 'grpSettle', on: [true, true, false, true] },
  { key: 'event', on: [true, false, false, true] },
  { key: 'zakat', on: [true, true, false, false] },
  { key: 'refSign', on: [true, false, false, false] },
  { key: 'refEarn', on: [true, true, false, false] },
  { key: 'device', on: [true, true, true, true], locked: ['app', 'email'] },
  { key: 'pwd', on: [true, true, false, false], locked: ['app', 'email'] },
  { key: 'news', on: [true, false, false, false] },
];

export type AlertKey = (typeof ALERTS)[number]['key'];
const ALERT_KEYS = new Set(ALERTS.map((alert) => alert.key));
export const isAlertKey = (value: string): value is AlertKey => ALERT_KEYS.has(value);
// Alerts quiet hours never hold back.
const SECURITY = new Set(['device', 'pwd']);

export const LOAN_DAYS = [1, 3, 7] as const;
export const EVENT_DAYS = [1, 2, 3, 7] as const;
export const WEEK_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface NotificationPrefs {
  alerts: Record<string, Record<Channel, boolean>>;
  loanDaysBefore: number;
  eventDaysBefore: number;
  quiet: { on: boolean; from: string; to: string };
  summary: { mode: 'off' | 'daily' | 'weekly'; day: (typeof WEEK_DAYS)[number]; time: string };
}

export function defaultPrefs(): NotificationPrefs {
  return {
    alerts: Object.fromEntries(ALERTS.map((alert) => [alert.key, { app: alert.on[0], email: alert.on[1], sms: alert.on[2], push: alert.on[3] }])),
    loanDaysBefore: 3,
    eventDaysBefore: 1,
    quiet: { on: true, from: '22:00', to: '07:00' },
    summary: { mode: 'weekly', day: 'fri', time: '21:00' },
  };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// Whatever is stored, as full prefs: unknown parts dropped, missing ones
// the defaults, and the locked channels on.
export function resolvePrefs(raw: unknown): NotificationPrefs {
  const prefs = defaultPrefs();
  if (!isObject(raw)) return prefs;
  if (isObject(raw.alerts)) {
    for (const alert of ALERTS) {
      const row = raw.alerts[alert.key];
      if (!isObject(row)) continue;
      for (const channel of CHANNELS) if (typeof row[channel] === 'boolean') prefs.alerts[alert.key][channel] = row[channel];
    }
  }
  for (const alert of ALERTS) for (const channel of alert.locked ?? []) prefs.alerts[alert.key][channel] = true;
  if ((LOAN_DAYS as readonly number[]).includes(raw.loanDaysBefore as number)) prefs.loanDaysBefore = raw.loanDaysBefore as number;
  if ((EVENT_DAYS as readonly number[]).includes(raw.eventDaysBefore as number)) prefs.eventDaysBefore = raw.eventDaysBefore as number;
  if (isObject(raw.quiet)) {
    if (typeof raw.quiet.on === 'boolean') prefs.quiet.on = raw.quiet.on;
    if (typeof raw.quiet.from === 'string' && CLOCK.test(raw.quiet.from)) prefs.quiet.from = raw.quiet.from;
    if (typeof raw.quiet.to === 'string' && CLOCK.test(raw.quiet.to)) prefs.quiet.to = raw.quiet.to;
  }
  if (isObject(raw.summary)) {
    if (raw.summary.mode === 'off' || raw.summary.mode === 'daily' || raw.summary.mode === 'weekly') prefs.summary.mode = raw.summary.mode;
    if ((WEEK_DAYS as readonly string[]).includes(raw.summary.day as string)) prefs.summary.day = raw.summary.day as NotificationPrefs['summary']['day'];
    if (typeof raw.summary.time === 'string' && CLOCK.test(raw.summary.time)) prefs.summary.time = raw.summary.time;
  }
  return prefs;
}

const minutesOf = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

// Whether a Dhaka "HH:MM" falls in quiet hours (which may run past midnight).
export function inQuietHours(prefs: NotificationPrefs, dhakaClock: string): boolean {
  if (!prefs.quiet.on || prefs.quiet.from === prefs.quiet.to) return false;
  const now = minutesOf(dhakaClock);
  const from = minutesOf(prefs.quiet.from);
  const to = minutesOf(prefs.quiet.to);
  return from < to ? now >= from && now < to : now >= from || now < to;
}

// Whether an alert may go out on a channel now: picked on, SMS only on Pro,
// and SMS and push held back in quiet hours (security alerts excepted).
export function allows(prefs: NotificationPrefs, alert: AlertKey, channel: Channel, context: { pro: boolean; dhakaClock: string }): boolean {
  if (!prefs.alerts[alert]?.[channel]) return false;
  if (channel === 'sms' && !context.pro) return false;
  if ((channel === 'sms' || channel === 'push') && !SECURITY.has(alert) && inQuietHours(prefs, context.dhakaClock)) return false;
  return true;
}

// The alert a bell row belongs to, for hiding what the person turned off
// in the bell; null for rows no switch covers (announcements, habits...).
export function alertOfRow(type: string, data: Record<string, unknown> | null): AlertKey | null {
  switch (type) {
    case 'BUDGET':
      return 'budget';
    case 'LOAN_DUE':
      return data?.direction === 'PAYABLE' ? 'loanDue' : 'collect';
    case 'SAVINGS':
      return 'goalCheck';
    case 'EVENT':
      return 'event';
    case 'ZAKAT':
      return 'zakat';
    case 'REFERRAL':
      // Someone you brought joined and paid (pending), or an earning can be
      // withdrawn; the rest of a referral's news always shows.
      return data?.event === 'COMMISSION_PENDING' ? 'refSign' : data?.event === 'COMMISSION_AVAILABLE' ? 'refEarn' : null;
    default:
      return null;
  }
}

// How many of the switches are on (the page's "37 of 68 turned on").
export function countOn(prefs: NotificationPrefs): { on: number; total: number } {
  let on = 0;
  for (const alert of ALERTS) for (const channel of CHANNELS) if (prefs.alerts[alert.key][channel]) on += 1;
  return { on, total: ALERTS.length * CHANNELS.length };
}
