import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PayoutMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import type { CreatePayoutMethodDto, UpdatePayoutMethodDto } from './dto/payout-method.dto.js';
import { normaliseMethod, type MethodInput } from './payout-methods.js';
import { namesMatch } from './referral-money.js';

// A member keeps at most this many.
const MAX_METHODS = 10;

// Where a member's referral money is sent (Referral Program > Withdraw >
// "Where should it go?"). One of them is the default; the first one saved
// is. Deleting hides the method; requests keep their own copy.
@Injectable()
export class PayoutMethodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
  ) {}

  async list(userId: string) {
    const [user, methods] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } }),
      this.prisma.payoutMethod.findMany({ where: { userId, deletedAt: null }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] }),
    ]);
    // "The name didn't match last time": the newest request sent to a
    // method, when it was rejected.
    const latest = await this.prisma.payoutRequest.findMany({
      where: { userId, methodId: { in: methods.map((m) => m.id) } },
      orderBy: { createdAt: 'desc' },
      distinct: ['methodId'],
      select: { methodId: true, status: true, rejectedAt: true, rejectReason: true },
    });
    const lastByMethod = new Map(latest.map((row) => [row.methodId, row]));
    return methods.map((method) => {
      const last = lastByMethod.get(method.id);
      return this.present(method, user.name, last?.status === 'REJECTED' ? { at: last.rejectedAt, reason: last.rejectReason } : null);
    });
  }

  async create(userId: string, dto: CreatePayoutMethodDto) {
    const fields = this.validate(dto);
    const method = await this.transactions.withLocks([`payout-methods:${userId}`], async (tx) => {
      const count = await tx.payoutMethod.count({ where: { userId, deletedAt: null } });
      if (count >= MAX_METHODS) throw new BadRequestException(`You can save up to ${MAX_METHODS} payout methods`);
      const isDefault = count === 0 || dto.isDefault === true;
      if (isDefault) await tx.payoutMethod.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      return tx.payoutMethod.create({ data: { userId, ...fields, isDefault } });
    });
    return this.presentOne(userId, method);
  }

  async update(userId: string, id: string, dto: UpdatePayoutMethodDto) {
    const method = await this.transactions.withLocks([`payout-methods:${userId}`], async (tx) => {
      const current = await this.requireOwn(tx, userId, id);
      const fields = this.validate({
        type: dto.type ?? current.type,
        accountName: dto.accountName !== undefined ? dto.accountName : current.accountName,
        walletNumber: dto.walletNumber !== undefined ? dto.walletNumber : current.walletNumber,
        bankName: dto.bankName !== undefined ? dto.bankName : current.bankName,
        branch: dto.branch !== undefined ? dto.branch : current.branch,
        bankAccountType: dto.bankAccountType !== undefined ? dto.bankAccountType : current.bankAccountType,
        accountNumber: dto.accountNumber !== undefined ? dto.accountNumber : current.accountNumber,
        routingNumber: dto.routingNumber !== undefined ? dto.routingNumber : current.routingNumber,
      });
      // The default can be moved to another method, not switched off.
      if (dto.isDefault === true && !current.isDefault) await tx.payoutMethod.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      return tx.payoutMethod.update({ where: { id }, data: { ...fields, ...(dto.isDefault === true && { isDefault: true }) } });
    });
    return this.presentOne(userId, method);
  }

  async makeDefault(userId: string, id: string) {
    const method = await this.transactions.withLocks([`payout-methods:${userId}`], async (tx) => {
      await this.requireOwn(tx, userId, id);
      await tx.payoutMethod.updateMany({ where: { userId, isDefault: true, id: { not: id } }, data: { isDefault: false } });
      return tx.payoutMethod.update({ where: { id }, data: { isDefault: true } });
    });
    return this.presentOne(userId, method);
  }

  // Hidden, not deleted. When it was the default, the oldest one left
  // takes over.
  async remove(userId: string, id: string) {
    await this.transactions.withLocks([`payout-methods:${userId}`], async (tx) => {
      const current = await this.requireOwn(tx, userId, id);
      await tx.payoutMethod.update({ where: { id }, data: { deletedAt: new Date(), isDefault: false } });
      if (current.isDefault) {
        const next = await tx.payoutMethod.findFirst({ where: { userId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
        if (next) await tx.payoutMethod.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
    return { success: true };
  }

  private validate(input: MethodInput) {
    const result = normaliseMethod(input);
    if ('problem' in result) throw new BadRequestException(result.problem);
    return result.value;
  }

  private async requireOwn(client: Prisma.TransactionClient | PrismaService, userId: string, id: string): Promise<PayoutMethod> {
    const method = await client.payoutMethod.findFirst({ where: { id, userId, deletedAt: null } });
    if (!method) throw new NotFoundException('Payout method not found');
    return method;
  }

  private async presentOne(userId: string, method: PayoutMethod) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
    return this.present(method, user.name, null);
  }

  private present(method: PayoutMethod, userName: string, lastRejection: { at: Date | null; reason: string | null } | null) {
    return {
      id: method.id,
      type: method.type,
      accountName: method.accountName,
      walletNumber: method.walletNumber,
      bankName: method.bankName,
      branch: method.branch,
      bankAccountType: method.bankAccountType,
      accountNumber: method.accountNumber,
      routingNumber: method.routingNumber,
      isDefault: method.isDefault,
      // Soft check: the payout is rejected when the name on the account
      // isn't the member's.
      nameMatches: namesMatch(method.accountName, userName),
      lastRejection,
      createdAt: method.createdAt,
      updatedAt: method.updatedAt,
    };
  }
}
