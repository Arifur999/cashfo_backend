// What a web push carries: the service worker (cashfo/public/sw.js) shows
// `title` and `body`, opens `url` on a click, and lets a newer push with the
// same `tag` replace an older one still on screen.
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

// The language a device's notifications are written in.
export type PushLocale = 'en' | 'bn';

export const PUSH_LOCALES: readonly PushLocale[] = ['en', 'bn'];

export const pushLocale = (value: string | null | undefined): PushLocale => (value === 'bn' ? 'bn' : 'en');

// "Send a test" in Settings > App > Reminders.
export function testPush(locale: PushLocale): PushPayload {
  return locale === 'bn'
    ? { title: 'Smartly', body: 'এই ডিভাইসে নোটিফিকেশন চালু আছে।', url: '/settings/app', tag: 'test' }
    : { title: 'Smartly', body: 'Notifications are on for this device.', url: '/settings/app', tag: 'test' };
}
