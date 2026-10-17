/**
 * KKnD .LVL archive index (port of tools/gamedata.py lvl_index).
 * Returns { data, files: { name: [offset, size] } }; offsets point into `data`, the contents after
 * the 8-byte DATA header, which is also what MOBD pointers are relative to.
 * `names` maps "<index>.<type>" to file names (OpenKrush's archives/sprites.lvl.yaml).
 */
export function lvlIndex(raw, names = {}) {
  let data = raw;
  if (raw[0] === 0x44 && raw[1] === 0x41 && raw[2] === 0x54 && raw[3] === 0x41) {
    const size = (raw[4] << 24) | (raw[5] << 16) | (raw[6] << 8) | raw[7];
    data = raw.subarray(8, 8 + size);
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const i32 = (p) => dv.getInt32(p, true);
  const typeList = i32(0);
  const files = {};
  let pos = typeList;
  let firstList = 0;
  for (let n = 0; n < 1000; n++) {
    if (pos + 8 > data.length) break;
    const type = String.fromCharCode(data[pos], data[pos + 1], data[pos + 2], data[pos + 3]).toLowerCase();
    const listOff = i32(pos + 4);
    pos += 8;
    if (listOff === 0) break;
    if (firstList === 0) firstList = listOff;
    let listEnd = pos + 4 <= data.length ? i32(pos) : typeList;
    if (listEnd === 0) listEnd = typeList;
    let lp = listOff;
    let prevOff = null;
    let prevName = null;
    let j = 0;
    while (lp + 4 <= listEnd && lp < data.length) {
      const off = i32(lp);
      lp += 4;
      if (off === 0) {
        j++;
        continue;
      }
      if (prevOff !== null) files[prevName] = [prevOff, off - prevOff];
      const key = `${j}.${type}`;
      prevOff = off;
      prevName = names[key] || key;
      j++;
    }
    if (prevOff !== null) files[prevName] = [prevOff, firstList - prevOff];
  }
  return { data, files };
}
