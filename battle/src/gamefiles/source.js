/**
 * Get SPRITES.LVL out of whatever file the player gives us:
 *   SPRITES.LVL itself (KKnD Xtreme from GOG / Steam / CD, or the original KKnD CD),
 *   KKND_XT.EXE (the free official demo installer), its data1.cab, or a ZIP holding any of them.
 *
 * The demo installer is a self-extracting archive with a ZIP after the program (at 0xB7B95, see
 * OpenKrush's DemoLoader); the ZIP holds an InstallShield v5 cabinet. `readCab` is a port of
 * tools/gamedata.py InstallShieldCab (after OpenRA's InstallShieldCABCompression, GPL-3.0),
 * single volume only.
 */

const DEMO_SPRITES = 'multiplayer levels\\levels\\640\\sprites.lvl';
const BACKSLASH = '\\';

const u16 = (d, p) => d[p] | (d[p + 1] << 8);
const u32 = (d, p) => (d[p] | (d[p + 1] << 8) | (d[p + 2] << 16) | (d[p + 3] << 24)) >>> 0;
const magic = (d, p, s) => p >= 0 && [...s].every((c, i) => d[p + i] === c.charCodeAt(0));

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function asciiz(d, p) {
  let e = p;
  while (d[e]) e++;
  return String.fromCharCode(...d.subarray(p, e));
}

/**
 * ZIP directories in a buffer, last first: [{ lowercased name: { method, size, csize, dataOffset } }].
 * A self-extracting installer can hold more than one archive, so every end-of-directory record counts.
 */
function zipDirectories(d) {
  const dirs = [];
  for (let eocd = d.length - 22; eocd >= 0 && dirs.length < 8; eocd--) {
    if (d[eocd] !== 0x50 || !magic(d, eocd, 'PK\x05\x06')) continue;
    const count = u16(d, eocd + 10);
    const cdSize = u32(d, eocd + 12);
    // offsets are relative to the ZIP's own start, which may be inside a larger file
    const base = eocd - cdSize - u32(d, eocd + 16);
    if (base < 0) continue;
    const out = {};
    let p = eocd - cdSize;
    for (let i = 0; i < count && magic(d, p, 'PK\x01\x02'); i++) {
      const nameLen = u16(d, p + 28);
      const local = base + u32(d, p + 42);
      const name = String.fromCharCode(...d.subarray(p + 46, p + 46 + nameLen)).toLowerCase().split('/').join(BACKSLASH);
      out[name] = {
        method: u16(d, p + 10),
        csize: u32(d, p + 20),
        size: u32(d, p + 24),
        dataOffset: local + 30 + u16(d, local + 26) + u16(d, local + 28),
      };
      p += 46 + nameLen + u16(d, p + 30) + u16(d, p + 32);
    }
    if (Object.keys(out).length) dirs.push(out);
  }
  return dirs;
}

async function zipRead(d, e) {
  const raw = d.subarray(e.dataOffset, e.dataOffset + e.csize);
  if (e.method === 0) return raw;
  if (e.method === 8) return inflateRaw(raw);
  throw new Error(`unsupported ZIP compression ${e.method}`);
}

