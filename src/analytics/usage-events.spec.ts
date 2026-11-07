import { classifyDeviceType, firstWithin } from './usage-events.js';
import { UsageEventsService } from './usage-events.service.js';

describe('classifyDeviceType', () => {
  it('tells phones, tablets and computers apart', () => {
    expect(classifyDeviceType('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148')).toBe('MOBILE');
    expect(classifyDeviceType('Mozilla/5.0 (iPad; CPU OS 17_0)')).toBe('TABLET');
    expect(classifyDeviceType('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('DESKTOP');
    expect(classifyDeviceType(null)).toBe('DESKTOP');
  });
});

describe('firstWithin', () => {
  it('lets a key through once per window', () => {
    const recent = new Map<string, number>();
    expect(firstWithin(recent, 'a', 1000, 100)).toBe(true);
    expect(firstWithin(recent, 'a', 1050, 100)).toBe(false);
    expect(firstWithin(recent, 'b', 1050, 100)).toBe(true);
    expect(firstWithin(recent, 'a', 1100, 100)).toBe(true);
  });

  it('stays within its size', () => {
    const recent = new Map<string, number>();
    for (let i = 0; i < 10; i++) firstWithin(recent, `k${i}`, 1000 + i, 1_000_000, 3);
    expect(recent.size).toBeLessThanOrEqual(3);
    expect(recent.has('k9')).toBe(true);
  });
});

describe('UsageEventsService', () => {
  // count: someone who turned off "Share usage" (Settings › Data & privacy).
  const setup = (create = vi.fn().mockResolvedValue({ id: 'e1' }), optedOut = 0) => ({
    service: new UsageEventsService({ usageEvent: { create }, user: { count: vi.fn().mockResolvedValue(optedOut) } } as never),
    create,
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const req = { headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Mobile' }, ip: '103.4.145.1' } as never;
  const customer = { id: 'u1', email: 'a@example.com', sessionId: 's1' };

  it('writes the event with the device and country', async () => {
    const { service, create } = setup();
    service.recordFor(customer, req, 'report_viewed', { reportType: 'monthly_breakdown' }, 'monthly_breakdown');
    await settle();
    expect(create).toHaveBeenCalledWith({
      data: { platformUserId: 'u1', eventType: 'report_viewed', metadata: { reportType: 'monthly_breakdown' }, deviceType: 'MOBILE', country: 'Bangladesh' },
      select: { id: true },
    });
  });

  it('counts a repeated view once, and skips a View as customer session', async () => {
    const { service, create } = setup();
    service.recordFor(customer, req, 'report_viewed', undefined, 'k');
    service.recordFor(customer, req, 'report_viewed', undefined, 'k');
    service.recordFor({ ...customer, id: 'u2', impersonatedBy: 'admin-1' }, req, 'report_viewed', undefined, 'k');
    await settle();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('counts nothing for someone who turned sharing off', async () => {
    const { service, create } = setup(undefined, 1);
    service.record('u1', 'habit_checked_in');
    await settle();
    expect(create).not.toHaveBeenCalled();
  });

  it('never throws when the write fails', async () => {
    const { service } = setup(vi.fn().mockRejectedValue(new Error('db down')));
    expect(() => service.record('u1', 'habit_checked_in')).not.toThrow();
    await settle();
  });
});
