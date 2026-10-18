/* 本機儲存：書檔與閱讀進度存在 IndexedDB，偏好設定存在 localStorage。
   所有資料只留在這台裝置的瀏覽器裡，不會上傳。 */
(function (R) {
  'use strict';

  const DB_NAME = 'ink-lcd-reader';
  const DB_VERSION = 1;
  let opening = null;

  function open() {
    if (!opening) {
      opening = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          // books：書目與進度（小）；files：原始檔案 Blob（大），分開存以免列書架時讀進整本書
          if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return opening;
  }

  // 在一個交易裡執行 fn(stores)，交易完成後回傳 fn 最後一個 request 的結果
  function run(storeNames, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(storeNames, mode);
      const stores = storeNames.map((n) => t.objectStore(n));
      let result;
      const req = fn(...stores);
      if (req) req.onsuccess = () => { result = req.result; };
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('儲存失敗（空間可能不足）'));
    }));
  }

  R.db = {
    listBooks: () => run(['books'], 'readonly', (s) => s.getAll()),
    getBook: (id) => run(['books'], 'readonly', (s) => s.get(id)),
    putBook: (book) => run(['books'], 'readwrite', (s) => s.put(book)),
    getFile: (id) => run(['files'], 'readonly', (s) => s.get(id)).then((r) => r && r.blob),
    addBook: (book, blob) => run(['books', 'files'], 'readwrite', (books, files) => {
      files.put({ id: book.id, blob });
      return books.put(book);
    }),
    deleteBook: (id) => run(['books', 'files'], 'readwrite', (books, files) => {
      files.delete(id);
      return books.delete(id);
    }),
  };

  const SETTINGS_KEY = 'ink-lcd-reader:settings';

  R.prefs = {
    load(defaults) {
      try {
        const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
        return Object.assign({}, defaults, saved);
      } catch (e) {
        return Object.assign({}, defaults);
      }
    },
    save(settings) {
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* 私密模式等情況下忽略 */ }
    },
  };
})(window.Reader = window.Reader || {});
