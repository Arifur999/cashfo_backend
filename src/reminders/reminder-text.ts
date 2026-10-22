import type { ReminderKind } from '@prisma/client';
import type { PushLocale, PushPayload } from '../push/push-payload.js';

// What a reminder's push notification says, in the language of the device
// it goes to. The bell builds its own text from the same `data` in the app;
// a push has to carry finished words, so this small table is the backend's.

// The bell row's `data` for a reminder (UserNotification.data, type REMINDER).
export interface ReminderData {
  kind: ReminderKind;
  targetKey: string;
  // The habit, challenge, book, skill or task as typed; the prayer's name
  // ("Fajr"), or "Sehri" / "Iftar".
  name: string;
  // "HH:MM" (Dhaka) of the thing itself: the habit's set time, the prayer,
  // Sehri's end, Iftar, or the task's time. It fires minutesBefore earlier.
  at: string;
  // NAMAZ: "Fajr" | "Dhuhr" | "Asr" | "Maghrib" | "Isha".
  prayer?: string;
  // NAMAZ, RAMADAN, TODO: how many minutes ahead it fires (0 = at the time).
  minutesBefore?: number;
  // The page to open.
  url: string;
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
export const localeDigits = (text: string, locale: PushLocale): string => (locale === 'bn' ? text.replace(/\d/g, (d) => BN_DIGITS[Number(d)]) : text);

// "5:42 am" / "৫:৪২ পূর্বাহ্ণ", like the app's timeLabel().
export function clockLabel(clock: string, locale: PushLocale): string {
  const [hours, minutes] = clock.split(':').map(Number);
  const time = localeDigits(`${hours % 12 || 12}:${String(minutes).padStart(2, '0')}`, locale);
  if (locale === 'bn') return `${time} ${hours < 12 ? 'পূর্বাহ্ণ' : 'অপরাহ্ণ'}`;
  return `${time} ${hours < 12 ? 'am' : 'pm'}`;
}

// "in 10 minutes" / "১০ মিনিট পরে".
function inMinutes(minutes: number, locale: PushLocale): string {
  if (locale === 'bn') return `${localeDigits(String(minutes), 'bn')} মিনিট পরে`;
  return `in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

const PRAYER_BN: Record<string, { name: string; of: string }> = {
  Fajr: { name: 'ফজর', of: 'ফজরের' },
  Dhuhr: { name: 'যোহর', of: 'যোহরের' },
  Asr: { name: 'আসর', of: 'আসরের' },
  Maghrib: { name: 'মাগরিব', of: 'মাগরিবের' },
  Isha: { name: 'এশা', of: 'এশার' },
};

const TIMED_BODY: Record<'HABIT' | 'CHALLENGE' | 'BOOK' | 'SKILL', Record<PushLocale, string>> = {
  HABIT: { en: 'Time for your habit', bn: 'আপনার অভ্যাসের সময় হয়েছে' },
  CHALLENGE: { en: "Time for today's challenge", bn: 'আজকের চ্যালেঞ্জের সময় হয়েছে' },
  BOOK: { en: 'Time to read', bn: 'পড়ার সময় হয়েছে' },
  SKILL: { en: 'Time to practise', bn: 'অনুশীলনের সময় হয়েছে' },
};

function words(data: ReminderData, locale: PushLocale): { title: string; body: string } {
  const before = data.minutesBefore ?? 0;
  const at = clockLabel(data.at, locale);
  switch (data.kind) {
    case 'HABIT':
    case 'CHALLENGE':
    case 'BOOK':
    case 'SKILL':
      return { title: data.name, body: TIMED_BODY[data.kind][locale] };
    case 'TODO':
      if (locale === 'bn') return { title: data.name, body: before > 0 ? `সময় ${at} (${inMinutes(before, 'bn')})` : `এখনই করার সময় (${at})` };
      return { title: data.name, body: before > 0 ? `Due at ${at} (${inMinutes(before, 'en')})` : `Due now (${at})` };
    case 'NAMAZ': {
      const prayer = data.prayer ?? data.name;
      if (locale === 'bn') {
        const bn = PRAYER_BN[prayer] ?? { name: prayer, of: prayer };
        return { title: before > 0 ? `${inMinutes(before, 'bn')} ${bn.name}` : `${bn.of} সময় হয়েছে`, body: `${bn.of} সময় ${at}` };
      }
      return { title: before > 0 ? `${prayer} ${inMinutes(before, 'en')}` : `Time for ${prayer}`, body: `${prayer} is at ${at}` };
    }
    case 'RAMADAN':
      if (data.targetKey === 'sehri') {
        if (locale === 'bn') return { title: before > 0 ? `${inMinutes(before, 'bn')} সেহরির সময় শেষ` : 'সেহরির সময় শেষ', body: `সেহরির শেষ সময় ${at}` };
        return { title: before > 0 ? `Sehri ends ${inMinutes(before, 'en')}` : 'Sehri time is over', body: `Sehri ends at ${at}` };
      }
      if (locale === 'bn') return { title: before > 0 ? `${inMinutes(before, 'bn')} ইফতার` : 'ইফতারের সময় হয়েছে', body: `ইফতারের সময় ${at}` };
      return { title: before > 0 ? `Iftar ${inMinutes(before, 'en')}` : 'Time for Iftar', body: `Iftar is at ${at}` };
  }
}

// The push for a reminder, in one device's language. Its tag makes a newer
// reminder for the same thing replace an older one still on screen.
export function reminderPush(data: ReminderData, locale: PushLocale): PushPayload {
  return { ...words(data, locale), url: data.url, tag: `reminder:${data.kind}:${data.targetKey}` };
}
