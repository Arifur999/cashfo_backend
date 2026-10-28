// Pure helpers for MRAM's text SMS API (https://msg.mram.com.bd), kept apart
// from SmsService so they are tested without the network.

// A Bangladeshi mobile number in the form MRAM takes (8801XXXXXXXXX), from
// what a person typed: "01712-345678", "+880 1712 345678", "8801712345678".
// Null for anything else (a landline, a number from another country).
export const toBdMobile = (raw: string): string | null => {
  const digits = raw.replace(/[\s-]/g, '').replace(/^\+/, '');
  const match = /^(?:880|0)?(1[3-9]\d{8})$/.exec(digits);
  return match ? `880${match[1]}` : null;
};

// Bangla (or any non-ASCII) text has to go as "unicode", which fits 70
// characters a part instead of 160.
export const isUnicode = (text: string) => [...text].some((char) => char.charCodeAt(0) > 0x7f);

// MRAM answers a refused send with one of these four-digit codes.
export const MRAM_ERRORS: Record<string, string> = {
  '1002': 'Sender ID not found',
  '1003': 'API not found',
  '1004': 'Spam detected',
  '1005': 'Internal error',
  '1006': 'Internal error',
  '1007': 'Balance insufficient',
  '1008': 'Message is empty',
  '1009': 'Message type not set',
  '1010': 'Invalid user and password',
  '1011': 'Invalid user id',
  '1012': 'Invalid number',
  '1013': 'API limit reached',
  '1014': 'No matching template',
  '1015': 'Content validation failed',
  '1016': 'This server address is not allowed',
  '1019': 'SMS purpose missing',
};

export type MramReply = { ok: true; id: string | null } | { ok: false; code: string; reason: string };

// A code with a few words around it is short; an accepted batch's answer
// (an id, maybe a count and a time) can be longer and carry digits.
const MAX_CODED_REPLY = 48;

// What a send's answer means. Only MRAM's listed codes (or nothing at all)
// are a refusal, also with a few words around them in a short answer. Any
// other answer is MRAM accepting the message and is its SMS shoot id -- a
// bare number such as "2001" included, as furnify's MRAM client reads it.
export const readMramReply = (body: string): MramReply => {
  const text = body
    .trim()
    .replace(/^"(.*)"$/s, '$1')
    .trim();
  if (!text) return { ok: false, code: 'EMPTY', reason: 'No answer' };
  const code = text.length <= MAX_CODED_REPLY ? text.match(/(?<!\d)\d{4}(?!\d)/g)?.find((found) => MRAM_ERRORS[found]) : undefined;
  if (code) return { ok: false, code, reason: MRAM_ERRORS[code] };
  const id = /ID\s*[-:]\s*([A-Za-z0-9_-]+)/i.exec(text)?.[1] ?? text.slice(0, 64);
  return { ok: true, id };
};

// "Your Balance is:BDT 203.25" -> 203.25.
export const readMramBalance = (body: string): number | null => {
  if (MRAM_ERRORS[body.trim()]) return null;
  const amount = /(\d+(?:\.\d+)?)\s*$/.exec(body.trim())?.[1];
  return amount === undefined ? null : Number(amount);
};
