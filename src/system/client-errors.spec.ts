import { ValidationPipe, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { NoNulPipe } from '../common/no-nul.pipe.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import { ClientErrorsController } from './client-errors.controller.js';
import { ReportClientErrorDto } from './dto/report-client-error.dto.js';
import { ErrorLogsService } from './error-logs.service.js';

const SERVER_RENDER_ERROR =
  'An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details. A digest property is included on this error instance which may provide additional details about the nature of the error.';

const setup = () => {
  const prisma = { errorLog: { create: vi.fn((args: { data: object }) => Promise.resolve({ id: 'log-1', ...args.data })) } };
  return { service: new ErrorLogsService(prisma as never), prisma };
};

const written = (prisma: ReturnType<typeof setup>['prisma']) => prisma.errorLog.create.mock.calls[0][0].data as { metadata: Record<string, unknown> };

describe('ErrorLogsService.reportCustomerError', () => {
  it('writes one frontend row marked as the customer app, with who sent it and from where', async () => {
    const { service, prisma } = setup();
    await service.reportCustomerError('user-1', { message: SERVER_RENDER_ERROR, digest: '2683523098', path: '/dashboard/transactions' }, { ipAddress: '203.0.113.9', userAgent: 'Mozilla/5.0 Chrome/141' });
    expect(prisma.errorLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.errorLog.create).toHaveBeenCalledWith({
      data: {
        source: 'ADMIN_FRONTEND',
        severity: 'MEDIUM',
        message: SERVER_RENDER_ERROR,
        metadata: { app: 'customer', userId: 'user-1', ipAddress: '203.0.113.9', userAgent: 'Mozilla/5.0 Chrome/141', digest: '2683523098', path: '/dashboard/transactions' },
      },
    });
  });

  it('never stores the query string or fragment of the page', async () => {
    const { service, prisma } = setup();
    await service.reportCustomerError('user-1', { message: 'Boom', path: '/reset-password?token=secret#top' }, { ipAddress: '203.0.113.9' });
    expect(written(prisma).metadata.path).toBe('/reset-password');
    expect(JSON.stringify(written(prisma))).not.toContain('secret');
  });

  it('records an unknown address, and leaves out what was not sent', async () => {
    const { service, prisma } = setup();
    await service.reportCustomerError('user-1', { message: 'Boom', digest: '' }, {});
    expect(written(prisma).metadata).toEqual({ app: 'customer', userId: 'user-1', ipAddress: 'unknown' });
  });

  it('cuts an oversized User-Agent', async () => {
    const { service, prisma } = setup();
    await service.reportCustomerError('user-1', { message: 'Boom' }, { ipAddress: '203.0.113.9', userAgent: 'x'.repeat(5000) });
    expect(written(prisma).metadata.userAgent).toHaveLength(500);
  });
});

describe('ReportClientErrorDto', () => {
  // The global ValidationPipe's options: unknown fields are refused.
  const errorsFor = (body: object) => validate(plainToInstance(ReportClientErrorDto, body), { whitelist: true, forbidNonWhitelisted: true });

  it.each([
    { message: 'Boom' },
    { message: SERVER_RENDER_ERROR, digest: '2683523098', path: '/dashboard' },
    { message: 'x'.repeat(500), digest: 'd'.repeat(64), path: `/${'p'.repeat(299)}` },
  ])('accepts %#', async (body) => {
    expect(await errorsFor(body)).toHaveLength(0);
  });

  it('trims what it keeps', () => {
    expect(plainToInstance(ReportClientErrorDto, { message: '  Boom \n', digest: ' 123 ', path: ' /home ' })).toEqual({ message: 'Boom', digest: '123', path: '/home' });
  });

  it.each([
    ['no message', {}],
    ['a blank message', { message: '   ' }],
    ['a message that is not text', { message: 42 }],
    ['a message over 500 characters', { message: 'x'.repeat(501) }],
    ['a digest over 64 characters', { message: 'Boom', digest: 'd'.repeat(65) }],
    ['a null digest', { message: 'Boom', digest: null }],
    ['a path over 300 characters', { message: 'Boom', path: `/${'p'.repeat(300)}` }],
    ['a path that is not a path', { message: 'Boom', path: 'https://example.com/home' }],
    ['a field it does not know', { message: 'Boom', stackTrace: 'at x (y.js:1:1)' }],
  ])('refuses %s', async (_, body) => {
    expect((await errorsFor(body)).length).toBeGreaterThan(0);
  });
});

describe('ClientErrorsController', () => {
  const customer = { id: 'user-1', email: 'user@example.com', sessionId: 'session-1' };

  it('logs the report as the signed-in customer, from their address and browser, with no body back', async () => {
    const errorLogs = { reportCustomerError: vi.fn().mockResolvedValue({ id: 'log-1' }) };
    const controller = new ClientErrorsController(errorLogs as never);
    const req = { ip: '203.0.113.9', headers: { 'user-agent': 'Mozilla/5.0' } };
    await expect(controller.report(customer, { message: 'Boom', digest: '123' }, req as never)).resolves.toBeUndefined();
    expect(errorLogs.reportCustomerError).toHaveBeenCalledWith('user-1', { message: 'Boom', digest: '123' }, { ipAddress: '203.0.113.9', userAgent: 'Mozilla/5.0' });
  });

  it('is a customer route behind UserAuthGuard', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ClientErrorsController)).toBe('api/client-errors');
    expect(Reflect.getMetadata(GUARDS_METADATA, ClientErrorsController)).toEqual([UserAuthGuard]);
  });

  // Over HTTP: the app's own throttlers and global pipes, a signed-in
  // customer standing in for UserAuthGuard, no database.
  describe('POST /api/client-errors', () => {
    let app: INestApplication<App>;
    const errorLogs = { reportCustomerError: vi.fn() };
    const post = (body: object) => request(app.getHttpServer()).post('/api/client-errors').set('User-Agent', 'Mozilla/5.0').send(body);

    beforeEach(async () => {
      errorLogs.reportCustomerError.mockReset().mockResolvedValue({ id: 'log-1' });
      const moduleRef = await Test.createTestingModule({
        imports: [
          ThrottlerModule.forRoot([
            { name: 'default', ttl: 60_000, limit: 100 },
            { name: 'perIp', ttl: 60_000, limit: 100 },
          ]),
        ],
        controllers: [ClientErrorsController],
        providers: [{ provide: ErrorLogsService, useValue: errorLogs }, { provide: APP_GUARD, useClass: ThrottlerGuard }],
      })
        .overrideGuard(UserAuthGuard)
        .useValue({
          canActivate: (context: ExecutionContext) => {
            context.switchToHttp().getRequest().user = customer;
            return true;
          },
        })
        .compile();
      app = moduleRef.createNestApplication();
      app.useGlobalPipes(new NoNulPipe(), new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
      await app.init();
    });

    afterEach(() => app.close());

    it('answers 204 with no body and logs the report', async () => {
      const response = await post({ message: ' Boom ', digest: '2683523098', path: '/dashboard' }).expect(204);
      expect(response.text).toBe('');
      expect(errorLogs.reportCustomerError).toHaveBeenCalledWith(
        'user-1',
        { message: 'Boom', digest: '2683523098', path: '/dashboard' },
        { ipAddress: expect.any(String), userAgent: 'Mozilla/5.0' },
      );
    });

    it.each([
      ['a message over 500 characters', { message: 'x'.repeat(501) }],
      ['a stack trace', { message: 'Boom', stackTrace: 'at x (y.js:1:1)' }],
      ['a NUL character', { message: 'Bo\u0000om' }],
    ])('answers 400 to %s and logs nothing', async (_, body) => {
      await post(body).expect(400);
      expect(errorLogs.reportCustomerError).not.toHaveBeenCalled();
    });

    it('takes 10 reports a minute from one address, then answers 429', async () => {
      for (let i = 0; i < 10; i++) await post({ message: `Boom ${i}` }).expect(204);
      await post({ message: 'Boom 10' }).expect(429);
      expect(errorLogs.reportCustomerError).toHaveBeenCalledTimes(10);
    });
  });
});
