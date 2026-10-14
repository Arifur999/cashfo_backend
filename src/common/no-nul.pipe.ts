import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';

// PostgreSQL text can't hold a NUL character: an insert carrying one fails
// with a driver error the app would answer as a 500. Refused up front, for
// every body, query and route parameter.
@Injectable()
export class NoNulPipe implements PipeTransform {
  transform(value: unknown) {
    if (containsNul(value)) {
      throw new BadRequestException('Text cannot contain a NUL character');
    }
    return value;
  }
}

export function containsNul(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  // Uploaded files arrive as Buffers: bytes, not text.
  if (depth > 20 || value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return false;
  return Object.values(value).some((child) => containsNul(child, depth + 1));
}
