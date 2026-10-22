// @Type() (the nested keys and repeat) reads decorator metadata.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SubscribePushDto, UnsubscribePushDto } from '../../push/dto/push-subscription.dto.js';
import { CreateTodoItemDto } from '../../todos/dto/create-todo-item.dto.js';
import { UpdateTodoItemDto } from '../../todos/dto/update-todo-item.dto.js';
import { ReminderSettingsDto, UpsertReminderDto } from './reminder.dto.js';

const errorsFor = async (dto: new () => object, body: object) =>
  (await validate(plainToInstance(dto, body), { whitelist: true, forbidNonWhitelisted: true })).map((error) => error.property);

describe('UpsertReminderDto', () => {
  const base = { kind: 'HABIT', targetKey: 'f3c1d1a2-0000-4000-8000-000000000000', enabled: true };

  it('takes times, weekdays and minutes before', async () => {
    expect(await errorsFor(UpsertReminderDto, { ...base, times: ['07:30', '21:00'], weekdays: [0, 6] })).toEqual([]);
    expect(await errorsFor(UpsertReminderDto, { kind: 'NAMAZ', targetKey: 'fajr', enabled: true, minutesBefore: 10 })).toEqual([]);
    expect(await errorsFor(UpsertReminderDto, { ...base, enabled: false })).toEqual([]);
  });

  it('refuses a bad time, a repeated time, more than six, or a null', async () => {
    expect(await errorsFor(UpsertReminderDto, { ...base, times: ['7:30'] })).toEqual(['times']);
    expect(await errorsFor(UpsertReminderDto, { ...base, times: ['24:00'] })).toEqual(['times']);
    expect(await errorsFor(UpsertReminderDto, { ...base, times: ['07:30', '07:30'] })).toEqual(['times']);
    expect(await errorsFor(UpsertReminderDto, { ...base, times: ['01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00'] })).toEqual(['times']);
    expect(await errorsFor(UpsertReminderDto, { ...base, times: null })).toEqual(['times']);
  });

  it('refuses weekdays outside 0-6 or repeated', async () => {
    expect(await errorsFor(UpsertReminderDto, { ...base, weekdays: [7] })).toEqual(['weekdays']);
    expect(await errorsFor(UpsertReminderDto, { ...base, weekdays: [1, 1] })).toEqual(['weekdays']);
    expect(await errorsFor(UpsertReminderDto, { ...base, weekdays: [1.5] })).toEqual(['weekdays']);
  });

  it('keeps minutes before to 0-120', async () => {
    expect(await errorsFor(UpsertReminderDto, { ...base, minutesBefore: 121 })).toEqual(['minutesBefore']);
    expect(await errorsFor(UpsertReminderDto, { ...base, minutesBefore: -1 })).toEqual(['minutesBefore']);
  });

  it('needs a known kind, a target and the switch, and nothing else', async () => {
    expect(await errorsFor(UpsertReminderDto, { ...base, kind: 'BUDGET' })).toEqual(['kind']);
    expect(await errorsFor(UpsertReminderDto, { ...base, targetKey: '  ' })).toEqual(['targetKey']);
    expect(await errorsFor(UpsertReminderDto, { kind: 'HABIT', targetKey: 'x' })).toEqual(['enabled']);
    expect(await errorsFor(UpsertReminderDto, { ...base, userId: 'someone' })).toEqual(['userId']);
  });
});

describe('ReminderSettingsDto', () => {
  it('takes the master switch', async () => {
    expect(await errorsFor(ReminderSettingsDto, { remindHabits: false })).toEqual([]);
    expect(await errorsFor(ReminderSettingsDto, {})).toEqual(['remindHabits']);
  });
});

describe('SubscribePushDto', () => {
  const body = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc:def', keys: { p256dh: 'BNc...', auth: 'xyz' }, locale: 'bn' };

  it("takes the browser's subscription and the device's language", async () => {
    expect(await errorsFor(SubscribePushDto, body)).toEqual([]);
    expect(await errorsFor(SubscribePushDto, { ...body, endpoint: 'https://web.push.apple.com/QAbc' })).toEqual([]);
    expect(await errorsFor(SubscribePushDto, { ...body, endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/gAAA' })).toEqual([]);
    expect(await errorsFor(SubscribePushDto, { ...body, locale: undefined })).toEqual([]);
  });

  it('refuses an address that is not a push service', async () => {
    expect(await errorsFor(SubscribePushDto, { ...body, endpoint: 'http://fcm.googleapis.com/fcm/send/x' })).toEqual(['endpoint']);
    expect(await errorsFor(SubscribePushDto, { ...body, endpoint: 'https://smartly-api:5000/api/x' })).toEqual(['endpoint']);
    expect(await errorsFor(SubscribePushDto, { ...body, endpoint: 'https://127.0.0.1/x' })).toEqual(['endpoint']);
    expect(await errorsFor(SubscribePushDto, { ...body, endpoint: 'https://evil-fcm.googleapis.com.example.org/x' })).toEqual(['endpoint']);
    expect(await errorsFor(SubscribePushDto, { ...body, endpoint: 'https://fcm.googleapis.com:8443/x' })).toEqual(['endpoint']);
  });

  it('needs both keys and a known language', async () => {
    expect(await errorsFor(SubscribePushDto, { ...body, keys: undefined })).toEqual(['keys']);
    expect(await errorsFor(SubscribePushDto, { ...body, keys: { p256dh: 'x' } })).toEqual(['keys']);
    expect(await errorsFor(SubscribePushDto, { ...body, locale: 'fr' })).toEqual(['locale']);
  });

  it('turns off by endpoint', async () => {
    expect(await errorsFor(UnsubscribePushDto, { endpoint: body.endpoint })).toEqual([]);
    expect(await errorsFor(UnsubscribePushDto, {})).toEqual(['endpoint']);
  });
});

describe("a to-do's remindBefore", () => {
  it('is 0-120 minutes, or null for none', async () => {
    expect(await errorsFor(CreateTodoItemDto, { text: 'Call', dueTime: '17:30', remindBefore: 10 })).toEqual([]);
    expect(await errorsFor(CreateTodoItemDto, { text: 'Call', remindBefore: null })).toEqual([]);
    expect(await errorsFor(CreateTodoItemDto, { text: 'Call', remindBefore: 121 })).toEqual(['remindBefore']);
    expect(await errorsFor(UpdateTodoItemDto, { remindBefore: 0 })).toEqual([]);
    expect(await errorsFor(UpdateTodoItemDto, { remindBefore: null })).toEqual([]);
    expect(await errorsFor(UpdateTodoItemDto, { remindBefore: 2.5 })).toEqual(['remindBefore']);
    expect(await errorsFor(UpdateTodoItemDto, { repeat: { kind: 'DAILY', remindBefore: 15 } })).toEqual([]);
    expect(await errorsFor(UpdateTodoItemDto, { repeat: { kind: 'DAILY', remindBefore: 500 } })).toEqual(['repeat']);
  });
});
