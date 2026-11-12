import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type SavingsPlan } from '@prisma/client';
import { dhakaDateKey, dhakaDateOnly } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateSavingsPlanDto } from './dto/create-savings-plan.dto.js';
import { UpdateSavingsPlanDto } from './dto/update-savings-plan.dto.js';
import { planMonthly, planNeedBy } from './plan-math.js';

const dayOf = (date: Date) => date.toISOString().slice(0, 10);

// Savings Goals > Saving plans. A plan is a note of something to save for
// later: no money moves until it is started as a goal
// (SavingsGoalsService.create() with fromPlanId removes it in the same
// database transaction), and a goal with nothing in it yet can come back
// (SavingsGoalsService.moveToPlans()).
@Injectable()
export class SavingsPlansService {
  constructor(private readonly prisma: PrismaService) {}

  async list(businessId: string) {
    const plans = await this.prisma.savingsPlan.findMany({ where: { businessId }, orderBy: [{ plannedOn: 'desc' }, { createdAt: 'desc' }] });
    const today = dhakaDateKey(new Date());
    return plans.map((plan) => this.toView(plan, today));
  }

  async create(businessId: string, dto: CreateSavingsPlanDto) {
    const plan = await this.prisma.savingsPlan.create({
      data: {
        businessId,
        name: dto.name,
        category: dto.category ?? 'others',
        color: dto.color,
        amount: dto.amount,
        horizon: dto.horizon,
        needBy: dto.horizon === 'BY_DATE' && dto.needBy ? new Date(dto.needBy.slice(0, 10)) : null,
        priority: dto.priority ?? 'MEDIUM',
        note: dto.note || null,
        link: dto.link || null,
        plannedOn: dto.plannedOn ? new Date(dto.plannedOn.slice(0, 10)) : dhakaDateOnly(new Date()),
      },
    });
    return this.toView(plan, dhakaDateKey(new Date()));
  }

  async update(businessId: string, id: string, dto: UpdateSavingsPlanDto) {
    const current = await this.require(businessId, id);
    const horizon = dto.horizon ?? current.horizon;
    const needBy = horizon !== 'BY_DATE' ? null : dto.needBy ? new Date(dto.needBy.slice(0, 10)) : current.needBy;
    if (horizon === 'BY_DATE' && !needBy) throw new BadRequestException('Pick the date you need it by.');
    const plan = await this.prisma.savingsPlan.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.note !== undefined && { note: dto.note || null }),
        ...(dto.link !== undefined && { link: dto.link || null }),
        horizon,
        needBy,
      },
    });
    return this.toView(plan, dhakaDateKey(new Date()));
  }

  async delete(businessId: string, id: string) {
    await this.require(businessId, id);
    await this.prisma.savingsPlan.delete({ where: { id } });
    return { id };
  }

  async require(businessId: string, id: string, client: Prisma.TransactionClient = this.prisma) {
    const plan = await client.savingsPlan.findUnique({ where: { id } });
    if (!plan || plan.businessId !== businessId) throw new NotFoundException('That saving plan was not found. It may have been started or deleted.');
    return plan;
  }

  // A plan as the page shows it: its amount, the day it is needed by and
  // what starting it today means a month (both counted from today).
  toView(plan: SavingsPlan, today: string) {
    const amount = new Prisma.Decimal(plan.amount);
    const shape = { horizon: plan.horizon, needBy: plan.needBy ? dayOf(plan.needBy) : null };
    return {
      id: plan.id,
      name: plan.name,
      category: plan.category,
      color: plan.color,
      amount: amount.toFixed(2),
      horizon: plan.horizon,
      needBy: shape.needBy,
      priority: plan.priority,
      note: plan.note,
      link: plan.link,
      plannedOn: dayOf(plan.plannedOn),
      neededBy: planNeedBy(shape, today),
      monthly: planMonthly({ ...shape, amount: amount.toNumber() }, today).toFixed(2),
    };
  }
}
