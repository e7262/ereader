/* TXT 解析：自動判斷編碼（UTF-8 / UTF-16 / GB18030 / Big5）、偵測章回標題、切成章節。
   大章節會再切段，避免一次把幾十萬字塞進同一個分頁容器而拖慢排版。 */
(function (R) {
  'use strict';

  // 簡繁共用的高頻字（兩種寫法都列），用來判斷哪一種解碼結果「像中文」
  const COMMON = new Set(
    '的一是不了人我在有他这這中大来來上个個国國到说說们們为為子和你地出道也时時年得就那要下以生会會自着著去之过過家学學对對可她里裡后後小么麼心多天而能好都然没沒日于於起还還发發成事只作当當想看文无無开開手十用主行方又如前所本见見经經头頭面公同三已老从從动動两兩长長知民样樣现現分将將外但身些与與高意进進把法此实實回二理美点點月明其种種声聲全工己话話儿兒者向情部正名定女问問力机機给給等几幾很业業最间間新什打便位因重被走电電四第门門相次东東政海口使教西再平真听聽世气氣信北少关關并並内內加化由却卻代军軍产產入先山五太水万萬市眼体體别別处處总總才场場师師书書比住员員九笑性通目华華报報立马馬命张張活难難神数數件安表原车車白应應路期叫死常提感金何更反合放做系统統，。、！？「」：；…'
  );
  const TRAD = '這們個說國時來為對裡後麼過還發開經頭從動兩長樣現將與進實點種聲話兒問機給幾業間氣關內卻軍產萬體別處總場師書員華報馬張難數車應';
  const SIMP = '这们个说国时来为对里后么过还发开经头从动两长样现将与进实点种声话儿问机给几业间气关内却军产万体别处总场师书员华报马张难数车应';

  function score(text) {
    let hit = 0, bad = 0;
    const n = Math.min(text.length, 20000);
    for (let i = 0; i < n; i++) {
      const ch = text[i];
      const c = ch.charCodeAt(0);
      if (COMMON.has(ch)) hit++;
      else if (c === 0xfffd || (c >= 0xe000 && c <= 0xf8ff)) bad++;
    }
    return hit - bad * 8;
  }

  function decode(buffer) {
    const u8 = new Uint8Array(buffer);
    if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(u8), encoding: 'UTF-8' };
    if (u8[0] === 0xff && u8[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(u8), encoding: 'UTF-16LE' };
    if (u8[0] === 0xfe && u8[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(u8), encoding: 'UTF-16BE' };
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8), encoding: 'UTF-8' };
    } catch (e) { /* 不是合法 UTF-8，改試中文傳統編碼 */ }

    const sample = u8.subarray(0, 65536);
    let best = null;
    for (const [label, name] of [['gb18030', 'GB18030'], ['big5', 'Big5']]) {
      const s = score(new TextDecoder(label).decode(sample));
      if (!best || s > best.s) best = { label, name, s };
    }
    return { text: new TextDecoder(best.label).decode(u8), encoding: best.name };
  }

  const NUM = '0-9０-９零〇一二三四五六七八九十百千万萬两兩壹貳參肆伍陸柒捌玖拾佰仟';
  const HEADING = new RegExp(
    '^(?:第[' + NUM + ']+[章回節节卷集部篇話话幕]' +
    '|卷[' + NUM + ']+' +
    '|(?:chapter|part|book)\\s*[0-9ivxlc]+\\b' +
    '|(?:序章|序言|序|楔子|引子|前言|後記|后记|尾聲|尾声|終章|终章|番外|附錄|附录|目錄|目录)(?=$|[\\s\u3000:：、．.·—-]))',
    'i'
  );

  function isHeading(line) {
    return line.length <= 36 && HEADING.test(line) && !/[。，；！？」』”]$/.test(line);
  }

  // 判斷是否為「硬換行」文字（每行固定寬度、段落用空行分隔），若是就把行接回段落
  function toParagraphs(text) {
    const lines = text.split(/\r\n?|\n|\u2028|\u2029/);
    const nonEmpty = lines.filter((l) => l.trim());
    const lens = nonEmpty.map((l) => l.trim().length).sort((a, b) => a - b);
    const p90 = lens[Math.floor(lens.length * 0.9)] || 0;
    const blankRatio = (lines.length - nonEmpty.length) / Math.max(1, lines.length);
    const fullRatio = lens.filter((n) => n >= p90 * 0.8).length / Math.max(1, lens.length);
    const hardWrapped = p90 >= 30 && blankRatio > 0.05 && fullRatio > 0.5;

    const paras = [];
    let buf = '';
    const flush = () => { if (buf) paras.push(buf); buf = ''; };
    for (const raw of lines) {
      const line = raw.replace(/^[\s\u3000\ufeff]+|[\s\u3000]+$/g, '');
      if (!line) { flush(); continue; }
      if (!hardWrapped || isHeading(line)) { flush(); paras.push(line); continue; }
      if (!buf) buf = line;
      else buf += (/[A-Za-z0-9,.;:!?'"-]$/.test(buf) && /^[A-Za-z0-9("']/.test(line) ? ' ' : '') + line;
    }
    flush();
    return paras;
  }

  const SECTION = 24000; // 每段約兩萬多字，排版與翻頁都保持順暢

  function splitChapters(paras) {
    const heads = [];
    paras.forEach((p, i) => { if (isHeading(p)) heads.push(i); });

    const raw = [];
    if (heads.length >= 2) {
      if (heads[0] > 0) raw.push({ title: '開篇', start: 0, end: heads[0], heading: false });
      heads.forEach((h, k) => raw.push({ title: paras[h], start: h, end: k + 1 < heads.length ? heads[k + 1] : paras.length, heading: true }));
    } else {
      raw.push({ title: '', start: 0, end: paras.length, heading: false });
    }

    // 太長的章節切成數段
    const chapters = [];
    for (const c of raw) {
      let start = c.start, part = 0, count = 0;
      for (let i = c.start; i < c.end; i++) {
        count += paras[i].length;
        if (count >= SECTION && i + 1 < c.end) {
          chapters.push(make(c, start, i + 1, part++));
          start = i + 1;
          count = 0;
        }
      }
      chapters.push(make(c, start, c.end, part));
    }
    return chapters;

    function make(c, start, end, part) {
      const excerpt = (paras[start] || '').slice(0, 14);
      let title = c.title || excerpt + (excerpt.length >= 14 ? '…' : '');
      if (c.title && part > 0) title += '（' + (part + 1) + '）';
      const size = paras.slice(start, end).reduce((s, p) => s + p.length, 0);
      // 第一個標題之前只有幾行短字（書名、作者）時，排成置中的書名頁
      const cover = !c.heading && heads.length >= 2 && end - start <= 5 && paras.slice(start, end).every((p) => p.length <= 40);
      if (cover) title = '扉頁';
      return {
        title, start, end,
        heading: c.heading && part === 0,
        depth: c.title && part > 0 ? 1 : 0,
        cover,
        size: Math.max(1, size),
      };
    }
  }

  function guessLang(text) {
    const sample = text.slice(0, 20000);
    let t = 0, s = 0;
    for (const ch of sample) {
      if (TRAD.includes(ch)) t++;
      else if (SIMP.includes(ch)) s++;
    }
    // 判斷不出繁簡時用 zh-Hant：Android 的 Chrome 把單純的 zh 當成簡體，會換成簡體字形
    if (t + s < 10) return /[\u3040-\u30ff]/.test(sample) ? 'ja' : (/[\u4e00-\u9fff]/.test(sample) ? 'zh-Hant' : 'en');
    return t >= s ? 'zh-Hant' : 'zh-Hans';
  }

  function parse(buffer, fileName) {
    const { text, encoding } = decode(buffer);
    const paras = toParagraphs(text);
    if (!paras.length) throw new Error('這個 TXT 檔是空的');
    const chapters = splitChapters(paras);

    const head = paras.slice(0, 12).join('\n');
    const authorMatch = head.match(/(?:作者|著者|作\s*者)\s*[:：]\s*([^\n]{1,30})/);
    const meta = {
      title: (fileName || '').replace(/\.[^.]+$/, '').replace(/^《(.+)》.*$/, '$1') || paras[0].slice(0, 30),
      author: authorMatch ? authorMatch[1].trim() : '',
      lang: guessLang(text),
    };

    function load(i) {
      const c = chapters[i];
      const frag = document.createDocumentFragment();
      for (let k = c.start; k < c.end; k++) {
        const first = k === c.start;
        const el = document.createElement(first && c.heading ? 'h2' : first && c.cover ? 'h1' : 'p');
        if (c.cover) el.className = 'ac';
        el.textContent = paras[k];
        frag.appendChild(el);
      }
      return Promise.resolve(frag);
    }

    return {
      format: 'txt',
      encoding,
      meta,
      chapters: chapters.map((c) => ({ title: c.title, size: c.size })),
      toc: chapters.map((c, i) => ({ title: c.title, ch: i, frag: '', depth: c.depth })),
      load,
      resolveLink: () => null,
      dispose() {},
    };
  }

  R.txt = { parse, decode, guessLang };
})(window.Reader = window.Reader || {});
