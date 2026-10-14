import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isMoney } from '../../common/dto.js';
import { toClientError } from './global-exception.filter.js';

const known = (code: string) => new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: 'test' });

describe('toClientError', () => {
  it.each([
    ['P2002', ConflictException],
    ['P2025', NotFoundException],
    ['P2003', BadRequestException],
    ['P2000', BadRequestException],
    ['P2020', BadRequestException],
    ['P2023', BadRequestException],
  ])('turns Prisma %s into a client error', (code, type) => {
    expect(toClientError(known(code))).toBeInstanceOf(type);
  });

  it('turns an argument Prisma rejects (an invalid date) into a 400', () => {
    expect(toClientError(new Prisma.PrismaClientValidationError('Invalid value for argument', { clientVersion: 'test' }))).toBeInstanceOf(BadRequestException);
  });

  it('never repeats Prisma internals to the client', () => {
    expect(JSON.stringify(toClientError(known('P2002'))?.getResponse())).not.toContain('boom');
  });

  it('leaves real server errors alone', () => {
    expect(toClientError(known('P1001'))).toBeUndefined();
    expect(toClientError(new Error('db down'))).toBeUndefined();
  });
});

describe('isMoney', () => {
  it.each([0.01, 1, 12.5, 1500.75, 999_999_999_999.99, 0.1 + 0.2])('accepts %s', (value) => {
    expect(isMoney(value)).toBe(true);
  });

  it.each([0, -5, 0.001, 1e-7, 1e13, 12.345, Number.NaN, Number.POSITIVE_INFINITY, '12', null])('refuses %s', (value) => {
    expect(isMoney(value)).toBe(false);
  });
});

describe('containsNul', () => {
  it('finds a NUL character at any depth', async () => {
    const { containsNul } = await import('../../common/no-nul.pipe.js');
    expect(containsNul({ entries: [{ note: 'a\u0000b' }] })).toBe(true);
    expect(containsNul({ entries: [{ note: 'fine' }], amount: 5 })).toBe(false);
    expect(containsNul('plain')).toBe(false);
  });
});
