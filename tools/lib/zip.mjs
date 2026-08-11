// zip.mjs — a minimal, dependency-free ZIP writer.
//
// Why this exists rather than a package or a shell command:
//
//  * A package is not an option. This repository's "zero third-party code
//    dependencies" claim is not marketing — it is enforced by
//    docs-consistency.mjs's DC6, and adding an archiver would break it.
//  * `zip` on the PATH is not an option either. It exists on macOS and Linux
//    but not on a stock Windows runner, and the release packaging has to run
//    identically on all three (the repo has already been bitten repeatedly by
//    platform-shaped bugs that a Linux-only build could never reveal — see
//    .github/workflows/ci.yml's own comment on why its matrix is OS-broad
//    rather than Node-broad). Shelling out to PowerShell's Compress-Archive on
//    Windows and `zip` elsewhere would mean two different implementations
//    producing two different archives, tested unevenly.
//
// So: one implementation, Node standard library only, identical everywhere.
// ZIP is a simple, stable, well-documented container and only the small subset
// below is needed. No ZIP64 (every file shipped here is far under 4GB, and
// exceeding it would be a bug worth failing on rather than silently handling).
//
// Requires Node 22.2.0+ for zlib.crc32, which is well under this repo's own
// floor (.nvmrc says 24; CI's oldest leg is 22, whose current release includes
// it). Computing CRC-32 by hand instead would be a second implementation of
// something the platform now provides.
//
// Reproducibility: every entry is stamped with a FIXED timestamp
// (1980-01-01 00:00, the earliest a ZIP can represent) rather than the real
// clock. Two builds from identical sources therefore produce byte-identical
// archives, which is what makes the published SHA256SUMS file worth anything —
// a checksum that changes on every rebuild proves nothing about the contents.

import zlib from 'node:zlib';

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
// DOS date/time for 1980-01-01 00:00:00 — the ZIP epoch. Fixed on purpose; see
// the reproducibility note above.
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/**
 * @param {Array<{name: string, data: Buffer|string, mode?: number}>} entries
 *   `name` uses forward slashes always (the ZIP spec requires it, regardless of
 *   the platform building the archive — a backslash here produces an archive
 *   that unpacks into a single oddly-named file on macOS and Linux).
 *   `mode` is the Unix permission bits, defaulting to 0o644. Pass 0o755 for
 *   anything that must stay executable after being unzipped, such as an install
 *   script — a shell script that arrives without its executable bit is a
 *   confusing failure for exactly the non-technical user this repo is for.
 * @returns {Buffer} the complete archive
 */
export function createZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    if (typeof entry.name !== 'string' || entry.name.length === 0) {
      throw new Error('zip: every entry needs a name');
    }
    if (entry.name.includes('\\')) {
      throw new Error(`zip: entry name must use forward slashes, got "${entry.name}"`);
    }
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    if (raw.length > 0xffffffff) {
      throw new Error(`zip: "${entry.name}" is too large for a non-ZIP64 archive`);
    }
    const crc = zlib.crc32(raw);

    // Deflate, but keep whichever is smaller. Compressing an already-compressed
    // file (a .png, a .woff2 — both of which this repo ships) reliably makes it
    // very slightly bigger, and storing it instead is both smaller and faster.
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4); // version needed to extract: 2.0
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    chunks.push(local, nameBuf, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(CENTRAL_SIG, 0);
    // "version made by": 3 (Unix) in the high byte, so the external attributes
    // below are read as Unix permissions rather than ignored as DOS attributes.
    // This is the part that actually makes the executable bit survive.
    cd.writeUInt16LE((3 << 8) | 20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk number start
    cd.writeUInt16LE(0, 36); // internal attributes
    cd.writeUInt32LE(((entry.mode || 0o644) & 0xffff) << 16, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4); // this disk
  eocd.writeUInt16LE(0, 6); // disk with central directory
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...chunks, centralBuf, eocd]);
}
