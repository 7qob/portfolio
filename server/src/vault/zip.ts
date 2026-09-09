/**
 * A store-only ZIP writer, in one file and with no dependency.
 *
 * The vault holds a handful of PDFs. A PDF is already compressed, so deflating
 * it again buys a percent or two and costs a dependency, a lockfile entry and
 * an image rebuild — this writes the entries stored, which needs nothing but
 * Buffer. Everything is held in memory and the caller caps the total, so there
 * is no ZIP64 case to handle: the guards below refuse rather than emit an
 * archive that only some unzippers can read.
 */

const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const END_RECORD = 22;

/** Bit 11 of the general-purpose flags: names and comments are UTF-8. */
const UTF8_NAMES = 0x0800;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = -1;
  for (let i = 0; i < buffer.length; i++) {
    c = CRC_TABLE[(c ^ buffer[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

/**
 * MS-DOS date and time, which is what a ZIP entry carries: two-second
 * resolution and an epoch of 1980. Anything older than that is clamped, since
 * the format has no way to say it.
 */
function dosStamp(date: Date): { time: number; date: number } {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time:
      ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff,
    date: (((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff,
  };
}

export interface ZipEntry {
  /** The name inside the archive. Forward slashes only, no leading slash. */
  name: string;
  data: Buffer;
  modified?: Date;
}

export function zipStore(entries: ZipEntry[]): Buffer {
  if (entries.length > 0xffff) {
    throw new RangeError('Too many entries for a non-ZIP64 archive.');
  }

  const body: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const size = entry.data.length;

    if (offset + LOCAL_HEADER + name.length + size > 0xffffffff) {
      throw new RangeError('Archive is too large for a non-ZIP64 archive.');
    }

    const crc = crc32(entry.data);
    const stamp = dosStamp(entry.modified ?? new Date());

    const local = Buffer.alloc(LOCAL_HEADER);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed
    local.writeUInt32LE(size, 22); // uncompressed
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    body.push(local, name, entry.data);

    const central = Buffer.alloc(CENTRAL_HEADER);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(UTF8_NAMES, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);

    offset += LOCAL_HEADER + name.length + size;
  }

  const central = Buffer.concat(directory);

  const end = Buffer.alloc(END_RECORD);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with the directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...body, central, end]);
}
