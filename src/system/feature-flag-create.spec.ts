import { FeatureFlagsService } from './feature-flags.service.js';

describe('creating a feature flag', () => {
  it('writes it to the audit log, since it can turn a feature on at once', async () => {
    const created = { id: 'f1', key: 'pdf_export', isEnabled: true, rolloutPercent: 100, targetPlanIds: ['plan-pro'] };
    const prisma = {
      featureFlag: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(created) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new FeatureFlagsService(prisma as never);
    await expect(service.create({ key: 'pdf_export', name: 'PDF export', isEnabled: true } as never, 'admin-1', '1.2.3.4')).resolves.toBe(created);
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'FEATURE_FLAG_CREATED',
      entityId: 'f1',
      newValue: { key: 'pdf_export', isEnabled: true, rolloutPercent: 100, targetPlanIds: ['plan-pro'] },
      ipAddress: '1.2.3.4',
    });
  });
});
