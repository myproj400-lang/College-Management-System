import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const FILE_ROOT = path.resolve(process.cwd(), '.admissions-files');

const MAGIC: Record<string, (bytes: Buffer) => boolean> = {
  'application/pdf': (bytes) => bytes.subarray(0, 5).toString('utf8') === '%PDF-',
  'image/jpeg': (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/png': (bytes) =>
    bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47,
};

export function contentMatches(contentType: string, bytes: Buffer): boolean {
  const check = MAGIC[contentType];
  return Boolean(check && check(bytes));
}

export function newStorageKey(): string {
  return randomBytes(16).toString('hex');
}

export function storedPath(storageKey: string): string {
  if (!/^[a-f0-9]{32}$/.test(storageKey)) {
    throw new Error('Invalid storage key');
  }
  const full = path.resolve(FILE_ROOT, storageKey);
  const relative = path.relative(FILE_ROOT, full);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid storage key');
  }
  return full;
}

export async function writeStored(storageKey: string, bytes: Buffer): Promise<void> {
  await mkdir(FILE_ROOT, { recursive: true });
  await writeFile(storedPath(storageKey), bytes);
}

export async function readStored(storageKey: string): Promise<Buffer> {
  return readFile(storedPath(storageKey));
}

export async function removeStored(storageKey: string): Promise<void> {
  await rm(storedPath(storageKey), { force: true });
}

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 80);
  return cleaned || 'document';
}
