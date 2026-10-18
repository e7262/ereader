/* 點陣小圖：像電子雞那樣用一格一格的像素畫出來，顏色跟著螢幕墨色（currentColor）走。 */
(function (R) {
  'use strict';

  const BITMAPS = {
    // 書架上的小守護者「眼眼」：睜眼／眨眼兩格
    pet: [
      [
        '................',
        '.....######.....',
        '...##......##...',
        '..#..........#..',
        '.#............#.',
        '.#..##....##..#.',
        '#...##....##...#',
        '#..............#',
        '#..#........#..#',
        '#...#......#...#',
        '.#...######...#.',
        '.#............#.',
        '..##........##..',
        '....########....',
        '....#......#....',
        '...##......##...',
      ],
      [
        '................',
        '.....######.....',
        '...##......##...',
        '..#..........#..',
        '.#............#.',
        '.#............#.',
        '#..####..####..#',
        '#..............#',
        '#..#........#..#',
        '#...#......#...#',
        '.#...######...#.',
        '.#............#.',
        '..##........##..',
        '....########....',
        '....#......#....',
        '...##......##...',
      ],
    ],
    book: [
      [
        '..............',
        '.#####..#####.',
        '#.....##.....#',
        '#.###.##.###.#',
        '#.....##.....#',
        '#.###.##.###.#',
        '#.....##.....#',
        '#.###.##.###.#',
        '#.....##.....#',
        '.#####..#####.',
        '..............',
      ],
    ],
  };

  function svg(name, frame) {
    const rows = BITMAPS[name][frame || 0];
    let rects = '';
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === '#') rects += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
    });
    return '<svg viewBox="0 0 ' + rows[0].length + ' ' + rows.length + '" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true">' + rects + '</svg>';
  }

  // 每秒換一格（像液晶寵物那樣一步一步動，不做平滑動畫）；使用者偏好減少動態時就停在第一格
  function animate(el, name) {
    const frames = BITMAPS[name].length;
    let f = 0;
    el.innerHTML = svg(name, 0);
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (frames < 2 || reduce) return () => {};
    const timer = setInterval(() => {
      // 大多時間睜著眼，偶爾眨一下
      f = f === 0 && Math.random() < 0.3 ? 1 : 0;
      el.innerHTML = svg(name, f);
    }, 1000);
    return () => clearInterval(timer);
  }

  R.sprites = { svg, animate };
})(window.Reader = window.Reader || {});
