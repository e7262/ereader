/* 最小 ZIP 讀取器：只做 EPUB 需要的部分（讀中央目錄、取出 stored / deflate 檔案）。
   解壓縮用瀏覽器內建的 DecompressionStream，不需要任何第三方函式庫。 */
(function (R) {
  'use strict';

  const utf8 = new TextDecoder('utf-8');

  async function inflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function decodeText(bytes) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
    return utf8.decode(bytes);
  }

  function open(buffer) {
    const u8 = new Uint8Array(buffer);
    const dv = new DataView(buffer);

    // 從檔尾往回找 End of Central Directory（最多 64KB 註解）
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 0xffff); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 EPUB（找不到 ZIP 目錄）');

    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = new Map();
    const lower = new Map(); // 有些 EPUB 的 href 大小寫和實際檔名不一致

    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('EPUB 的 ZIP 目錄損毀');
      const nameLen = dv.getUint16(p + 28, true);
      const entry = {
        method: dv.getUint16(p + 10, true),
        compSize: dv.getUint32(p + 20, true),
        size: dv.getUint32(p + 24, true),
        offset: dv.getUint32(p + 42, true),
      };
      const name = utf8.decode(u8.subarray(p + 46, p + 46 + nameLen));
      entries.set(name, entry);
      lower.set(name.toLowerCase(), name);
      p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    }

    function find(name) {
      if (entries.has(name)) return name;
      return lower.get(name.toLowerCase()) || null;
    }

    async function bytes(name) {
      const key = find(name);
      if (!key) return null;
      const e = entries.get(key);
      if (dv.getUint32(e.offset, true) !== 0x04034b50) throw new Error('EPUB 檔案損毀：' + key);
      const start = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true);
      const raw = u8.subarray(start, start + e.compSize);
      if (e.method === 0) return raw;
      if (e.method === 8) return inflateRaw(raw);
      throw new Error('不支援的壓縮方式（' + e.method + '）：' + key);
    }

    return {
      names: () => [...entries.keys()],
      has: (name) => find(name) !== null,
      size: (name) => { const k = find(name); return k ? entries.get(k).size : 0; },
      bytes,
      text: async (name) => { const b = await bytes(name); return b ? decodeText(b) : null; },
      blob: async (name, type) => { const b = await bytes(name); return b ? new Blob([b], { type: type || '' }) : null; },
    };
  }

  R.zip = { open };
})(window.Reader = window.Reader || {});
