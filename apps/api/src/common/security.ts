import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function keyedHash(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('hex');
}

export function constantTimeEqual(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function normalizeCourtNumber(value: string): string {
  return value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}
