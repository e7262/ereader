/* EPUB 解析：container.xml → OPF（書目、manifest、spine）→ 目錄（EPUB3 nav 或 EPUB2 NCX）。
   章節 XHTML 不直接塞進頁面，而是用白名單重建 DOM：丟掉腳本、樣式表、表單與所有屬性，
   只留下排版需要的結構。這樣一來不受原書 CSS 干擾（護眼排版由閱讀器統一控制），也不會執行書裡的程式碼。 */
(function (R) {
  'use strict';

  const DC = 'http://purl.org/dc/elements/1.1/';
  const XLINK = 'http://www.w3.org/1999/xlink';

  // 原書標籤 → 閱讀器輸出的標籤；不在表上的標籤會被「拆殼」（保留內文、丟掉標籤本身）
  const KEEP = {
    p: 'p', div: 'div', section: 'div', article: 'div', aside: 'div', header: 'div', footer: 'div', main: 'div', nav: 'div',
    h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6',
    blockquote: 'blockquote', pre: 'pre', hr: 'hr', figure: 'figure', figcaption: 'figcaption',
    ul: 'ul', ol: 'ol', li: 'li', dl: 'dl', dt: 'dt', dd: 'dd',
    table: 'table', thead: 'thead', tbody: 'tbody', tfoot: 'tfoot', tr: 'tr', td: 'td', th: 'th', caption: 'caption',
    em: 'em', i: 'i', strong: 'strong', b: 'b', u: 'u', s: 's', del: 'del', ins: 'ins', mark: 'mark',
    sub: 'sub', sup: 'sup', small: 'small', code: 'code', kbd: 'kbd', samp: 'samp', var: 'var',
    cite: 'cite', q: 'q', abbr: 'abbr', dfn: 'dfn', span: 'span', a: 'a', br: 'br',
    ruby: 'ruby', rt: 'rt', rp: 'rp', rb: 'rb',
  };
  const DROP = new Set([
    'head', 'title', 'meta', 'link', 'style', 'script', 'noscript', 'template', 'iframe', 'frame', 'object', 'embed',
    'form', 'input', 'button', 'select', 'textarea', 'audio', 'video', 'source', 'track', 'canvas', 'map', 'area',
  ]);
  const IMAGE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif' };

  function parseXML(text, type) {
    if (!text) return null;
    const doc = new DOMParser().parseFromString(text, type || 'application/xml');
    return doc.getElementsByTagName('parsererror').length ? null : doc;
  }

  function dirOf(path) {
    const i = path.lastIndexOf('/');
    return i < 0 ? '' : path.slice(0, i + 1);
  }

  // 把相對 href 解析成 ZIP 內的絕對路徑；回傳 [路徑, 錨點]
  function resolve(baseDir, href) {
    const hash = href.indexOf('#');
    const frag = hash >= 0 ? href.slice(hash + 1) : '';
    let path = (hash >= 0 ? href.slice(0, hash) : href).split('?')[0];
    try { path = decodeURIComponent(path); } catch (e) { /* 保留原樣 */ }
    const parts = (path.startsWith('/') ? path.slice(1) : baseDir + path).split('/');
    const out = [];
    for (const seg of parts) {
      if (seg === '..') out.pop();
      else if (seg && seg !== '.') out.push(seg);
    }
    return [out.join('/'), frag];
  }

  function firstText(doc, ns, name) {
    const el = doc.getElementsByTagNameNS(ns, name)[0];
    return el ? el.textContent.trim().replace(/\s+/g, ' ') : '';
  }

  function byLocalName(root, name) {
    return [...root.getElementsByTagNameNS('*', name)];
  }

  async function parse(buffer) {
    const zip = R.zip.open(buffer);

    const container = parseXML(await zip.text('META-INF/container.xml'));
    const rootfile = container && byLocalName(container, 'rootfile')[0];
    const opfPath = (rootfile && rootfile.getAttribute('full-path')) || zip.names().find((n) => /\.opf$/i.test(n));
    if (!opfPath) throw new Error('EPUB 缺少 OPF 套件檔');
    const opf = parseXML(await zip.text(opfPath));
    if (!opf) throw new Error('EPUB 的 OPF 無法解析');
    const opfDir = dirOf(opfPath);

    const manifest = new Map(); // id → { path, type, props }
    const typeOf = new Map(); // path → media-type
    for (const item of byLocalName(opf, 'item')) {
      const [path] = resolve(opfDir, item.getAttribute('href') || '');
      const info = { path, type: item.getAttribute('media-type') || '', props: item.getAttribute('properties') || '' };
      manifest.set(item.getAttribute('id'), info);
      typeOf.set(path, info.type);
    }

    const spine = [];
    for (const ref of byLocalName(opf, 'itemref')) {
      const item = manifest.get(ref.getAttribute('idref'));
      if (item && /html|xml/i.test(item.type) && zip.has(item.path)) spine.push(item.path);
    }
    if (!spine.length) throw new Error('EPUB 沒有可閱讀的章節');
    const spineIndex = new Map(spine.map((p, i) => [p, i]));

    const meta = {
      title: firstText(opf, DC, 'title'),
      author: firstText(opf, DC, 'creator'),
      lang: firstText(opf, DC, 'language'),
    };

    // 沒標語言、或只寫 zh 時，從前幾章的文字判斷繁簡（lang 會影響手機選用的字形）
    if (!meta.lang || /^zh$/i.test(meta.lang)) {
      let sample = '';
      for (const path of spine.slice(0, 4)) sample += ((await zip.text(path)) || '').replace(/<[^>]*>/g, '');
      meta.lang = R.txt.guessLang(sample);
    }

    // ---------- 目錄 ----------
    const toc = [];
    function addEntry(title, href, baseDir, depth) {
      if (!title || !href) return;
      const [path, frag] = resolve(baseDir, href);
      if (spineIndex.has(path)) toc.push({ title, ch: spineIndex.get(path), frag, depth });
    }

    const navItem = [...manifest.values()].find((m) => /(^|\s)nav(\s|$)/.test(m.props));
    if (navItem) {
      const navDoc = parseXML(await zip.text(navItem.path), 'application/xhtml+xml');
      if (navDoc) {
        const navs = byLocalName(navDoc, 'nav');
        const nav = navs.find((n) => /toc/.test(n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || n.getAttribute('epub:type') || '')) || navs[0];
        const walk = (ol, depth) => {
          for (const li of ol.children) {
            if (li.localName !== 'li') continue;
            const label = [...li.children].find((c) => c.localName === 'a' || c.localName === 'span');
            if (label) addEntry(label.textContent.trim().replace(/\s+/g, ' '), label.getAttribute('href'), dirOf(navItem.path), depth);
            const sub = [...li.children].find((c) => c.localName === 'ol');
            if (sub) walk(sub, depth + 1);
          }
        };
        const ol = nav && [...nav.children].find((c) => c.localName === 'ol');
        if (ol) walk(ol, 0);
      }
    }
    if (!toc.length) {
      const spineEl = byLocalName(opf, 'spine')[0];
      const ncxItem = manifest.get(spineEl && spineEl.getAttribute('toc')) || [...manifest.values()].find((m) => /ncx/.test(m.type));
      const ncx = ncxItem && parseXML(await zip.text(ncxItem.path));
      if (ncx) {
        const walk = (parent, depth) => {
          for (const np of parent.children) {
            if (np.localName !== 'navPoint') continue;
            const label = byLocalName(np, 'text')[0];
            const content = byLocalName(np, 'content')[0];
            addEntry(label && label.textContent.trim(), content && content.getAttribute('src'), dirOf(ncxItem.path), depth);
            walk(np, depth + 1);
          }
        };
        const navMap = byLocalName(ncx, 'navMap')[0];
        if (navMap) walk(navMap, 0);
      }
    }

    const chapters = spine.map((path, i) => {
      const entry = toc.find((t) => t.ch === i);
      return { title: entry ? entry.title : '', size: Math.max(1, zip.size(path)) };
    });
    if (!toc.length) chapters.forEach((c, i) => toc.push({ title: '第 ' + (i + 1) + ' 節', ch: i, frag: '', depth: 0 }));

    // ---------- 圖片：用 blob: URL 提供給頁面，關書時一併釋放 ----------
    const imageURLs = new Map();
    async function imageURL(path) {
      if (!imageURLs.has(path)) {
        const ext = (path.split('.').pop() || '').toLowerCase();
        const blob = await zip.blob(path, typeOf.get(path) || IMAGE_TYPES[ext] || '');
        imageURLs.set(path, blob ? URL.createObjectURL(blob) : '');
      }
      return imageURLs.get(path);
    }

    // ---------- 章節內容：白名單重建 ----------
    function rebuild(src, out, baseDir, pending) {
      for (const node of src.childNodes) {
        if (node.nodeType === 3) { out.appendChild(document.createTextNode(node.data)); continue; }
        if (node.nodeType !== 1) continue;
        const tag = node.localName.toLowerCase();
        if (DROP.has(tag)) continue;

        if (tag === 'img' || tag === 'image') {
          const href = node.getAttribute('src') || node.getAttributeNS(XLINK, 'href') || node.getAttribute('href');
          if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
            const img = document.createElement('img');
            img.alt = node.getAttribute('alt') || '';
            img.decoding = 'async';
            pending.push([img, resolve(baseDir, href)[0]]);
            out.appendChild(img);
          }
          continue;
        }
        if (tag === 'svg') {
          // 封面常用 <svg><image/></svg> 包圖；只取出其中的點陣圖
          for (const im of byLocalName(node, 'image')) rebuild({ childNodes: [im] }, out, baseDir, pending);
          continue;
        }

        const mapped = KEEP[tag];
        if (!mapped) { rebuild(node, out, baseDir, pending); continue; }

        const el = document.createElement(mapped);
        const id = node.getAttribute('id');
        if (id) el.dataset.id = id; // 不用 id，避免和閱讀器自己的元素撞名
        if (tag === 'a') {
          const href = node.getAttribute('href');
          if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href)) el.dataset.href = resolve(baseDir, href).join('#');
        }
        const hint = ((node.getAttribute('class') || '') + ' ' + (node.getAttribute('style') || '')).toLowerCase();
        if (/cent(er|re)/.test(hint)) el.className = 'ac';
        else if (/right/.test(hint)) el.className = 'ar';
        rebuild(node, el, baseDir, pending);
        out.appendChild(el);
      }
    }

    async function load(i) {
      const path = spine[i];
      const text = await zip.text(path);
      const doc = parseXML(text, 'application/xhtml+xml') || new DOMParser().parseFromString(text || '', 'text/html');
      const body = doc.body || byLocalName(doc, 'body')[0] || doc.documentElement;
      const frag = document.createDocumentFragment();
      const pending = [];
      rebuild(body, frag, dirOf(path), pending);
      await Promise.all(pending.map(async ([img, p]) => {
        const url = await imageURL(p).catch(() => '');
        if (url) img.src = url; else img.remove();
      }));
      return frag;
    }

    function resolveLink(target) {
      const hash = target.indexOf('#');
      const path = hash >= 0 ? target.slice(0, hash) : target;
      const frag = hash >= 0 ? target.slice(hash + 1) : '';
      return spineIndex.has(path) ? { ch: spineIndex.get(path), frag } : null;
    }

    function dispose() {
      for (const url of imageURLs.values()) if (url) URL.revokeObjectURL(url);
      imageURLs.clear();
    }

    return { format: 'epub', meta, chapters, toc, load, resolveLink, dispose };
  }

  R.epub = { parse };
})(window.Reader = window.Reader || {});
