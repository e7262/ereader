/* 介面主程式：書架、閱讀、設定、20-20-20 休息提醒。 */
(function (R) {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const root = document.documentElement;

  const DEFAULTS = {
    material: 'paper', // paper 電子紙 | lcd 液晶
    light: 'auto', // day | dusk | night | auto（依時間）
    brightness: 100, // 軟體調暗 30–100%
    fontPaper: 'serif', // 每種材質各記一套字型
    fontLcd: 'pixel',
    fontSize: 20, // 一般字型的字級（px）
    pixelScale: 2, // 像素字放大倍率：12px × 2／3／4
    leading: 'normal',
    measure: 'medium',
    indent: true,
    texture: 'subtle',
    refresh: false, // 擬真翻頁刷新（閃爍），預設關閉
    rest: 20, // 休息提醒間隔（分鐘），0 = 關閉
    frame: true,
  };
  const LEADING = { tight: 1.6, normal: 1.85, loose: 2.1 };
  const MEASURE = { narrow: 26, medium: 34, wide: 44 }; // 每行最多幾個全形字

  const settings = R.prefs.load(DEFAULTS);

  const els = {
    screen: $('#screen'),
    library: $('#library'),
    reader: $('#reader'),
    books: $('#books'),
    empty: $('#empty'),
    pet: $('#petSprite'),
    storage: $('#storage'),
    pageArea: $('#pageArea'),
    flow: $('#flow'),
    stTitle: $('#stTitle'),
    stPage: $('#stPage'),
    stPct: $('#stPct'),
    stMeter: $('#stMeter > i'),
    menu: $('#menu'),
    menuTitle: $('#menuTitle'),
    menuInfo: $('#menuInfo'),
    tocPanel: $('#tocPanel'),
    toc: $('#toc'),
    settingsPanel: $('#settingsPanel'),
    settings: $('#settings'),
    metrics: $('#metrics'),
    restPanel: $('#restPanel'),
    restSprite: $('#restSprite'),
    restCount: $('#restCount'),
    restDone: $('#restDone'),
    toast: $('#toast'),
    flash: $('#flash'),
    led: $('#led'),
    fileInput: $('#fileInput'),
  };

  const pager = new R.Paginator(els.pageArea, els.flow);
  let current = null; // { book, doc, total }
  let reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => { reduceMotion = e.matches; });

  // ---------------------------------------------------------------- 外觀與排版

  function fontKey() { return settings.material === 'lcd' ? settings.fontLcd : settings.fontPaper; }
  function setFont(v) { if (settings.material === 'lcd') settings.fontLcd = v; else settings.fontPaper = v; }

  function resolveLight() {
    if (settings.light !== 'auto') return settings.light;
    const h = new Date().getHours();
    if (h >= 6 && h < 18) return 'day';
    if (h >= 18 && h < 22) return 'dusk';
    return 'night';
  }

  function typography() {
    const font = fontKey();
    const pixel = font === 'pixel';
    const dot = pixel ? settings.pixelScale : 2;
    const fs = pixel ? 12 * settings.pixelScale : settings.fontSize;
    const ratio = LEADING[settings.leading] || 1.85;
    // 像素字的行高取偶數個字型像素，上下半行距才會是整數點，字才會對齊點陣
    const lh = pixel ? dot * 2 * Math.round((12 * ratio) / 2) : Math.round(fs * ratio);
    const para = pixel ? dot * Math.round((fs * 0.3) / dot) : Math.round(fs * 0.3);
    return { font, pixel, dot, fs, lh, para };
  }

  let relayoutTimer = 0;
  function scheduleRelayout() {
    clearTimeout(relayoutTimer);
    relayoutTimer = setTimeout(() => { if (current) pager.relayout(); }, 120);
  }

  function applySettings() {
    const t = typography();
    root.dataset.material = settings.material;
    root.dataset.light = resolveLight();
    root.dataset.frame = settings.frame ? 'on' : 'off';
    root.dataset.texture = settings.texture;
    root.dataset.pixel = t.pixel ? 'on' : 'off';
    const st = root.style;
    st.setProperty('--fs', t.fs + 'px');
    st.setProperty('--lh', t.lh + 'px');
    st.setProperty('--para', t.para + 'px');
    st.setProperty('--dot', t.dot + 'px');
    st.setProperty('--indent', settings.indent ? '2em' : '0');
    st.setProperty('--body-font', 'var(--font-' + t.font + ')');
    st.setProperty('--dim', ((100 - settings.brightness) / 100).toFixed(2));
    $('meta[name="theme-color"]').content = getComputedStyle(root).getPropertyValue('--bg').trim();

    const snapUnit = t.pixel || settings.material === 'lcd' ? t.dot : 1;
    pager.configure({
      fontSize: t.fs,
      measure: MEASURE[settings.measure] || 34,
      margin: Math.max(16, Math.round(t.fs * 1.1)),
      unit: snapUnit,
      cell: t.pixel ? t.fs : 0,
      padTop: Math.round(t.fs * 0.6),
      padBottom: Math.round(t.fs * 0.4),
    });
    R.prefs.save(settings);
    scheduleRelayout();
    if ((t.pixel || settings.material === 'lcd') && document.fonts) {
      document.fonts.load('12px "Fusion Pixel TC"').then(scheduleRelayout, () => {});
    }
  }

  // ---------------------------------------------------------------- 小工具

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function formatSize(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function uid() {
    return (crypto.randomUUID && crypto.randomUUID()) || Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  let toastTimer = 0;
  function toast(msg, ms) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    if (ms !== 0) toastTimer = setTimeout(() => { els.toast.hidden = true; }, ms || 2600);
  }

  function hhmm(d) { return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

  // WCAG 相對亮度與對比值，用來在設定頁顯示目前配色的實際數字
  function luminance(hex) {
    const m = hex.replace('#', '').match(/../g);
    if (!m) return 0;
    const [r, g, b] = m.map((h) => {
      const c = parseInt(h, 16) / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // ---------------------------------------------------------------- 畫面切換

  function showView(name) {
    els.library.hidden = name !== 'library';
    els.reader.hidden = name !== 'reader';
    toggleMenu(false);
    closePanels();
    if (name === 'library') renderLibrary();
  }

  function openPanelEl() {
    return [els.tocPanel, els.settingsPanel].find((p) => !p.hidden) || null;
  }

  let panelReturnFocus = null;
  function openPanel(panel) {
    closePanels();
    panelReturnFocus = document.activeElement;
    panel.hidden = false;
    pushLayer();
    const first = panel.querySelector('[data-close]');
    if (first) first.focus({ preventScroll: true });
  }

  function closePanels() {
    const wasOpen = openPanelEl();
    els.tocPanel.hidden = true;
    els.settingsPanel.hidden = true;
    if (wasOpen && panelReturnFocus && document.contains(panelReturnFocus)) panelReturnFocus.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- 返回鍵
  // 書架之上，「閱讀頁」「面板」「休息提醒」各佔一層瀏覽紀錄。手機的返回鍵／返回手勢會一層層退回，
  // 而不是直接離開閱讀器；畫面上的「‹ 書架」「關閉」「略過」也走同一條路，紀錄才不會錯位。
  const NAV = 'inkReaderLayer';
  const layers = () => (current && !els.reader.hidden ? 1 : 0) + (openPanelEl() ? 1 : 0) + (els.restPanel.hidden ? 0 : 1);
  const navDepth = () => (history.state && history.state[NAV]) || 0;

  function pushLayer() {
    if (navDepth() < layers()) history.pushState({ [NAV]: layers() }, '');
  }

  function closeTopLayer() {
    if (!els.restPanel.hidden) endRest();
    else if (openPanelEl()) closePanels();
    else if (current) { closeBook(); showView('library'); }
  }

  // 關掉最上面一層：這一層有自己的瀏覽紀錄就 history.back()，交給 popstate 去關
  function popLayer() {
    if (layers() > 0 && navDepth() === layers()) history.back();
    else { closeTopLayer(); history.replaceState({ [NAV]: layers() }, ''); }
  }

  window.addEventListener('popstate', () => {
    for (let guard = 3; guard > 0 && layers() > navDepth(); guard--) closeTopLayer();
  });

  function toggleMenu(force) {
    const open = typeof force === 'boolean' ? force : els.menu.hidden;
    els.menu.hidden = !open;
    if (open && current) {
      els.menuTitle.textContent = current.book.title;
      els.menuInfo.textContent = '第 ' + (pager.ch + 1) + '／' + current.doc.chapters.length + ' 節 · 已連續閱讀 ' + Math.floor(session.active / 60000) + ' 分鐘';
    }
  }

  // ---------------------------------------------------------------- 書架

  let libCursor = -1;
  let stopPet = null;

  async function renderLibrary() {
    let books = [];
    try {
      books = await R.db.listBooks();
    } catch (err) {
      toast('無法使用瀏覽器儲存空間：' + err.message, 6000);
    }
    books.sort((a, b) => (b.lastReadAt || b.addedAt) - (a.lastReadAt || a.addedAt));
    els.books.replaceChildren(...books.map(bookItem));
    els.books.hidden = !books.length;
    els.empty.hidden = !!books.length;
    if (stopPet) { stopPet(); stopPet = null; }
    if (!books.length) stopPet = R.sprites.animate(els.pet, 'pet');
    libCursor = -1;
    updateStorage();
  }

  function bookItem(b) {
    const li = el('li', 'book');
    const open = el('button', 'book-open');
    const pct = Math.round((b.pct || 0) * 100);
    open.append(
      el('span', 'book-title', b.title),
      el('span', 'book-meta', [b.author, b.format.toUpperCase(), formatSize(b.size)].filter(Boolean).join(' · ')),
      el('span', 'book-meta', b.lastReadAt ? pct + '%' : '未讀')
    );
    const meter = el('span', 'meter');
    const fill = el('i');
    fill.style.setProperty('--p', pct);
    meter.append(fill);
    open.append(meter);
    open.addEventListener('click', () => openBook(b.id));

    const del = el('button', 'book-del', '刪除');
    del.setAttribute('aria-label', '刪除《' + b.title + '》');
    let armTimer = 0;
    del.addEventListener('click', async () => {
      if (!del.classList.contains('armed')) {
        // 按兩次才刪：第一次只是「上膛」，三秒內再按才真的刪除
        del.classList.add('armed');
        del.textContent = '確定？';
        armTimer = setTimeout(() => { del.classList.remove('armed'); del.textContent = '刪除'; }, 3000);
        return;
      }
      clearTimeout(armTimer);
      await R.db.deleteBook(b.id);
      toast('已刪除《' + b.title + '》');
      renderLibrary();
    });
    li.append(open, del);
    return li;
  }

  async function updateStorage() {
    try {
      const { usage } = await navigator.storage.estimate();
      els.storage.textContent = '本機已用 ' + formatSize(usage);
    } catch (e) {
      els.storage.textContent = '書只存在這台裝置';
    }
  }

  async function importFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return [];
    const existing = await R.db.listBooks().catch(() => []);
    const added = [];
    for (const file of files) {
      const ext = ((file.name.match(/\.([^.]+)$/) || [])[1] || '').toLowerCase();
      if (ext !== 'txt' && ext !== 'epub') { toast('不支援的格式：' + file.name); continue; }
      const dup = existing.find((b) => b.fileName === file.name && b.size === file.size);
      if (dup) { toast('已在書架上：' + file.name); added.push(dup.id); continue; }
      toast('匯入中：' + file.name, 0);
      try {
        const buf = await file.arrayBuffer();
        const doc = ext === 'epub' ? await R.epub.parse(buf) : R.txt.parse(buf, file.name);
        doc.dispose();
        const book = {
          id: uid(),
          title: doc.meta.title || file.name.replace(/\.[^.]+$/, ''),
          author: doc.meta.author || '',
          format: ext,
          fileName: file.name,
          size: file.size,
          encoding: doc.encoding || '',
          addedAt: Date.now(),
          lastReadAt: 0,
          pct: 0,
          pos: null,
        };
        const type = file.type || (ext === 'epub' ? 'application/epub+zip' : 'text/plain');
        await R.db.addBook(book, new Blob([buf], { type }));
        existing.push(book);
        added.push(book.id);
        toast('已加入《' + book.title + '》' + (book.encoding && book.encoding !== 'UTF-8' ? '（' + book.encoding + '）' : ''));
      } catch (err) {
        console.error(err);
        toast('無法匯入 ' + file.name + '：' + err.message, 5000);
      }
    }
    // 請瀏覽器不要在空間吃緊時自動清掉書架
    if (added.length && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if (!els.library.hidden) renderLibrary();
    return added;
  }

  // ---------------------------------------------------------------- 閱讀

  async function openBook(id) {
    try {
      const [book, blob] = await Promise.all([R.db.getBook(id), R.db.getFile(id)]);
      if (!book || !blob) throw new Error('找不到檔案');
      const buf = await blob.arrayBuffer();
      const doc = book.format === 'epub' ? await R.epub.parse(buf) : R.txt.parse(buf, book.fileName || book.title);
      closeBook();
      current = { book, doc, total: doc.chapters.reduce((s, c) => s + c.size, 0) };
      showView('reader');
      pushLayer();
      els.toast.hidden = true; // 匯入時的提示不要帶進閱讀頁
      els.stTitle.textContent = book.title;
      session.lastInput = Date.now();
      await pager.open(doc, book.pos);
    } catch (err) {
      console.error(err);
      toast('無法開啟：' + err.message, 5000);
      closeBook();
      showView('library');
      history.replaceState({ [NAV]: layers() }, '');
    }
  }

  function closeBook() {
    if (!current) return;
    saveProgress();
    pager.close();
    current.doc.dispose();
    current = null;
  }

  function overallPct() {
    const chs = current.doc.chapters;
    let before = 0;
    for (let i = 0; i < pager.ch; i++) before += chs[i].size;
    const within = chs[pager.ch].size * (pager.page + 1) / pager.pages;
    return Math.min(1, (before + within) / current.total);
  }

  function updateStatus() {
    const ch = current.doc.chapters[pager.ch];
    els.stTitle.textContent = (ch && ch.title) || current.book.title;
    els.stPage.textContent = (pager.page + 1) + ' / ' + pager.pages;
    const pct = overallPct();
    els.stPct.textContent = Math.floor(pct * 100) + '%';
    els.stMeter.style.setProperty('--p', (pct * 100).toFixed(1));
  }

  let saveTimer = 0;
  function saveProgress() {
    clearTimeout(saveTimer);
    if (!current || !pager.doc) return;
    const b = current.book;
    b.pos = pager.position();
    b.pct = overallPct();
    b.lastReadAt = Date.now();
    R.db.putBook(b).catch((e) => console.warn('進度儲存失敗', e));
  }

  pager.onchange = (reason) => {
    if (!current) return;
    updateStatus();
    if (reason === 'turn') turnEffect();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveProgress, 500);
  };

  function turn(dir) {
    if (!current) return;
    session.lastInput = Date.now();
    if (!els.menu.hidden) { toggleMenu(false); return; }
    const moved = dir > 0 ? pager.next() : pager.prev();
    if (!moved && !pager.busy) toast(dir > 0 ? '已經是最後一頁' : '已經是第一頁', 1500);
  }

  // 擬真刷新：電子紙全刷時會先黑後白閃一下；STN 液晶反應慢，新的字會分幾步才變深
  let lastEffect = 0;
  function turnEffect() {
    if (!settings.refresh || reduceMotion) return;
    // 連續快速翻頁時不重複閃爍：每秒最多 2.5 次，低於 WCAG 2.3.1「每秒不超過三次閃爍」
    const now = Date.now();
    if (now - lastEffect < 400) return;
    lastEffect = now;
    if (settings.material === 'paper') {
      els.flash.className = 'fx fx-flash black';
      setTimeout(() => { els.flash.className = 'fx fx-flash white'; }, 70);
      setTimeout(() => { els.flash.className = 'fx fx-flash'; }, 140);
    } else if (els.flow.animate) {
      els.flow.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 240, easing: 'steps(4, end)' });
    }
  }

  function openToc() {
    if (!current) return;
    const entries = current.doc.toc;
    let here = -1;
    entries.forEach((t, i) => { if (t.ch <= pager.ch) here = i; });
    els.toc.replaceChildren(...entries.map((t, i) => {
      const li = el('li');
      const b = el('button', null, t.title || '（無標題）');
      b.dataset.depth = Math.min(2, t.depth || 0);
      if (i === here) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => {
        popLayer();
        toggleMenu(false);
        pager.goTo(t.ch, t.frag ? { frag: t.frag } : 'start');
      });
      li.append(b);
      return li;
    }));
    openPanel(els.tocPanel);
    const cur = els.toc.querySelector('[aria-current]');
    if (cur) cur.scrollIntoView({ block: 'center' });
  }

  // ---------------------------------------------------------------- 設定

  const isPixel = () => fontKey() === 'pixel';
  const SCHEMA = [
    { key: 'material', label: '材質', options: [['paper', '電子紙'], ['lcd', '液晶']] },
    {
      key: 'light', label: '光線', options: [['day', '日光'], ['dusk', '暖光'], ['night', '夜間'], ['auto', '自動']],
      note: () => settings.light === 'auto' ? '依時間切換：06–18 日光、18–22 暖光、22–06 夜間' : '',
    },
    {
      key: 'brightness', label: '亮度', step: () => [30, 100, 10], fmt: (v) => v + '%',
      note: () => settings.brightness < 100 ? '軟體調暗：可比系統最低亮度更暗，適合關燈前讀' : '',
    },
    { key: 'font', label: '字型', get: fontKey, set: setFont, options: [['serif', '明體'], ['sans', '黑體'], ['kai', '楷體'], ['pixel', '像素']] },
    {
      key: 'size', label: '字級',
      get: () => (isPixel() ? settings.pixelScale : settings.fontSize),
      set: (v) => { if (isPixel()) settings.pixelScale = v; else settings.fontSize = v; },
      step: () => (isPixel() ? [2, 4, 1] : [14, 32, 1]),
      fmt: (v) => (isPixel() ? 12 * v : v) + 'px',
    },
    { key: 'leading', label: '行距', options: [['tight', '緊'], ['normal', '適中'], ['loose', '寬鬆']] },
    { key: 'measure', label: '行寬', options: [['narrow', '窄'], ['medium', '中'], ['wide', '寬']] },
    { key: 'indent', label: '縮排', options: [[true, '首行縮排'], [false, '不縮排']] },
    { key: 'texture', label: '質感', options: [['off', '關'], ['subtle', '淡'], ['full', '擬真']] },
    {
      key: 'refresh', label: '刷新', options: [[false, '關'], [true, '擬真']],
      note: () => settings.material === 'lcd' ? '翻頁時模擬液晶反應慢的殘影' : '翻頁時模擬電子紙全刷的黑白閃爍；對閃光敏感請保持關閉',
    },
    {
      key: 'rest', label: '休息', options: [[0, '關'], [20, '20 分'], [30, '30 分'], [45, '45 分']],
      note: () => settings.rest ? '連續閱讀 ' + settings.rest + ' 分鐘後提醒你看遠方 20 秒' : '',
    },
    { key: 'frame', label: '外框', options: [[true, '顯示'], [false, '隱藏']], note: () => '只在寬螢幕上顯示裝置外殼' },
  ];

  function getSetting(row) { return row.get ? row.get() : settings[row.key]; }
  function setSetting(row, v) {
    if (row.set) row.set(v); else settings[row.key] = v;
    applySettings();
    renderSettings(row.key + ':' + String(v));
  }

  function renderSettings(focusId) {
    const rows = SCHEMA.map((row) => {
      const wrap = el('div', 'setting');
      wrap.append(el('span', null, row.label));
      const value = getSetting(row);
      const box = el('div', row.step ? 'stepper' : 'opts');
      if (row.step) {
        const [min, max, step] = row.step();
        const out = el('output', null, row.fmt(value));
        const minus = el('button', 'btn', '−');
        const plus = el('button', 'btn', '＋');
        minus.setAttribute('aria-label', row.label + '減少');
        plus.setAttribute('aria-label', row.label + '增加');
        minus.disabled = value <= min;
        plus.disabled = value >= max;
        minus.dataset.fid = row.key + ':-';
        plus.dataset.fid = row.key + ':+';
        minus.addEventListener('click', () => setSettingStep(row, Math.max(min, value - step), '-'));
        plus.addEventListener('click', () => setSettingStep(row, Math.min(max, value + step), '+'));
        box.append(minus, out, plus);
      } else {
        for (const [v, label] of row.options) {
          const b = el('button', 'btn', label);
          b.setAttribute('aria-pressed', String(v === value));
          b.dataset.fid = row.key + ':' + String(v);
          b.addEventListener('click', () => setSetting(row, v));
          box.append(b);
        }
      }
      wrap.append(box);
      const note = row.note && row.note();
      if (note) {
        const p = el('p', 'note', note);
        p.style.gridColumn = '2';
        wrap.append(p);
      }
      return wrap;
    });
    els.settings.replaceChildren(...rows);
    renderMetrics();
    if (focusId) {
      const target = els.settings.querySelector('[data-fid="' + CSS.escape(focusId) + '"]');
      if (target && !target.disabled) target.focus({ preventScroll: true });
    }
  }

  function setSettingStep(row, v, dir) {
    if (row.set) row.set(v); else settings[row.key] = v;
    applySettings();
    renderSettings(row.key + ':' + dir);
  }

  function renderMetrics() {
    const cs = getComputedStyle(root);
    const bg = luminance(cs.getPropertyValue('--bg').trim());
    const ink = luminance(cs.getPropertyValue('--ink').trim());
    const ratio = (Math.max(bg, ink) + 0.05) / (Math.min(bg, ink) + 0.05);
    const peak = Math.max(bg, ink) * settings.brightness / 100;
    const t = typography();
    const parts = [
      '文字對比 ' + ratio.toFixed(1) + ':1（無障礙最高等級 AAA 為 7:1，純黑白為 21:1）',
      '畫面最亮處約為純白的 ' + Math.round(peak * 100) + '%',
      '行高 ' + (t.lh / t.fs).toFixed(2) + ' 倍',
    ];
    if (current && pager.colW) parts.push('每行約 ' + Math.floor(pager.colW / t.fs) + ' 字');
    els.metrics.textContent = parts.join(' · ');
  }

  function openSettings() {
    renderSettings();
    openPanel(els.settingsPanel);
  }

  // ---------------------------------------------------------------- 20-20-20 休息提醒

  const session = { active: 0, last: Date.now(), lastInput: Date.now(), hiddenAt: 0 };
  let restTimer = 0;
  let stopRestPet = null;

  function showRest() {
    toggleMenu(false);
    closePanels();
    els.restPanel.hidden = false;
    let n = 20;
    els.restCount.textContent = n;
    els.restDone.textContent = '略過';
    stopRestPet = R.sprites.animate(els.restSprite, 'pet');
    clearInterval(restTimer);
    restTimer = setInterval(() => {
      n -= 1;
      els.restCount.textContent = Math.max(0, n);
      if (n <= 0) {
        clearInterval(restTimer);
        els.restDone.textContent = '繼續閱讀';
      }
    }, 1000);
    pushLayer();
    els.restDone.focus({ preventScroll: true });
  }

  function endRest() {
    clearInterval(restTimer);
    if (stopRestPet) stopRestPet();
    els.restPanel.hidden = true;
    session.active = 0;
    session.lastInput = Date.now();
  }

  function updateLed() {
    const ratio = settings.rest ? session.active / (settings.rest * 60000) : 0;
    els.led.style.setProperty('--led', ratio < 0.75 ? '#3f9a4a' : ratio < 1 ? '#d6a02c' : '#c8402c');
  }

  let lastClock = '';
  function tick() {
    const now = Date.now();
    const dt = now - session.last;
    session.last = now;
    // 只計算「真的在讀」的時間：閱讀頁開著、分頁在前景、三分鐘內有翻頁或操作
    if (current && !els.reader.hidden && !document.hidden && els.restPanel.hidden && now - session.lastInput < 180000 && dt < 5000) {
      session.active += dt;
    }
    if (current && settings.rest && session.active >= settings.rest * 60000 && els.restPanel.hidden && !els.reader.hidden) showRest();
    updateLed();

    const clock = hhmm(new Date());
    if (clock !== lastClock) {
      lastClock = clock;
      document.querySelectorAll('.clock').forEach((c) => { c.textContent = clock; });
      if (settings.light === 'auto' && resolveLight() !== root.dataset.light) {
        applySettings();
        if (!els.settingsPanel.hidden) renderSettings();
      }
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      session.hiddenAt = Date.now();
      saveProgress();
    } else if (session.hiddenAt && Date.now() - session.hiddenAt > 5 * 60000) {
      session.active = 0; // 離開超過五分鐘，當作已經休息過
    }
  });
  window.addEventListener('pagehide', saveProgress);

  // ---------------------------------------------------------------- 輸入：點、滑、滾輪、鍵盤、實體鍵

  let down = null;
  els.pageArea.addEventListener('pointerdown', (e) => {
    if (e.button === 0) down = { x: e.clientX, y: e.clientY };
  });
  els.pageArea.addEventListener('pointercancel', () => { down = null; });
  els.pageArea.addEventListener('pointerup', (e) => {
    if (!down || !current) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    down = null;
    session.lastInput = Date.now();
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) { turn(dx < 0 ? 1 : -1); return; }
    if (Math.hypot(dx, dy) > 10) return; // 拖曳選字，不翻頁
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const link = e.target.closest && e.target.closest('a[data-href]');
    if (link) {
      const target = current.doc.resolveLink(link.dataset.href);
      if (target) pager.goTo(target.ch, target.frag ? { frag: target.frag } : 'start');
      return;
    }
    if (!els.menu.hidden) { toggleMenu(false); return; }
    const rect = els.pageArea.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    if (x < 0.3) turn(-1);
    else if (x > 0.7) turn(1);
    else toggleMenu(true);
  });

  let wheelLock = 0;
  els.pageArea.addEventListener('wheel', (e) => {
    e.preventDefault();
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    const now = Date.now();
    if (now < wheelLock || Math.abs(d) < 8) return;
    wheelLock = now + 350;
    turn(d > 0 ? 1 : -1);
  }, { passive: false });

  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (!els.restPanel.hidden) {
      if (k === 'Escape') popLayer();
      return;
    }
    if (k === 'Escape') {
      if (openPanelEl()) popLayer();
      else if (!els.menu.hidden) toggleMenu(false);
      return;
    }
    if (!current || els.reader.hidden || openPanelEl()) return;
    const onButton = e.target.closest && e.target.closest('button');
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || (k === ' ' && !e.shiftKey && !onButton)) {
      e.preventDefault();
      turn(1);
    } else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || (k === ' ' && e.shiftKey && !onButton)) {
      e.preventDefault();
      turn(-1);
    } else if (k === 'Enter' && !onButton) {
      toggleMenu();
    } else if (k === 't') {
      openToc();
    }
  });

  // 機身三顆鍵：閱讀時是 上一頁／選單／下一頁；書架上是 上一本／打開／下一本
  function deviceKey(k) {
    session.lastInput = Date.now();
    if (!els.restPanel.hidden) { if (k === 'menu') popLayer(); return; }
    const panel = openPanelEl();
    if (panel) {
      const body = panel.querySelector('.panel-body');
      if (k === 'menu') popLayer();
      else body.scrollTop += (k === 'next' ? 1 : -1) * body.clientHeight * 0.8;
      return;
    }
    if (current && !els.reader.hidden) {
      if (k === 'menu') toggleMenu();
      else turn(k === 'next' ? 1 : -1);
      return;
    }
    const items = [...els.books.querySelectorAll('.book-open')];
    if (!items.length) { if (k === 'menu') els.fileInput.click(); return; }
    if (k === 'menu') { (items[libCursor] || items[0]).click(); return; }
    libCursor = libCursor < 0 ? 0 : Math.max(0, Math.min(items.length - 1, libCursor + (k === 'next' ? 1 : -1)));
    items.forEach((it, i) => it.classList.toggle('cursor', i === libCursor));
    items[libCursor].scrollIntoView({ block: 'nearest' });
  }
  document.querySelectorAll('[data-key]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // 不搶走焦點
    btn.addEventListener('click', () => deviceKey(btn.dataset.key));
  });

  document.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'library') popLayer();
      else if (a === 'toc') openToc();
      else if (a === 'settings') openSettings();
      return;
    }
    if (e.target.closest('[data-close]')) popLayer();
  });

  $('#btnImport').addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => {
    importFiles(els.fileInput.files);
    els.fileInput.value = '';
  });
  $('#btnGuide').addEventListener('click', async () => {
    const file = new File([R.guideText], '墨屏閱讀器使用說明書.txt', { type: 'text/plain' });
    const [id] = await importFiles([file]);
    if (id) openBook(id);
  });
  els.restDone.addEventListener('click', popLayer);

  // 拖放匯入
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  document.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; els.screen.classList.add('dropping'); } });
  document.addEventListener('dragleave', (e) => {
    if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; els.screen.classList.remove('dropping'); }
  });
  document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    els.screen.classList.remove('dropping');
    if (current) {
      const depth = navDepth();
      closeBook();
      showView('library');
      if (depth) history.go(-depth); // 把閱讀頁以上的紀錄一併退掉
    }
    importFiles(e.dataTransfer.files);
  });

  new ResizeObserver(scheduleRelayout).observe(els.pageArea);
  if (document.fonts) document.fonts.addEventListener('loadingdone', scheduleRelayout);

  // ---------------------------------------------------------------- 啟動

  // 重新整理後一律從書架開始；舊的層級紀錄歸零，避免返回鍵對不上
  if (navDepth()) history.replaceState({ [NAV]: 0 }, '');
  applySettings();
  renderLibrary();
  tick();
  setInterval(tick, 1000);

  // 離線快取（只在 http/https 下可用；直接開 file:// 時略過）
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  // 給除錯／測試用
  R.app = { settings, applySettings, importFiles, openBook, pager, get current() { return current; } };
})(window.Reader = window.Reader || {});
