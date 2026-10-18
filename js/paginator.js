/* 分頁器：用 CSS 多欄排版把一章切成「一頁一欄」，翻頁時整頁瞬間換過去，不捲動、不滑動。
   ──電子紙本來就是這樣翻頁的，眼睛也不必追著移動中的文字跑。

   幾何關係：頁面區寬 W；文字欄寬 colW、左邊界 M；欄距 = W − colW，所以每一欄剛好相隔 W，
   往左平移 page × W 就是第 page 頁。 */
(function (R) {
  'use strict';

  // 用來記錄「讀到哪」的區塊元素；依文件順序排列時，它們的起始頁碼是單調遞增的
  const ANCHORS = 'p,h1,h2,h3,h4,h5,h6,li,pre,blockquote,figure,figcaption,img,hr,dt,dd,table,div';

  class Paginator {
    constructor(area, flow) {
      this.area = area;
      this.flow = flow;
      this.doc = null;
      this.ch = 0;
      this.page = 0;
      this.pages = 1;
      this.stride = 1;
      this.anchors = [];
      this.starts = [];
      this.busy = false;
      this.token = 0;
      // 重新排版時要「黏住」的位置：使用者翻頁前，連續改好幾次字級也不會一路往前漂
      this.sticky = null;
      this.opts = {};
      this.onchange = null; // (reason) => void，reason: 'turn' | 'chapter' | 'layout'
      this.end = document.createElement('div');
      this.end.className = 'end';
      // 焦點移到別頁的連結時瀏覽器會自己捲動，這裡把它拉回來，翻頁只由 transform 控制
      area.addEventListener('scroll', () => { area.scrollLeft = 0; area.scrollTop = 0; });
    }

    configure(opts) { this.opts = opts; }

    measure() {
      const o = this.opts;
      const u = o.unit || 1;
      const snap = (v) => Math.floor(v / u) * u;
      const W = Math.floor(this.area.clientWidth);
      const H = Math.floor(this.area.clientHeight);
      let M = snap(Math.max(o.margin, (W - o.fontSize * o.measure) / 2));
      let colW = W - 2 * M;
      if (o.cell) {
        // 像素字：每行放整數個全形字，字的像素才會落在液晶點陣上
        const fitted = Math.max(o.cell, Math.floor(colW / o.cell) * o.cell);
        M += snap((colW - fitted) / 2);
        colW = fitted;
      }
      const top = snap(o.padTop);
      const colH = Math.max(o.fontSize * 2, H - top - snap(o.padBottom));
      const s = this.flow.style;
      s.left = M + 'px';
      s.top = top + 'px';
      s.width = colW + 'px';
      s.height = colH + 'px';
      s.columnWidth = colW + 'px';
      s.columnGap = (W - colW) + 'px';
      s.setProperty('--col-h', colH + 'px');
      this.stride = Math.max(1, W);
      this.colW = colW;
    }

    origin() { return this.flow.getBoundingClientRect().left; }

    pageAt(x, base) { return Math.max(0, Math.floor((x - base + 1) / this.stride)); }

    // 量出總頁數與每個錨點元素的起始頁
    index() {
      const base = this.origin();
      const r = this.end.getClientRects();
      this.pages = r.length ? this.pageAt(r[r.length - 1].left, base) + 1 : 1;
      this.anchors = [...this.flow.querySelectorAll(ANCHORS)];
      let last = 0;
      this.starts = this.anchors.map((el) => {
        const rects = el.getClientRects();
        if (rects.length) last = this.pageAt(rects[0].left, base);
        return last;
      });
    }

    endPage(el) {
      const rects = el.getClientRects();
      return rects.length ? this.pageAt(rects[rects.length - 1].left, this.origin()) : 0;
    }

    async open(doc, pos) {
      this.doc = doc;
      this.flow.lang = doc.meta.lang || 'zh-Hant';
      const ch = pos && pos.ch < doc.chapters.length ? pos.ch : 0;
      await this.show(ch, pos || 'start');
    }

    // where: 'start' | 'end' | { a, c }（錨點序號與字序） | { frag } | { r }（章內比例）
    async show(ch, where) {
      const token = ++this.token;
      this.busy = true;
      try {
        const frag = await this.doc.load(ch);
        if (token !== this.token) return;
        this.flow.replaceChildren(frag, this.end);
        this.flow.style.transform = 'none';
        this.measure();
        await this.settle();
        if (token !== this.token) return;
        this.ch = ch;
        this.index();
        this.page = this.locate(where);
        this.sticky = where && typeof where === 'object' && typeof where.a === 'number' ? where : null;
        this.apply('chapter');
      } finally {
        if (token === this.token) this.busy = false;
      }
    }

    // 等圖片解碼與字型載入，否則量到的頁數會不準
    async settle() {
      void this.flow.offsetHeight;
      const imgs = [...this.flow.querySelectorAll('img')].filter((img) => !img.complete);
      const ready = Promise.all([
        ...imgs.map((img) => img.decode().catch(() => {})),
        document.fonts ? document.fonts.ready : null,
      ]);
      await Promise.race([ready, new Promise((r) => setTimeout(r, 2000))]);
    }

    locate(where) {
      const last = this.pages - 1;
      if (where === 'end') return last;
      if (!where || where === 'start') return 0;
      if (where.frag) {
        const el = this.flow.querySelector('[data-id="' + CSS.escape(where.frag) + '"]');
        const i = el ? this.anchors.indexOf(el.closest(ANCHORS) || el) : -1;
        if (i >= 0) return this.starts[i];
        if (el) return Math.min(last, this.pageAt(el.getClientRects()[0] ? el.getClientRects()[0].left : 0, this.origin()));
        return 0;
      }
      if (typeof where.a === 'number' && this.anchors[where.a]) {
        const el = this.anchors[where.a];
        if (where.c > 0) {
          const p = this.charPage(el, where.c);
          if (p !== null) return Math.min(last, p);
        }
        return Math.min(last, this.starts[where.a] + (where.o || 0), this.endPage(el));
      }
      if (typeof where.r === 'number') return Math.round(where.r * last);
      return 0;
    }

    // 目前頁面最上方是哪段文字：記下「元素序號 + 元素內第幾個字」，改字級或視窗大小後仍能停在同一句
    position() {
      if (this.sticky && this.sticky.ch === this.ch) return this.sticky;
      const p = this.page;
      const pos = { ch: this.ch, r: this.pages > 1 ? p / (this.pages - 1) : 0 };
      // L：最後一個在本頁之前就開始的元素。之後的元素都從本頁或更後面開始
      let lo = 0, hi = this.starts.length - 1, L = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (this.starts[mid] < p) { L = mid; lo = mid + 1; } else hi = mid - 1;
      }
      if (L >= 0 && this.endPage(this.anchors[L]) >= p) {
        // 上一頁的段落延續到本頁：找出本頁第一個字
        const c = this.firstCharOn(this.anchors[L], p);
        if (c !== null) return Object.assign(pos, { a: L, c });
      }
      if (L + 1 < this.starts.length && this.starts[L + 1] === p) Object.assign(pos, { a: L + 1, c: 0 });
      return pos;
    }

    textMap(el) {
      const nodes = [], offsets = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let total = 0;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        nodes.push(n);
        offsets.push(total);
        total += n.length;
      }
      return { nodes, offsets, total };
    }

    // 第 k 個字落在哪一頁（空白字可能沒有外框，就往後找最近一個有外框的字）
    pageOfChar(map, k, range, base) {
      for (let j = k; j < Math.min(map.total, k + 8); j++) {
        let i = map.offsets.length - 1;
        while (i > 0 && map.offsets[i] > j) i--;
        const off = j - map.offsets[i];
        range.setStart(map.nodes[i], off);
        range.setEnd(map.nodes[i], off + 1);
        const rect = range.getClientRects()[0];
        if (rect) return this.pageAt(rect.left, base);
      }
      return null;
    }

    firstCharOn(el, p) {
      const map = this.textMap(el);
      if (!map.total) return null;
      const range = document.createRange();
      const base = this.origin();
      let lo = 0, hi = map.total - 1, found = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const pg = this.pageOfChar(map, mid, range, base);
        if (pg !== null && pg >= p) { found = mid; hi = mid - 1; } else lo = mid + 1;
      }
      return found;
    }

    charPage(el, c) {
      const map = this.textMap(el);
      if (!map.total) return null;
      return this.pageOfChar(map, Math.min(c, map.total - 1), document.createRange(), this.origin());
    }

    apply(reason) {
      this.flow.style.transform = 'translateX(' + (-this.page * this.stride) + 'px)';
      if (this.onchange) this.onchange(reason);
    }

    next() {
      if (this.busy || !this.doc) return false;
      this.sticky = null;
      if (this.page < this.pages - 1) { this.page++; this.apply('turn'); return true; }
      if (this.ch < this.doc.chapters.length - 1) { this.show(this.ch + 1, 'start'); return true; }
      return false;
    }

    prev() {
      if (this.busy || !this.doc) return false;
      this.sticky = null;
      if (this.page > 0) { this.page--; this.apply('turn'); return true; }
      if (this.ch > 0) { this.show(this.ch - 1, 'end'); return true; }
      return false;
    }

    goTo(ch, where) {
      if (!this.doc) return Promise.resolve();
      this.sticky = null;
      if (ch === this.ch && !this.busy) {
        this.page = this.locate(where);
        this.apply('turn');
        return Promise.resolve();
      }
      return this.show(ch, where);
    }

    // 版面設定或視窗尺寸改變後重新分頁，並停在原本那段文字
    async relayout() {
      if (!this.doc || this.busy) return;
      const pos = this.position();
      this.flow.style.transform = 'none';
      this.measure();
      await this.settle();
      this.index();
      this.page = this.locate(pos);
      if (typeof pos.a === 'number') this.sticky = pos;
      this.apply('layout');
    }

    close() {
      this.token++;
      this.busy = false;
      this.doc = null;
      this.flow.replaceChildren();
    }
  }

  R.Paginator = Paginator;
})(window.Reader = window.Reader || {});
