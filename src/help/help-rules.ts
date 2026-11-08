// Settings › Help & support's data, as Admin › Settings keeps it: the
// company card and the video guides. Pure, so they are tested alone.

export const HELP_COMPANY_KEY = 'help_company';
export const VIDEO_CATEGORIES = ['GETTING_STARTED', 'INCOME_EXPENSE', 'SAVINGS', 'LOANS', 'GROUP_EXPENSE', 'SECURITY', 'OTHER'] as const;
export type VideoCategory = (typeof VIDEO_CATEGORIES)[number];
export const WEEK_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export interface HelpCompany {
  name: string;
  tagline: string;
  legalName: string;
  tradeLicence: string;
  hotline: string;
  whatsapp: string;
  email: string;
  website: string;
  facebook: string;
  youtube: string;
  headOffice: string;
  dhakaOffice: string;
  openDays: (typeof WEEK_DAYS)[number][];
  opensAt: string;
  closesAt: string;
  // The average first reply, in hours (0: not said).
  replyHours: number;
}

export const EMPTY_COMPANY: HelpCompany = {
  name: '',
  tagline: '',
  legalName: '',
  tradeLicence: '',
  hotline: '',
  whatsapp: '',
  email: '',
  website: '',
  facebook: '',
  youtube: '',
  headOffice: '',
  dhakaOffice: '',
  openDays: ['sat', 'sun', 'mon', 'tue', 'wed', 'thu'],
  opensAt: '09:00',
  closesAt: '18:00',
  replyHours: 0,
};

// What is stored, read loosely: a missing or odd field falls back.
export function companyOf(stored: unknown): HelpCompany {
  const value = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const text = (key: keyof HelpCompany) => (typeof value[key] === 'string' ? (value[key] as string) : (EMPTY_COMPANY[key] as string));
  const days = Array.isArray(value.openDays)
    ? value.openDays.filter((day): day is (typeof WEEK_DAYS)[number] => (WEEK_DAYS as readonly string[]).includes(day as string))
    : EMPTY_COMPANY.openDays;
  const time = (key: 'opensAt' | 'closesAt') =>
    typeof value[key] === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value[key] as string) ? (value[key] as string) : EMPTY_COMPANY[key];
  const reply = typeof value.replyHours === 'number' && Number.isFinite(value.replyHours) && value.replyHours >= 0 ? value.replyHours : 0;
  return {
    name: text('name'),
    tagline: text('tagline'),
    legalName: text('legalName'),
    tradeLicence: text('tradeLicence'),
    hotline: text('hotline'),
    whatsapp: text('whatsapp'),
    email: text('email'),
    website: text('website'),
    facebook: text('facebook'),
    youtube: text('youtube'),
    headOffice: text('headOffice'),
    dhakaOffice: text('dhakaOffice'),
    openDays: [...new Set(days)],
    opensAt: time('opensAt'),
    closesAt: time('closesAt'),
    replyHours: reply,
  };
}

// The 11-character video id of a YouTube link: watch?v=, youtu.be/,
// shorts/, embed/ or live/; null for anything else.
export function youtubeIdOf(link: string): string | null {
  const text = link.trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : (/^\/(shorts|embed|live)\/([\w-]+)/.exec(url.pathname)?.[2] ?? null);
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}
