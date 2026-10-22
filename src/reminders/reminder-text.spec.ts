import { testPush } from '../push/push-payload.js';
import { clockLabel, reminderPush, type ReminderData } from './reminder-text.js';

const data = (fields: Partial<ReminderData> & Pick<ReminderData, 'kind'>): ReminderData => ({
  targetKey: 'x',
  name: 'Walk',
  at: '07:30',
  url: '/u',
  ...fields,
});

describe('reminderPush', () => {
  it('names a habit, challenge, book or skill and says what it is time for', () => {
    expect(reminderPush(data({ kind: 'HABIT' }), 'en')).toEqual({ title: 'Walk', body: 'Time for your habit', url: '/u', tag: 'reminder:HABIT:x' });
    expect(reminderPush(data({ kind: 'HABIT' }), 'bn').body).toBe('আপনার অভ্যাসের সময় হয়েছে');
    expect(reminderPush(data({ kind: 'BOOK', name: 'Paradoxical Sajid' }), 'en')).toMatchObject({ title: 'Paradoxical Sajid', body: 'Time to read' });
    expect(reminderPush(data({ kind: 'SKILL' }), 'bn').body).toBe('অনুশীলনের সময় হয়েছে');
    expect(reminderPush(data({ kind: 'CHALLENGE' }), 'en').body).toBe("Time for today's challenge");
  });

  it('says how soon a prayer is, in both languages', () => {
    const fajr = data({ kind: 'NAMAZ', targetKey: 'fajr', name: 'Fajr', prayer: 'Fajr', at: '04:43', minutesBefore: 10 });
    expect(reminderPush(fajr, 'en')).toMatchObject({ title: 'Fajr in 10 minutes', body: 'Fajr is at 4:43 am' });
    expect(reminderPush(fajr, 'bn')).toMatchObject({ title: '১০ মিনিট পরে ফজর', body: 'ফজরের সময় ৪:৪৩ পূর্বাহ্ণ' });
    const isha = { ...fajr, targetKey: 'isha', name: 'Isha', prayer: 'Isha', at: '18:42', minutesBefore: 0 };
    expect(reminderPush(isha, 'en')).toMatchObject({ title: 'Time for Isha', body: 'Isha is at 6:42 pm' });
    expect(reminderPush(isha, 'bn').title).toBe('এশার সময় হয়েছে');
  });

  it('says when Sehri ends and Iftar comes', () => {
    const sehri = data({ kind: 'RAMADAN', targetKey: 'sehri', name: 'Sehri', at: '04:30', minutesBefore: 15 });
    expect(reminderPush(sehri, 'en')).toMatchObject({ title: 'Sehri ends in 15 minutes', body: 'Sehri ends at 4:30 am' });
    expect(reminderPush(sehri, 'bn').title).toBe('১৫ মিনিট পরে সেহরির সময় শেষ');
    const iftar = data({ kind: 'RAMADAN', targetKey: 'iftar', name: 'Iftar', at: '17:27', minutesBefore: 0 });
    expect(reminderPush(iftar, 'en')).toMatchObject({ title: 'Time for Iftar', body: 'Iftar is at 5:27 pm' });
    expect(reminderPush(iftar, 'bn').title).toBe('ইফতারের সময় হয়েছে');
  });

  it("gives a to-do's time and lead", () => {
    const task = data({ kind: 'TODO', name: 'Call the bank', at: '17:30', minutesBefore: 1 });
    expect(reminderPush(task, 'en')).toMatchObject({ title: 'Call the bank', body: 'Due at 5:30 pm (in 1 minute)' });
    expect(reminderPush({ ...task, minutesBefore: 0 }, 'en').body).toBe('Due now (5:30 pm)');
    expect(reminderPush({ ...task, minutesBefore: 30 }, 'bn').body).toBe('সময় ৫:৩০ অপরাহ্ণ (৩০ মিনিট পরে)');
  });

  it('writes clocks as the app does', () => {
    expect(clockLabel('00:05', 'en')).toBe('12:05 am');
    expect(clockLabel('12:00', 'en')).toBe('12:00 pm');
    expect(clockLabel('13:07', 'bn')).toBe('১:০৭ অপরাহ্ণ');
  });

  it('has a test push in both languages', () => {
    expect(testPush('en')).toEqual({ title: 'Smartly', body: 'Notifications are on for this device.', url: '/settings/app', tag: 'test' });
    expect(testPush('bn').body).toBe('এই ডিভাইসে নোটিফিকেশন চালু আছে।');
  });
});
