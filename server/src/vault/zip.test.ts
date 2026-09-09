import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { zipStore } from './zip';

/**
 * The archive writer is hand-rolled, so it is read back here by hand too.
 *
 * That is the point of these tests rather than an accident of having no unzip
 * library: a round trip through the same code that wrote the file agrees with
 * itself whatever it got wrong. Reading the bytes at the offsets the spec
 * names, and pinning the checksum to the published CRC-32 check vector, is
 * what actually catches a wrong polynomial or a little-endian slip.
 */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;
const END_RECORD = 22;

interface ReadEntry {
  name: string;
  data: Buffer;
  crc: number;
  method: number;
  flags: number;
  dosDate: number;
}

/** A deliberately literal reader: every offset below is from the spec. */
function readZip(buf: Buffer): ReadEntry[] {
  const end = buf.length - END_RECORD;
  assert.equal(buf.readUInt32LE(end), END_SIG, 'end-of-central-directory signature');
  assert.equal(buf.readUInt16LE(end + 20), 0, 'no archive comment');

  const count = buf.readUInt16LE(end + 10);
  assert.equal(buf.readUInt16LE(end + 8), count, 'both entry counts agree');

  const cdSize = buf.readUInt32LE(end + 12);
  const cdStart = buf.readUInt32LE(end + 16);
  assert.equal(cdStart + cdSize, end, 'the directory ends where the end record begins');

  const entries: ReadEntry[] = [];
  let at = cdStart;

  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), CENTRAL_SIG, `central header ${i}`);

    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const dosDate = buf.readUInt16LE(at + 14);
    const crc = buf.readUInt32LE(at + 16);
    const csize = buf.readUInt32LE(at + 20);
    const usize = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const offset = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);

    assert.equal(csize, usize, `${name} is stored, so the two sizes match`);

    // Follow the directory's offset into the local header, which is the only
    // thing an unzipper actually does. A wrong offset here is the classic way
    // to produce an archive that opens in one tool and not in another.
    assert.equal(buf.readUInt32LE(offset), LOCAL_SIG, `local header for ${name}`);
    assert.equal(buf.readUInt32LE(offset + 14), crc, `${name} crc agrees in both headers`);
    assert.equal(
      buf.toString('utf8', offset + 30, offset + 30 + nameLen),
      name,
      `${name} is named the same in both headers`,
    );

    const dataAt = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    entries.push({
      name,
      flags,
      method,
      crc,
      dosDate,
      data: buf.subarray(dataAt, dataAt + csize),
    });

    at += 46 + nameLen + extraLen + commentLen;
  }

  assert.equal(at, end, 'the directory is exactly as long as it claims');
  return entries;
}

const AT = new Date('2024-06-01T12:34:56Z');

describe('zipStore', () => {
  it('round-trips names and bytes', () => {
    const files = [
      { name: 'cv.pdf', data: Buffer.from('%PDF-1.4 first'), modified: AT },
      { name: 'zeugnis.pdf', data: Buffer.from('%PDF-1.4 second, longer'), modified: AT },
    ];

    const entries = readZip(zipStore(files));

    assert.equal(entries.length, 2);
    assert.deepEqual(
      entries.map((e) => e.name),
      ['cv.pdf', 'zeugnis.pdf'],
    );
    assert.equal(entries[0]!.data.toString(), '%PDF-1.4 first');
    assert.equal(entries[1]!.data.toString(), '%PDF-1.4 second, longer');
  });

  /**
   * The check value every CRC-32 implementation is measured against. If the
   * polynomial, the bit order or the final inversion is wrong, this is the
   * assertion that says so, and it says so in one number rather than in a
   * corrupt archive three months from now.
   */
  it('computes the standard CRC-32 check vector', () => {
    const [entry] = readZip(zipStore([{ name: 'a', data: Buffer.from('123456789') }]));
    assert.equal(entry!.crc, 0xcbf43926);
  });

  it('computes a zero CRC for empty content', () => {
    const [entry] = readZip(zipStore([{ name: 'empty', data: Buffer.alloc(0) }]));
    assert.equal(entry!.crc, 0);
    assert.equal(entry!.data.length, 0);
  });

  it('stores rather than deflates, and flags its names as UTF-8', () => {
    const [entry] = readZip(zipStore([{ name: 'a.pdf', data: Buffer.from('x') }]));
    assert.equal(entry!.method, 0, 'method 0 is stored');
    assert.equal(entry!.flags & 0x0800, 0x0800, 'bit 11 marks the name as UTF-8');
  });

  it('keeps a non-ASCII name readable', () => {
    const name = 'lebenslauf-abschlussprüfung.pdf';
    const [entry] = readZip(zipStore([{ name, data: Buffer.from('x') }]));
    assert.equal(entry!.name, name);
  });

  /**
   * A ZIP date has an epoch of 1980 and no way to say "before that". An
   * unclamped 1970 would underflow the year field and produce a date some
   * unzippers reject outright.
   */
  it('clamps a pre-1980 timestamp instead of underflowing the year field', () => {
    const [entry] = readZip(
      zipStore([{ name: 'old.pdf', data: Buffer.from('x'), modified: new Date(0) }]),
    );
    assert.ok(entry!.dosDate >> 9 >= 0, 'the year field is not negative');
    assert.equal(entry!.dosDate >> 9, 0, '1980 is stored as year zero');
  });

  it('writes a well-formed archive with no entries in it', () => {
    // The service refuses to send an empty archive, but the writer should
    // still produce something an unzipper can open rather than 22 bytes of
    // nonsense, so the two failures stay distinguishable.
    const buf = zipStore([]);
    assert.equal(buf.length, END_RECORD);
    assert.deepEqual(readZip(buf), []);
  });

  it('refuses more entries than the format can index', () => {
    const many = Array.from({ length: 0x10000 }, (_, i) => ({
      name: `f${i}`,
      data: Buffer.alloc(0),
    }));
    assert.throws(() => zipStore(many), RangeError);
  });
});
