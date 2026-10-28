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
export const isUnicode = (text: string) => /[^\x00-\x7F]/.test(text);

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

// What a send's answer means: a known error code (or nothing at all) is a
// refusal; anything else is MRAM accepting it, with its SMS id when the
// answer carries one ("SMS SUBMITTED: ID - C2000…").
export const readMramReply = (body: string): MramReply => {
  const text = body.trim();
  if (!text) return { ok: false, code: 'EMPTY', reason: 'No answer' };
  const code = /^\d{4}$/.exec(text)?.[0];
  if (code) return { ok: false, code, reason: MRAM_ERRORS[code] ?? 'Unknown error' };
  const id = /ID\s*[-:]\s*([A-Za-z0-9_-]+)/i.exec(text)?.[1] ?? null;
  return { ok: true, id };
};

// "Your Balance is:BDT 203.25" -> 203.25.
export const readMramBalance = (body: string): number | null => {
  if (MRAM_ERRORS[body.trim()]) return null;
  const amount = /(\d+(?:\.\d+)?)\s*$/.exec(body.trim())?.[1];
  return amount === undefined ? null : Number(amount);
};
