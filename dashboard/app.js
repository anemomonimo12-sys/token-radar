// Launch Radar's dashboard. Reads window.RADAR (data.js, written beside dashboard/ by main.ts)
// and renders the ranked board, its filters, a per-protocol detail view with the valuation's
// arithmetic and the farm plan, and the live-token comparison set the multiples came from.
// No network: every byte it shows arrived in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('app');
  if (!DATA || !app) return;
  var M = DATA.model;

  // ---------- formatting ----------
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs';
    if (days >= 30) return Math.round(days / 30.4) + ' mo';
    return Math.max(0, Math.round(days)) + ' d';
  }
  function fmtMult(n) { return n === null || n === undefined ? 'n/a' : n.toFixed(2) + 'x'; }

  // ---------- tiny DOM helper ----------
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---------- state (the hash carries it, so a view is a link and a screenshot) ----------
  function parseHash() {
    var s = { p: null, tab: 'all', cat: 'all', chain: 'all', q: '', sort: 'rank', dir: 1 };
    var h = location.hash.replace(/^#/, '');
    h.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      if (kv.length === 2) {
        var k = kv[0], v = decodeURIComponent(kv[1]);
        if (k === 'p') s.p = v;
        else if (k === 'tab' && (v === 'watch' || v === 'early' || v === 'all')) s.tab = v;
        else if (k === 'cat') s.cat = v;
        else if (k === 'chain') s.chain = v;
        else if (k === 'q') s.q = v;
        else if (k === 'sort') s.sort = v;
      }
    });
    return s;
  }
  var state = parseHash();
  function syncHash() {
    var parts = [];
    if (state.p) parts.push('p=' + encodeURIComponent(state.p));
    if (state.tab !== 'all') parts.push('tab=' + state.tab);
    if (state.cat !== 'all') parts.push('cat=' + encodeURIComponent(state.cat));
    if (state.chain !== 'all') parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.sort !== 'rank') parts.push('sort=' + state.sort);
    history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname + location.search);
  }

  var bySlug = {};
  DATA.rows.forEach(function (r) { bySlug[r.slug] = r; });

  // The page recomputes a row's implied value from the snapshot figures and the stated model,
  // the same arithmetic lib/model.ts runs: if the two ever disagreed, the detail view says so.
  function recompute(row) {
    var cat = M.categories[row.category || '(uncategorised)'];
    var multiple = cat ? cat.multiple : M.global_multiple;
    var growth = Math.min(M.momentum_cap_pct, Math.max(M.momentum_floor_pct, row.change_7d === null ? 0 : row.change_7d));
    var momentum = 1 + (growth / 100) * M.momentum_weight;
    var age = row.age_days === null ? M.unknown_age_days : row.age_days;
    var maturity = M.maturity_start + (1 - M.maturity_start) * (Math.min(Math.max(age, 0), M.maturity_days) / M.maturity_days);
    var reach = 1 + M.reach_per_chain * Math.min(Math.max(row.chains.length - 1, 0), M.reach_max_extra_chains);
    return Math.min(Math.max(1, Math.round(row.tvl_usd * multiple * momentum * maturity * reach)), DATA.value_cap_usd);
  }

  // ---------- filtering and sorting ----------
  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.tab === 'watch' && !r.watchlist) return false;
      if (state.tab === 'early' && r.watchlist) return false;
      if (state.cat !== 'all' && (r.category || '(uncategorised)') !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = state.sort;
    var dir = key === 'rank' || key === 'name' ? 1 : -1;
    rows.sort(function (a, b) {
      var va, vb;
      if (key === 'implied') { va = a.implied_value_usd; vb = b.implied_value_usd; }
      else if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'change') { va = a.change_7d === null ? -1e9 : a.change_7d; vb = b.change_7d === null ? -1e9 : b.change_7d; }
      else if (key === 'age') { va = a.age_days === null ? -1 : a.age_days; vb = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'ready') { va = a.readiness; vb = b.readiness; }
      else if (key === 'name') { return a.name < b.name ? -1 : a.name > b.name ? 1 : a.rank - b.rank; }
      else { va = a.rank; vb = b.rank; }
      return (va - vb) * dir || (a.rank - b.rank);
    });
    return rows;
  }

  // ---------- render ----------
  function stat(label, value) {
    return el('div', { 'class': 'stat' }, el('b', { text: value }), el('span', { text: label }));
  }

  function header() {
    return el('div', { 'class': 'top' },
      el('div', { 'class': 'brand' },
        el('div', { 'class': 'rings', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')),
        el('div', null,
          el('h1', { text: 'Launch Radar' }),
          el('div', { 'class': 'sub', text: 'Pre-token protocols ranked by implied launch value — and how to farm each one' }))),
      el('div', { 'class': 'stats' },
        stat('protocols scanned', String(DATA.scanned_size)),
        stat('pre-token ranked', String(DATA.board_size)),
        stat('watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size),
        stat('total implied', fmtUsd(DATA.total_implied_usd)),
        stat('snapshot', DATA.as_of)));
  }

  function modelStrip() {
    var cats = Object.keys(M.categories).map(function (k) { return { k: k, m: M.categories[k] }; });
    cats.sort(function (a, b) { return b.m.samples - a.m.samples; });
    var chips = cats.slice(0, 8).map(function (c) {
      var chip = el('span', { 'class': 'chip' }, document.createTextNode(c.k + ' '));
      chip.appendChild(el('b', { text: fmtMult(c.m.multiple) }));
      return chip;
    });
    return el('section', { 'class': 'model' },
      el('div', null,
        el('div', { 'class': 'formula' },
          document.createTextNode('implied value = TVL x '),
          el('b', { text: 'category multiple' }),
          document.createTextNode(' x momentum x maturity x reach')),
        el('p', { text: 'The multiple is what the market already pays for one dollar of TVL in the same category: the median market-cap/TVL of this snapshot\u2019s live-token protocols, shrunk toward the snapshot-wide median (' + fmtMult(M.global_multiple) + ') by sample size. Momentum is the week\u2019s TVL change at half weight, maturity the length of the protocol\u2019s record, reach its chain count. No name is special-cased; the cap is the largest live market cap in the snapshot.' })),
      el('div', { 'class': 'chips' }, chips));
  }

  function controls(total, shown) {
    var catSet = {};
    var chainCount = {};
    DATA.rows.forEach(function (r) {
      catSet[r.category || '(uncategorised)'] = true;
      r.chains.forEach(function (c) { chainCount[c] = (chainCount[c] || 0) + 1; });
    });
    var catSel = el('select', { 'aria-label': 'Category', onchange: function () { state.cat = catSel.value; syncHash(); render(); } },
      [el('option', { value: 'all', text: 'All categories' })].concat(
        Object.keys(catSet).sort().map(function (c) {
          var o = el('option', { value: c, text: c });
          if (state.cat === c) o.setAttribute('selected', '');
          return o;
        })));
    var chains = Object.keys(chainCount).sort(function (a, b) { return chainCount[b] - chainCount[a]; }).slice(0, 24);
    var chainSel = el('select', { 'aria-label': 'Chain', onchange: function () { state.chain = chainSel.value; syncHash(); render(); } },
      [el('option', { value: 'all', text: 'All chains' })].concat(
        chains.map(function (c) {
          var o = el('option', { value: c, text: c });
          if (state.chain === c) o.setAttribute('selected', '');
          return o;
        })));
    function tabBtn(id, label) {
      return el('button', {
        'aria-pressed': state.tab === id ? 'true' : 'false',
        onclick: function () { state.tab = id; syncHash(); render(); },
        text: label,
      });
    }
    var search = el('input', {
      type: 'search', placeholder: 'Search name, category, chain', value: state.q, 'aria-label': 'Search',
      oninput: function () { state.q = search.value; syncHash(); renderTable(); },
    });
    return el('div', { 'class': 'controls' },
      el('div', { 'class': 'tabs' }, tabBtn('all', 'All pre-token'), tabBtn('watch', 'Watchlist'), tabBtn('early', 'Early finds')),
      search, catSel, chainSel,
      el('span', { 'class': 'count', id: 'rowcount', text: 'showing ' + shown + ' of ' + total }));
  }

  function sortTh(label, key, cls) {
    var mark = state.sort === key ? ' \u25be' : '';
    return el('th', { 'class': cls || '' },
      el('button', { onclick: function () { state.sort = key; syncHash(); render(); }, text: label + mark }));
  }

  function rowEl(r) {
    var badge = r.watchlist
      ? el('span', { 'class': 'badge watch', text: 'watchlist' })
      : el('span', { 'class': 'badge early', text: 'early' });
    var bar = el('span', { 'class': 'bar' }, el('i', null));
    bar.firstChild.style.width = r.readiness + '%';
    var tr = el('tr', { onclick: function () { state.p = r.slug; syncHash(); render(); window.scrollTo(0, 0); } },
      el('td', { 'class': 'rank', text: '#' + r.rank }),
      el('td', { 'class': 'l' },
        el('span', { 'class': 'pname', text: r.name }), badge,
        el('div', { 'class': 'pcat', text: (r.category || 'Uncategorised') + ' \u00b7 ' + (r.chains.slice(0, 3).join(', ') || 'no chains listed') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') })),
      el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }),
      el('td', { 'class': 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
      el('td', { 'class': 'num', text: fmtAge(r.age_days) }),
      el('td', null, el('span', { 'class': 'ready' }, el('span', { 'class': 'num', text: String(r.readiness) }), bar)),
      el('td', { 'class': 'num implied', text: fmtUsd(r.implied_value_usd) }));
    if (state.p === r.slug) tr.className = 'sel';
    return tr;
  }

  var tableHost = null;
  function boardTable() {
    var rows = visibleRows();
    var shown = rows.slice(0, 150);
    var thead = el('thead', null, el('tr', null,
      sortTh('#', 'rank'), sortTh('Protocol', 'name', 'l'), sortTh('TVL', 'tvl'),
      sortTh('7d', 'change'), sortTh('Record', 'age'), sortTh('Ready', 'ready'), sortTh('Implied value', 'implied')));
    var tbody = el('tbody', null, shown.map(rowEl));
    tableHost = el('div', null,
      el('table', null, thead, tbody),
      rows.length > shown.length
        ? el('div', { 'class': 'more', text: 'First ' + shown.length + ' of ' + rows.length + ' rows shown — filter or search to narrow the board. Every row is in board.json.' })
        : null);
    tableHost.dataset.total = String(rows.length);
    tableHost.dataset.shown = String(shown.length);
    return tableHost;
  }
  function renderTable() {
    // Search-as-you-type refreshes only the table and the count, keeping focus in the box.
    var fresh = boardTable();
    if (tableHost && tableHost.parentNode) tableHost.parentNode.replaceChild(fresh, tableHost);
    var c = document.getElementById('rowcount');
    if (c) c.textContent = 'showing ' + fresh.dataset.shown + ' of ' + fresh.dataset.total;
  }

  function detail(r) {
    var cat = M.categories[r.category || '(uncategorised)'];
    var samples = cat ? cat.samples : 0;
    var check = recompute(r);
    var peers = DATA.rows.filter(function (x) { return x.slug !== r.slug && x.category === r.category; }).slice(0, 3);
    function factor(label, value) {
      return el('div', { 'class': 'factor' }, el('span', { text: label }), document.createTextNode(value));
    }
    var plan = el('ol', { 'class': 'plan' }, r.farm_plan.map(function (s) {
      return el('li', null,
        el('span', { 'class': 'n', 'aria-hidden': 'true' }),
        el('span', { 'class': 'txt', text: s.action }),
        el('span', { 'class': 'tags' }, el('b', { text: s.cost }), document.createTextNode(s.time)));
    }));
    function kv(k, v) { return el('div', { 'class': 'kv' }, el('span', { text: k }), el('b', { text: v })); }
    return el('section', { 'class': 'detail' },
      el('div', { 'class': 'dhead' },
        el('h2', { text: r.name }),
        r.watchlist ? el('span', { 'class': 'badge watch', text: 'watchlist' }) : el('span', { 'class': 'badge early', text: 'early find' }),
        el('span', { 'class': 'meta', text: 'rank #' + r.rank + ' \u00b7 ' + (r.category || 'Uncategorised') + ' \u00b7 ' + (r.chains.join(', ') || 'no chains listed') + ' \u00b7 tracked since ' + (r.listed_at || 'unknown') }),
        el('button', { 'class': 'close', onclick: function () { state.p = null; syncHash(); render(); }, text: 'Close' })),
      el('div', { 'class': 'valuation' },
        factor('TVL', fmtUsd(r.tvl_usd)), el('span', { 'class': 'op', text: 'x' }),
        factor((r.category || 'category') + ' multiple, ' + samples + ' live peers', fmtMult(r.model.multiple)), el('span', { 'class': 'op', text: 'x' }),
        factor('momentum ' + fmtPct(r.change_7d), fmtMult(r.model.momentum_multiplier)), el('span', { 'class': 'op', text: 'x' }),
        factor('maturity, ' + fmtAge(r.age_days), fmtMult(r.model.maturity_multiplier)), el('span', { 'class': 'op', text: 'x' }),
        factor('reach, ' + r.chains.length + (r.chains.length === 1 ? ' chain' : ' chains'), fmtMult(r.model.reach_multiplier)), el('span', { 'class': 'op', text: '=' }),
        el('div', { 'class': 'factor total' }, el('span', { text: 'implied launch value' }), el('b', { text: fmtUsd(r.implied_value_usd) }))),
      el('p', { 'class': 'check' },
        document.createTextNode('Recomputed on this page from the snapshot figures: '),
        el('b', { text: fmtUsd(check) }),
        document.createTextNode(check === r.implied_value_usd ? ' — the same number board.json carries.' : ' — differs from board.json; trust board.json.')),
      el('div', { 'class': 'dgrid' },
        el('div', null, el('h3', { text: 'Farm plan' }), plan),
        el('div', { 'class': 'side' },
          el('h3', { text: 'The record' }),
          kv('Readiness', r.readiness + ' / 100'),
          kv('TVL vs $50M floor', r.tvl_usd >= DATA.floor_usd ? 'above' : 'below'),
          kv('7d TVL change', fmtPct(r.change_7d)),
          kv('Record length', fmtAge(r.age_days)),
          kv('Category multiple', fmtMult(r.model.multiple) + ' (global ' + fmtMult(M.global_multiple) + ')'),
          el('h3', { text: 'Next in this category', style: 'margin-top:14px' }),
          peers.map(function (p) {
            return el('div', { 'class': 'peer' },
              el('b', { text: '#' + p.rank + ' ' + p.name }),
              document.createTextNode(' — ' + fmtUsd(p.implied_value_usd) + ' implied on ' + fmtUsd(p.tvl_usd) + ' TVL'));
          }))));
  }

  function liveStrip() {
    var rows = DATA.live.slice(0, 12).map(function (p) {
      return el('tr', null,
        el('td', { 'class': 'l' }, el('span', { 'class': 'pname', text: p.name }),
          el('div', { 'class': 'pcat', text: (p.category || 'Uncategorised') + ' \u00b7 ' + (p.symbol || '') })),
        el('td', { 'class': 'num', text: fmtUsd(p.tvl_usd) }),
        el('td', { 'class': 'num', text: fmtUsd(p.mcap_usd) }),
        el('td', { 'class': 'num', text: fmtMult(p.multiple) }));
    });
    return el('section', { 'class': 'live' },
      el('h2', { text: 'Already trading — the comparison set' }),
      el('p', { text: 'These protocols have a token; the board never ranks them. Their market-cap/TVL ratios are the multiples the model applies to the pre-token board above.' }),
      el('table', null,
        el('thead', null, el('tr', null,
          el('th', { 'class': 'l', text: 'Protocol' }), el('th', { text: 'TVL' }), el('th', { text: 'Market cap' }), el('th', { text: 'Cap / TVL' }))),
        el('tbody', null, rows)));
  }

  function footer() {
    return el('footer', null,
      el('b', { text: 'How to read this board. ' }),
      document.createTextNode('An implied value is a claim about what a launch would be worth at the multiples comparable live tokens already carry — never a prediction that a token is issued, or when. Protocols are described as recording no token, on the snapshot\u2019s evidence alone. Data: a sealed snapshot of DefiLlama\u2019s public protocol list, fetched ' + DATA.as_of + '; the page runs entirely from that snapshot and makes no network calls. Model ' + DATA.model_version + '.'));
  }

  function render() {
    var rows = visibleRows();
    var children = [header(), modelStrip()];
    if (state.p && bySlug[state.p]) children.push(detail(bySlug[state.p]));
    children.push(controls(rows.length, Math.min(rows.length, 150)));
    children.push(boardTable());
    children.push(liveStrip());
    children.push(footer());
    app.innerHTML = '';
    var shell = el('div', { 'class': 'shell' }, children);
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
  }

  render();
})();
