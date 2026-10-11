import { DiscountType, type PrismaClient } from '@prisma/client';

export async function seedDemoCoupons(prisma: PrismaClient) {
  const now = new Date();
  const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const coupons = [
    {
      code: 'WELCOME20',
      discountType: DiscountType.PERCENTAGE,
      discountValue: 20,
      maxRedemptions: 500,
      validFrom: now,
      validUntil: in90Days,
      applicablePlans: [] as string[],
    },
    {
      code: 'EID50',
      discountType: DiscountType.FIXED_AMOUNT,
      discountValue: 50,
      maxRedemptions: 200,
      validFrom: now,
      validUntil: in90Days,
      applicablePlans: [] as string[],
    },
  ];

  for (const coupon of coupons) {
    await prisma.coupon.upsert({
      where: { code: coupon.code },
      update: {},
      create: coupon,
    });
  }
}
