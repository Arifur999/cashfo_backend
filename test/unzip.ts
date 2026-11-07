import { inflateRawSync } from 'node:zlib';

// Reads a .zip back the way an unzip tool would: the central directory,
// then each file's local header and its deflated bytes. For the export
// specs (.zip and .xlsx).
export function unzip(zip: Buffer): Record<string, string> {
  const end = zip.length - 22;
  if (zip.readUInt32LE(end) !== 0x06054b50) throw new Error('No end of central directory');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('Bad central directory entry');
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const offset = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const localNameLength = zip.readUInt16LE(offset + 26);
    const start = offset + 30 + localNameLength;
    files[name] = inflateRawSync(zip.subarray(start, start + size)).toString('utf8');
    at += 46 + nameLength;
  }
  return files;
}
