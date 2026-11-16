import { PeriodReportController } from './money-flow.controller.js';

// Reports' period page: its events section only for the members the events
// API itself is open to.
describe('PeriodReportController', () => {
  const run = async (role: string) => {
    const periodReport = { report: vi.fn().mockResolvedValue({}) };
    const controller = new PeriodReportController(periodReport as never);
    await controller.report('biz-1', { dateFrom: '2026-11-01', dateTo: '2026-11-30' } as never, { businessId: 'biz-1', userId: 'u1', role } as never);
    return periodReport.report.mock.calls[0][4];
  };

  it.each([
    ['OWNER', true],
    ['ACCOUNTANT', true],
    ['STAFF', false],
  ])('%s gets events: %s', async (role, withEvents) => {
    expect(await run(role)).toBe(withEvents);
  });
});
