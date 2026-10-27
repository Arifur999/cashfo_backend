import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSavedReplyDto, UpdateSavedReplyDto } from './dto/saved-reply.dto.js';
import { SavedRepliesService } from './saved-replies.service.js';

type Row = Record<string, unknown>;

const setup = () => {
  const rows: Row[] = [];
  const prisma = {
    savedReply: {
      findMany: vi.fn(async () => [...rows]),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.find((row) => row.id === where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { id: `r${rows.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) =>
        Object.assign(
          rows.find((row) => row.id === where.id)!,
          data,
        ),
      ),
      delete: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          rows.splice(
            rows.findIndex((row) => row.id === where.id),
            1,
          )[0],
      ),
    },
    user: { findMany: vi.fn(async () => [{ id: 'admin-imran', name: 'Imran Kabir' }]) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  return { service: new SavedRepliesService(prisma as never), prisma, rows };
};

describe('SavedRepliesService', () => {
  it('creates, edits and deletes a reply, naming its author and auditing each step', async () => {
    const { service, prisma, rows } = setup();
    const created = await service.create({ title: 'PDF export fixed', bodyEn: 'It is back on.', bodyBn: '' }, 'admin-imran', '1.2.3.4');
    expect(created).toMatchObject({ id: 'r1', title: 'PDF export fixed', bodyBn: null, createdBy: { id: 'admin-imran', name: 'Imran Kabir' } });

    const edited = await service.update('r1', { bodyBn: 'আবার চালু হয়েছে।' }, 'admin-imran');
    expect(edited).toMatchObject({ bodyEn: 'It is back on.', bodyBn: 'আবার চালু হয়েছে।' });
    expect((await service.update('r1', { bodyBn: null }, 'admin-imran')).bodyBn).toBeNull();

    expect(await service.remove('r1', 'admin-imran')).toEqual({ success: true });
    expect(rows).toHaveLength(0);
    expect(prisma.auditLog.create.mock.calls.map((call) => (call as unknown as [{ data: { action: string } }])[0].data.action)).toEqual([
      'SAVED_REPLY_CREATED',
      'SAVED_REPLY_UPDATED',
      'SAVED_REPLY_UPDATED',
      'SAVED_REPLY_DELETED',
    ]);
    await expect(service.remove('r1', 'admin-imran')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('validates the title and bodies', async () => {
    const check = (cls: typeof CreateSavedReplyDto | typeof UpdateSavedReplyDto, body: object) =>
      validate(plainToInstance(cls, body), { whitelist: true, forbidNonWhitelisted: true });
    expect(await check(CreateSavedReplyDto, { title: 'Hi', bodyEn: 'Hello' })).toHaveLength(0);
    expect(await check(CreateSavedReplyDto, { title: '  ', bodyEn: 'Hello' })).toHaveLength(1);
    expect(await check(CreateSavedReplyDto, { title: 'x'.repeat(121), bodyEn: 'Hello' })).toHaveLength(1);
    expect(await check(CreateSavedReplyDto, { title: 'Hi', bodyEn: 'x'.repeat(5001) })).toHaveLength(1);
    expect(await check(UpdateSavedReplyDto, { bodyBn: null })).toHaveLength(0);
    expect(await check(UpdateSavedReplyDto, { title: null })).toHaveLength(1);
  });
});