/** InstallShield v5/6 cabinet: { lowercased "group\dir\file": async read() }. */
function readCab(d) {
  if (!magic(d, 0, 'ISc(')) throw new Error('not an InstallShield cabinet');
  const v = u32(d, 4);
  let version = 0;
  if (v >>> 24 === 1) version = (v >>> 12) & 0xf;
  else if (v >>> 24 === 2 || v >>> 24 === 4) version = v & 0xffff ? Math.floor((v & 0xffff) / 100) : 0;
  const cab = u32(d, 12);
  let p = cab + 12;
  const fileTable = u32(d, p);
  const dirCount = u32(d, p + 16);
  const fileTable2 = u32(d, p + 32);
  p += 36 + 14;
  const table = cab + fileTable;
  const dirs = [];
  for (let i = 0; i < dirCount; i++) dirs.push(asciiz(d, table + u32(d, table + 4 * i)));
  const groups = [];
  for (let g = 0; g < 71; g++) {
    let next = u32(d, p + 4 * g);
    while (next) {
      const desc = u32(d, cab + next + 4);
      next = u32(d, cab + next + 8);
      let q = cab + desc;
      const name = asciiz(d, cab + u32(d, q));
      q += 4 + 18 + (version <= 5 ? 54 : 0);
      groups.push([name, u32(d, q), u32(d, q + 4)]);
    }
  }
  const files = {};
  for (const [gname, first, last] of groups) {
    for (let i = first; i <= last; i++) {
      let nameOff, dirIdx, flags, expanded, compressed, dataOff;
      if (version <= 5) {
        const q = table + u32(d, table + fileTable2 + i * 4);
        [nameOff, dirIdx, flags] = [u32(d, q), u32(d, q + 4), u16(d, q + 8)];
        [expanded, compressed, dataOff] = [u32(d, q + 10), u32(d, q + 14), u32(d, q + 38)];
      } else {
        const q = table + fileTable2 + i * 0x57;
        [flags, expanded, compressed, dataOff] = [u16(d, q), u32(d, q + 2), u32(d, q + 10), u32(d, q + 18)];
        [nameOff, dirIdx] = [u32(d, q + 58), u16(d, q + 62)];
      }
      if (flags & 0x8) continue; // invalid entry
      const name = [gname, dirs[dirIdx], asciiz(d, table + nameOff)].join(BACKSLASH).toLowerCase();
      files[name] = async () => {
        if (flags & 0x2) throw new Error('obfuscated cabinet files are not supported');
        if (!(flags & 0x4)) return d.subarray(dataOff, dataOff + expanded);
        // a series of [uint16 size][raw deflate block], each inflated on its own
        const out = new Uint8Array(expanded);
        let o = 0;
        for (let q = dataOff, end = dataOff + compressed; q < end; ) {
          const n = u16(d, q);
          q += 2;
          const block = await inflateRaw(d.subarray(q, q + n));
          out.set(block.subarray(0, expanded - o), o);
          o += block.length;
          q += n;
        }
        if (o !== expanded) throw new Error(`${name}: expanded to ${o} bytes, expected ${expanded}`);
        return out;
      };
    }
  }
  return files;
}

async function fromCab(d) {
  const files = readCab(d);
  const suffix = ['', '640', 'sprites.lvl'].join(BACKSLASH);
  const key = files[DEMO_SPRITES] ? DEMO_SPRITES : Object.keys(files).find((k) => k.endsWith(suffix));
  if (!key) throw new Error('this installer does not contain SPRITES.LVL');
  return files[key]();
}

async function fromZip(d, entries) {
  const names = Object.keys(entries);
  const lvl = names.find((n) => n.endsWith('sprites.lvl'));
  if (lvl) return zipRead(d, entries[lvl]);
  const cab = names.find((n) => n.endsWith('data1.cab'));
  if (cab) return fromCab(await zipRead(d, entries[cab]));
  const exe = names.find((n) => n.endsWith('kknd_xt.exe'));
  if (exe) return extractSpritesLvl(await zipRead(d, entries[exe]));
  throw new Error('no SPRITES.LVL, data1.cab or KKND_XT.EXE in this ZIP');
}

/** Bytes of any supported file -> SPRITES.LVL bytes (throws with a readable message otherwise). */
export async function extractSpritesLvl(d) {
  if (magic(d, 0, 'DATA')) return d;
  if (magic(d, 0, 'ISc(')) return fromCab(d);
  if (magic(d, 0, 'MZ') || magic(d, 0, 'PK')) {
    // a ZIP, or a self-extracting installer with the ZIP after the program
    let error = null;
    for (const entries of zipDirectories(d)) {
      try {
        return await fromZip(d, entries);
      } catch (e) {
        error = e;
      }
    }
    if (magic(d, 0, 'MZ')) throw new Error('this program is not the KKnD Xtreme demo installer (KKND_XT.EXE)');
    if (error) throw error;
  }
  throw new Error('not SPRITES.LVL or the KKnD Xtreme demo (KKND_XT.EXE)');
}
