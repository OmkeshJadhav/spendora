import "server-only";

import { deflateRawSync } from "node:zlib";

/**
 * A minimal ZIP writer, used only to package an XLSX (see `xlsx.ts`).
 *
 * An `.xlsx` file is a ZIP of XML parts, so writing one needs a container. The
 * choice was between a spreadsheet library and this file. §3 of the
 * specification says not to add libraries that earn less than they cost, and
 * this export needs one sheet, nine columns and two number formats — a
 * fraction of any library's surface, against a dependency tree that would
 * dwarf the rest of the application's.
 *
 * So: about a hundred lines of a very stable, very well-documented format
 * (PKWARE APPNOTE 6.3.x), with no dependency and nothing to keep patched.
 * Every entry is deflated with Node's own zlib.
 *
 * Deliberately not general. No directories, no ZIP64, no encryption, no
 * archives above 4 GB — an export of a month of expenses is kilobytes, and the
 * limits are enforced below rather than left as an assumption.
 */

export type ZipEntry = {
  /** Path inside the archive, e.g. `xl/worksheets/sheet1.xml`. */
  path: string;
  data: Uint8Array;
};

/** ZIP stores sizes and offsets as unsigned 32-bit fields. */
const MAX_ZIP_BYTES = 0xffffffff;

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

/** 2.0 — the version that introduced deflate, which is all this uses. */
const VERSION_NEEDED = 20;

/** Bit 11: names and comments are UTF-8. */
const FLAG_UTF8 = 0x0800;

const METHOD_DEFLATE = 8;

/**
 * A fixed MS-DOS timestamp: 1 January 1980, the earliest the format can hold.
 *
 * Deliberately not the current time. Two exports of the same expenses should
 * be the same bytes — that makes the output testable, and a modification time
 * on a part inside a generated document is noise rather than information.
 */
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

let crcTable: Uint32Array | null = null;

/** The standard CRC-32 table (polynomial 0xEDB88320), built once on demand. */
function table(): Uint32Array {
  if (crcTable) {
    return crcTable;
  }

  const built = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    built[index] = value >>> 0;
  }

  crcTable = built;

  return built;
}

/** CRC-32 of a buffer, as ZIP's central and local headers require. */
function crc32(data: Uint8Array): number {
  const lookup = table();
  let crc = 0xffffffff;

  for (const byte of data) {
    crc = lookup[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Packages entries into a ZIP archive.
 *
 * The layout is the format's: every entry as a local header followed by its
 * compressed bytes, then a central directory repeating those headers with the
 * offset each one was written at, then the end-of-central-directory record
 * that says where the directory starts. A reader works backwards from the last
 * of those, which is why the offsets have to be recorded as we go.
 */
export function createZip(entries: readonly ZipEntry[]): Uint8Array {
  const prepared = entries.map((entry) => {
    const name = Buffer.from(entry.path, "utf8");
    const compressed = deflateRawSync(entry.data);

    if (entry.data.length > MAX_ZIP_BYTES || compressed.length > MAX_ZIP_BYTES) {
      // ZIP64 is the answer to this, and it is not worth writing for an
      // export that is thousands of times smaller than the limit.
      throw new Error("Export is too large to package.");
    }

    return {
      name,
      compressed,
      crc: crc32(entry.data),
      size: entry.data.length,
    };
  });

  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of prepared) {
    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
    header.writeUInt16LE(VERSION_NEEDED, 4);
    header.writeUInt16LE(FLAG_UTF8, 6);
    header.writeUInt16LE(METHOD_DEFLATE, 8);
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(entry.crc, 14);
    header.writeUInt32LE(entry.compressed.length, 18);
    header.writeUInt32LE(entry.size, 22);
    header.writeUInt16LE(entry.name.length, 26);
    header.writeUInt16LE(0, 28); // No extra field.

    local.push(header, entry.name, entry.compressed);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
    directory.writeUInt16LE(VERSION_NEEDED, 4); // Version made by.
    directory.writeUInt16LE(VERSION_NEEDED, 6); // Version needed.
    directory.writeUInt16LE(FLAG_UTF8, 8);
    directory.writeUInt16LE(METHOD_DEFLATE, 10);
    directory.writeUInt16LE(DOS_TIME, 12);
    directory.writeUInt16LE(DOS_DATE, 14);
    directory.writeUInt32LE(entry.crc, 16);
    directory.writeUInt32LE(entry.compressed.length, 20);
    directory.writeUInt32LE(entry.size, 24);
    directory.writeUInt16LE(entry.name.length, 28);
    directory.writeUInt16LE(0, 30); // Extra field length.
    directory.writeUInt16LE(0, 32); // Comment length.
    directory.writeUInt16LE(0, 34); // Disk number: single-disk archive.
    directory.writeUInt16LE(0, 36); // Internal attributes.
    directory.writeUInt32LE(0, 38); // External attributes.
    directory.writeUInt32LE(offset, 42);

    central.push(directory, entry.name);

    offset += 30 + entry.name.length + entry.compressed.length;

    if (offset > MAX_ZIP_BYTES) {
      throw new Error("Export is too large to package.");
    }
  }

  const centralBytes = Buffer.concat(central);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  end.writeUInt16LE(0, 4); // This disk.
  end.writeUInt16LE(0, 6); // Disk the directory starts on.
  end.writeUInt16LE(prepared.length, 8);
  end.writeUInt16LE(prepared.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16); // Where the central directory begins.
  end.writeUInt16LE(0, 20); // Archive comment length.

  return Buffer.concat([...local, centralBytes, end]);
}
