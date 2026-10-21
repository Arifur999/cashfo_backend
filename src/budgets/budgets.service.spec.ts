import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BudgetsService } from './budgets.service.js';
import { UpdateBudgetTargetDto } from './dto/update-budget-target.dto.js';

const setup = (monthlyBudgetTarget: Prisma.Decimal | null = null) => {
  const prisma = {
    business: {
      update: vi.fn(({ data }: { data: { monthlyBudgetTarget: number | null } }) =>
        Promise.resolve({ monthlyBudgetTarget: data.monthlyBudgetTarget === null ? null : new Prisma.Decimal(data.monthlyBudgetTarget) }),
      ),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ monthlyBudgetTarget }),
    },
    budgetCategory: { findMany: vi.fn().mockResolvedValue([]) },
    transactionEntry: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }) },
  };
  return { service: new BudgetsService(prisma as never), prisma };
};

describe('BudgetsService.updateTarget', () => {
  it('sets an amount as the overall monthly budget', async () => {
    const { service, prisma } = setup();
    const result = await service.updateTarget('biz-1', { monthlyBudgetTarget: 25000 });
    expect(prisma.business.update).toHaveBeenCalledWith({
      where: { id: 'biz-1' },
      data: { monthlyBudgetTarget: 25000 },
      select: { monthlyBudgetTarget: true },
    });
    expect(result.monthlyBudgetTarget?.toFixed(2)).toBe('25000.00');
  });

  it('clears it with null', async () => {
    const { service, prisma } = setup();
    await expect(service.updateTarget('biz-1', { monthlyBudgetTarget: null })).resolves.toEqual({ monthlyBudgetTarget: null });
    expect(prisma.business.update).toHaveBeenCalledWith({ where: { id: 'biz-1' }, data: { monthlyBudgetTarget: null }, select: { monthlyBudgetTarget: true } });
  });
});

describe('BudgetsService.getOverview', () => {
  it('has no total budget once it is cleared', async () => {
    const { service } = setup(null);
    await expect(service.getOverview('biz-1', { month: 10, year: 2026 })).resolves.toMatchObject({ totalBudget: null, allocated: '0.00' });
  });

  it('shows the total budget while one is set', async () => {
    const { service } = setup(new Prisma.Decimal(25000));
    await expect(service.getOverview('biz-1', { month: 10, year: 2026 })).resolves.toMatchObject({ totalBudget: '25000.00' });
  });
});

describe('UpdateBudgetTargetDto', () => {
  // As the global ValidationPipe checks a body.
  const errorsFor = async (body: Record<string, unknown>) =>
    (await validate(plainToInstance(UpdateBudgetTargetDto, body), { whitelist: true, forbidNonWhitelisted: true })).map((error) => error.property);

  it('takes an amount, or null to clear the budget', async () => {
    expect(await errorsFor({ monthlyBudgetTarget: 25000 })).toEqual([]);
    expect(await errorsFor({ monthlyBudgetTarget: 2699.1 })).toEqual([]);
    expect(await errorsFor({ monthlyBudgetTarget: null })).toEqual([]);
  });

  it('hands a null to the service through the global ValidationPipe, and still turns away an unknown field', async () => {
    // The options main.ts gives it.
    const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
    const asBody = { type: 'body' as const, metatype: UpdateBudgetTargetDto };
    await expect(pipe.transform({ monthlyBudgetTarget: null }, asBody)).resolves.toEqual({ monthlyBudgetTarget: null });
    await expect(pipe.transform({ monthlyBudgetTarget: null, monthlyIncomeTarget: 5 }, asBody)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still needs the field sent', async () => {
    expect(await errorsFor({})).toEqual(['monthlyBudgetTarget']);
  });

  it('refuses what is not an amount, as before', async () => {
    for (const monthlyBudgetTarget of [0, -500, 12.345, 1e-7, 1_000_000_000_000, '25000', 'null', false]) {
      expect(await errorsFor({ monthlyBudgetTarget })).toEqual(['monthlyBudgetTarget']);
    }
  });
});
