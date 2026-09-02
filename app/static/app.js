'use strict';
const $ = s => document.querySelector(s);
const el = (t, cls, txt) => { const e = document.createElement(t);
  if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

let DEVICES = [], DEV = null, VAL = {}, ERR = {}, TIMER = null, PENDING = null;
let CAT = 'control';

const CATS = [
  ['control', 'Sterowanie'], ['state', 'Status'], ['special', 'Funkcje specjalne'],
  ['ident', 'Identyfikacja'], ['diag', 'Diagnostyka'], ['*', 'Wszystko'],
];

const api = async (url, opts) => {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({ error: 'zła odpowiedź serwera' }));
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
};
const v = k => VAL[k];
const txt = k => (ERR[k] ? '—' : (VAL[k] ? VAL[k].text : '—'));

// ---------------------------------------------------------------- start

async function boot() {
  DEVICES = (await api('/api/devices')).devices;
  const nav = $('#devtabs'); nav.innerHTML = '';
  DEVICES.forEach((d, i) => {
    const b = el('button', '', d.name.split(' - ')[0]);
    b.dataset.id = d.id;
    b.onclick = () => pick(d.id);
    nav.appendChild(b);
    if (i === 0) pick(d.id);
  });
  const ct = $('#cattabs'); ct.innerHTML = '';
  CATS.forEach(([id, label]) => {
    const b = el('button', id === CAT ? 'on' : '', label);
    b.dataset.cat = id;
    b.onclick = () => { CAT = id;
      ct.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.cat === id));
      renderTables(); };
    ct.appendChild(b);
  });
}

function pick(id) {
  DEV = DEVICES.find(d => d.id === id);
  document.querySelectorAll('#devtabs button')
    .forEach(b => b.classList.toggle('on', b.dataset.id === id));
  $('#devnote').textContent = DEV.note || '';
  $('#regcount').textContent = `${DEV.registers.length} rejestrów`;
  renderAll();
  refresh();
}

// ---------------------------------------------------------------- karty

function units() {
  const m = new Map();
  DEV.registers.forEach(r => {
    const u = r.iu ?? 0;
    if (!m.has(u)) m.set(u, { label: r.iu_label || r.group, regs: [] });
    m.get(u).regs.push(r);
  });
  return m;
}

function bySlot(regs, slot) {
  return regs.filter(r => r.card === slot)
             .sort((a, b) => (a.card_order || 99) - (b.card_order || 99));
}

function metricTile(r) {
  const t = el('div', 'metric');
  t.appendChild(el('span', 'k', r.name));
  const val = el('span', 'v');
  const cur = v(r.key);
  if (cur && typeof cur.value === 'number') {
    val.textContent = cur.value.toFixed(1);
    if (r.unit) val.appendChild(el('small', '', r.unit));
  } else val.textContent = '—';
  t.appendChild(val);
  return t;
}

function stepperTile(r) {
  const t = el('div', 'metric');
  t.appendChild(el('span', 'k', r.name));
  const cur = v(r.key);
  let val = cur && typeof cur.value === 'number' ? cur.value : (r.wmin ?? 20);
  const wrap = el('div', 'stepper');
  const minus = el('button', '', '−');
  const show = el('span', 'val');
  const plus = el('button', '', '+');
  const step = r.wstep || 0.5;
  const paint = () => show.textContent = val.toFixed(1);
  paint();
  minus.onclick = () => { val = Math.max(r.wmin ?? -99, +(val - step).toFixed(1)); paint(); };
  plus.onclick = () => { val = Math.min(r.wmax ?? 99, +(val + step).toFixed(1)); paint(); };
  const set = el('button', 'ghost small', 'Ustaw');
  set.onclick = () => askWrite(r, val);
  wrap.append(minus, show, plus, set);
  t.appendChild(wrap);
  return t;
}

function selectRow(r) {
  const row = el('div', 'row');
  row.appendChild(el('label', '', r.name));
  const s = el('select');
  Object.entries(r.enum).forEach(([k, t]) => s.add(new Option(t, k)));
  const cur = v(r.key);
  if (cur) s.value = String(cur.raw);
  s.onchange = () => askWrite(r, s.value);
  row.appendChild(s);
  if (r.status_key) row.appendChild(el('span', 'now', 'stan: ' + txt(r.status_key)));
  return row;
}

function card(unit, info) {
  const regs = info.regs;
  const model = regs.find(r => r.card === 'ident');
  const nerr = regs.filter(r => ERR[r.key]).length;
  const offline = nerr > regs.length / 2;
  const absent = !offline && model && v(model.key) && v(model.key).absent;

  const c = el('article', 'card' + (absent || offline ? ' absent' : ''));
  const head = el('div', 'card-head');
  const pwr = regs.find(r => r.card === 'power');
  const on = pwr && v(pwr.status_key) && v(pwr.status_key).value;
  head.appendChild(el('span', 'dot' + (on ? ' on' : '')));
  head.appendChild(el('h2', '', info.label));
  if (offline) head.appendChild(el('span', 'tag err', 'brak łączności z bramką'));
  else if (absent) head.appendChild(el('span', 'tag absent', 'brak na magistrali'));
  if (pwr) {
    const b = el('button', 'pwr' + (on ? ' on' : ''), on ? 'WŁ' : 'WYŁ');
    b.title = 'Przełącz zasilanie';
    b.onclick = () => askWrite(pwr, on ? '0' : '1');
    head.appendChild(b);
  }
  c.appendChild(head);

  if (offline) {
    const box = el('div', 'rows');
    box.appendChild(el('p', 'note', 'Bramka nie odpowiada — wartości i sterowanie niedostępne.'));
    c.appendChild(box);
    const f0 = el('div', 'card-foot');
    f0.appendChild(el('span', '', `${nerr} z ${regs.length} rejestrów bez odpowiedzi`));
    c.appendChild(f0);
    return c;
  }

  const met = el('div', 'metrics');
  bySlot(regs, 'metric').forEach(r => met.appendChild(metricTile(r)));
  bySlot(regs, 'metric-edit').forEach(r => met.appendChild(stepperTile(r)));
  if (met.children.length) c.appendChild(met);

  const rows = el('div', 'rows');
  bySlot(regs, 'select').forEach(r => rows.appendChild(selectRow(r)));
  if (rows.children.length) c.appendChild(rows);

  const chips = el('div', 'chips');
  bySlot(regs, 'chip').forEach(r => {
    const st = r.status_key && v(r.status_key) && v(r.status_key).value;
    const b = el('button', 'chip' + (st ? ' on' : ''), r.name);
    b.onclick = () => askWrite(r, st ? '0' : '1');
    chips.appendChild(b);
  });
  if (chips.children.length) c.appendChild(chips);

  const flags = el('div', 'flags');
  bySlot(regs, 'flag').forEach(r => {
    const active = v(r.key) && v(r.key).value;
    const kind = active ? (r.flag_kind || 'ok') : '';
    flags.appendChild(el('span', 'flag ' + kind, `${r.name}: ${active ? 'tak' : 'nie'}`));
  });
  if (flags.children.length) c.appendChild(flags);

  const foot = el('div', 'card-foot');
  foot.appendChild(el('span', '', model ? `model: ${txt(model.key)}` : ''));
  c.appendChild(foot);
  return c;
}

function renderCards() {
  const root = $('#cards'); root.innerHTML = '';
  units().forEach((info, u) => root.appendChild(card(u, info)));
}

// ---------------------------------------------------------------- tabela

function renderTables() {
  const root = $('#tables'); root.innerHTML = '';
  const q = $('#q').value.trim().toLowerCase();
  const onlyW = $('#onlywrite').checked;

  units().forEach((info) => {
    const rows = info.regs.filter(r => {
      if (CAT !== '*' && r.cat !== CAT) return false;
      if (onlyW && !r.writable) return false;
      if (!q) return true;
      return (r.name + ' ' + r.key + ' ' + r.number + ' ' + r.space).toLowerCase().includes(q);
    });
    if (!rows.length) return;

    const w = el('div', 'tblwrap');
    w.appendChild(el('h3', '', info.label + ' — ' + rows.length));
    const t = el('table');
    t.innerHTML = '<thead><tr><th>Rejestr</th><th>Przestrzeń</th><th>Nazwa</th>' +
                  '<th>Wartość</th><th>Zapis</th></tr></thead>';
    const tb = el('tbody');
    rows.forEach(r => {
      const tr = el('tr');
      const c1 = el('td', 'num'); c1.innerHTML = `${r.number}<span class="sub">addr ${r.addr}</span>`;
      const c2 = el('td', 'num', r.space);
      const c3 = el('td');
      c3.textContent = r.name;
      if (r.writable) c3.appendChild(el('span', 'wtag', 'zapis'));
      if (r.note) c3.appendChild(el('span', 'sub', r.note));
      const c4 = el('td', 'val');
      if (ERR[r.key]) { c4.classList.add('err'); c4.textContent = ERR[r.key]; }
      else c4.textContent = txt(r.key);
      const c5 = el('td', 'act');
      if (r.writable) {
        const ed = editor(r);
        const b = el('button', 'ghost small', 'Ustaw');
        b.onclick = () => askWrite(r, ed.value);
        c5.append(ed, ' ', b);
      } else c5.appendChild(el('span', 'note', '—'));
      tr.append(c1, c2, c3, c4, c5);
      tb.appendChild(tr);
    });
    t.appendChild(tb); w.appendChild(t); root.appendChild(w);
  });
  if (!root.children.length) root.appendChild(el('p', 'note', 'Brak rejestrów dla tego filtra.'));
}

function editor(r) {
  const cur = v(r.key);
  if (r.type === 'bool') {
    const s = el('select');
    [['1', 'ON'], ['0', 'OFF']].forEach(([x, t]) => s.add(new Option(t, x)));
    if (cur) s.value = cur.value ? '1' : '0';
    return s;
  }
  if (r.enum) {
    const s = el('select');
    Object.entries(r.enum).forEach(([x, t]) => s.add(new Option(`${t} (${x})`, x)));
    if (cur) s.value = String(cur.raw);
    return s;
  }
  const i = el('input'); i.type = 'number'; i.style.width = '86px';
  if (r.wstep) i.step = r.wstep;
  if (r.wmin !== undefined) i.min = r.wmin;
  if (r.wmax !== undefined) i.max = r.wmax;
  if (cur && typeof cur.value === 'number') i.value = cur.value;
  return i;
}

function renderAll() { renderCards(); renderTables(); }

// ---------------------------------------------------------------- odczyt / zapis

async function refresh() {
  const st = $('#status');
  st.className = 'pill'; st.textContent = 'odczyt…';
  try {
    const d = await api('/api/read?device=' + encodeURIComponent(DEV.id));
    VAL = d.values; ERR = d.errors || {};
    const n = Object.keys(ERR).length;
    st.className = 'pill ' + (n ? 'bad' : 'ok');
    st.textContent = n ? `${n} błędów · ${d.frames} ramek · ${d.took_ms} ms`
                       : `OK · ${d.frames} ramek · ${d.took_ms} ms`;
    renderAll();
  } catch (e) {
    st.className = 'pill bad'; st.textContent = 'błąd: ' + e.message;
  }
  api('/api/diag?device=' + encodeURIComponent(DEV.id))
    .then(d => {
      const num = x => typeof x === 'number';
      $('#diag').textContent = num(d.bus_message_count)
        ? `ramek ${d.bus_message_count} · błędy CRC ${d.bus_comm_error_count} · do slave ${d.slave_message_count}`
        : 'diagnostyka niedostępna — interfejs nie odpowiada';
    })
    .catch(() => $('#diag').textContent = '');
}

async function askWrite(reg, value) {
  try {
    const p = await api('/api/preview', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device: DEV.id, key: reg.key, value }) });
    PENDING = { key: reg.key, value };
    $('#mdetails').innerHTML = `
      <dt>Jednostka</dt><dd>${reg.iu_label || '—'}</dd>
      <dt>Rejestr</dt><dd>${p.number} · ${p.space} · addr ${p.addr}</dd>
      <dt>Nazwa</dt><dd>${p.name}</dd>
      <dt>Wartość</dt><dd>${value} → ${p.raw} (0x${p.raw.toString(16).toUpperCase().padStart(4, '0')})</dd>
      <dt>Funkcja</dt><dd>0x${p.func.toString(16).padStart(2, '0')}</dd>
      <dt>Ramka</dt><dd>${p.frame}</dd>`;
    $('#modal').classList.remove('hidden');
  } catch (e) { alert('Nie można zapisać: ' + e.message); }
}

async function doWrite() {
  $('#mok').disabled = true;
  try {
    await api('/api/write', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device: DEV.id, ...PENDING }) });
    $('#modal').classList.add('hidden');
    await refresh();
  } catch (e) { alert('Zapis nieudany: ' + e.message); }
  $('#mok').disabled = false;
}

async function showAudit() {
  const d = await api('/api/audit');
  $('#auditbody').innerHTML = d.rows.length
    ? '<table><thead><tr><th>Czas</th><th>Rejestr</th><th>Nazwa</th><th>Wartość</th><th>Ramka</th></tr></thead><tbody>'
      + d.rows.map(r => `<tr><td class="num">${new Date(r.ts * 1000).toLocaleString('pl-PL')}</td>`
        + `<td class="num">${r.number}</td><td>${r.name}</td>`
        + `<td class="val">${r.value}</td><td class="num">${r.frame}</td></tr>`).join('')
      + '</tbody></table>'
    : '<p class="note">Brak zapisów.</p>';
  $('#auditmodal').classList.remove('hidden');
}


// ---------------------------------------------------------------- terminal na zywo

let LOGSEQ = 0, LOGTIMER = null;
const MAXLINES = 800;

// --- dobor polozenia doku: prawo dopoki najdluzsza linia sie miesci, potem dol ---
let MAXCOLS = 0, CHARW = 0;
const MAIN_MIN = 780;   // ponizej tego karty robia sie nieczytelne
const TERM_MIN = 460, TERM_MAX = 1400;

function charWidth() {
  if (CHARW) return CHARW;
  const probe = el('span');
  const body = $('#termbody');
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
  probe.style.font = getComputedStyle(body).font;
  probe.textContent = '0'.repeat(100);
  document.body.appendChild(probe);
  CHARW = probe.getBoundingClientRect().width / 100;
  probe.remove();
  return CHARW;
}

function neededWidth() {
  return Math.ceil(MAXCOLS * charWidth()) + 40;   // 40 = padding + margines na scrollbar
}

function layoutTerm() {
  const shell = document.querySelector('.shell');
  const pref = $('#termpos').value;
  const need = neededWidth();
  let mode;
  if (pref === 'right' || pref === 'bottom') mode = pref;
  else mode = (need <= window.innerWidth - MAIN_MIN) ? 'right' : 'bottom';

  shell.classList.toggle('dock-right', mode === 'right');
  shell.classList.toggle('dock-bottom', mode === 'bottom');
  if (mode === 'right') {
    const w = Math.min(TERM_MAX, Math.max(TERM_MIN,
      Math.min(need, window.innerWidth - MAIN_MIN)));
    shell.style.setProperty('--termw', w + 'px');
  }
  const fits = mode === 'bottom'
    ? need <= window.innerWidth - 8
    : need <= parseInt(getComputedStyle(shell).getPropertyValue('--termw') || '0', 10);
  $('#termfit').textContent = MAXCOLS
    ? `${MAXCOLS} zn. · ${need} px` + (fits ? '' : ' · przewijanie w poziomie')
    : '';
}

const hhmmss = ts => {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString('pl-PL', { hour12: false }) +
         '.' + String(d.getMilliseconds()).padStart(3, '0');
};
const grp = h => (h || '').replace(/(..)/g, '$1 ').trim();
const BPL = 16;                       // bajtow na linie — 48 znakow, mniej niz szerokosc kafelka
function hexChunks(h) {
  const bytes = (h || '').match(/../g) || [];
  const out = [];
  for (let i = 0; i < bytes.length; i += BPL) out.push(bytes.slice(i, i + BPL).join(' '));
  return out.length ? out : [''];
}
function hexRows(box, label, hex, cls, ms) {
  hexChunks(hex).forEach((chunk, i, all) => {
    const line = el('div', 'fr ' + cls);
    line.appendChild(el('span', 'd', i === 0 ? label : ''));
    line.appendChild(document.createTextNode(' ' + chunk));
    if (ms != null && i === all.length - 1) line.appendChild(el('span', 'ms', ms + ' ms'));
    box.appendChild(line);
  });
}

function termLine(cls, ts, body) {
  const d = el('div', 'tl ' + cls);
  d.appendChild(el('span', 't', hhmmss(ts) + '  '));
  d.appendChild(document.createTextNode(body));
  return d;
}

function noteCols(text) {
  for (const line of String(text).split('\n')) {
    const n = line.length + 14;                 // 14 = prefiks z czasem
    if (n > MAXCOLS) MAXCOLS = n;
  }
}

function pushEntries(entries) {
  const body = $('#termbody');
  const before = MAXCOLS;
  entries.forEach(e => {
    if (e.kind === 'note') {
      noteCols('— ' + e.text);
      body.appendChild(termLine('note ' + (e.level || ''), e.ts, '— ' + e.text));
      return;
    }
    const where = e.addr !== null && e.addr !== undefined
      ? ` addr ${e.addr}${e.count ? '×' + e.count : ''}` : '';
    const txt1 = `TX  slave ${e.unit}  ${e.fname}${where}\n    ${grp(e.tx)}`;
    noteCols(txt1);
    body.appendChild(termLine('tx', e.ts, txt1));
    if (e.ok) {
      const txt2 = `RX  ${e.ms} ms\n    ${grp(e.rx)}`;
      noteCols(txt2);
      body.appendChild(termLine('rx', e.ts, txt2));
    } else {
      const txt3 = `ERR ${e.ms} ms  ${e.err}${e.code != null ? ` (kod 0x${e.code.toString(16).padStart(2, '0')})` : ''}`;
      noteCols(txt3);
      body.appendChild(termLine('err', e.ts, txt3));
    }
  });
  while (body.children.length > MAXLINES) body.removeChild(body.firstChild);
  if ($('#termfollow').checked) body.scrollTop = body.scrollHeight;
  $('#termstat').textContent = `${body.children.length} linii`;
  if (MAXCOLS !== before) layoutTerm();
}

async function pollLog() {
  try {
    const d = await api('/api/log?since=' + LOGSEQ);
    if (d.entries.length) { pushEntries(d.entries); LOGSEQ = d.last; }
    else LOGSEQ = d.last;
  } catch { /* cicho — terminal nie moze psuc reszty */ }
}

function termToggle() {
  const t = $('#term');
  const open = t.classList.toggle('hidden');
  $('#termbtn').classList.toggle('on', !open);
  const shell = document.querySelector('.shell');
  if (!open) {
    layoutTerm();
    if (LOGSEQ === 0) pollLog();
    LOGTIMER = setInterval(pollLog, 1000);
  } else {
    clearInterval(LOGTIMER); LOGTIMER = null;
    shell.classList.remove('dock-right', 'dock-bottom');
  }
}

// ---------------------------------------------------------------- diagnostyka

const TRACE_LBL = { pending: 'oczekuje', run: 'trwa…', ok: 'OK',
                    warn: 'uwaga', fail: 'błąd', skip: 'pominięte' };

const IO_CLS = { TX: 'tx', RX: 'rx', ERR: 'err', '?': 'q', '=': 'eq' };

function frameRows(frames, ioRows) {
  const box = el('div', 'frames');
  (ioRows || []).forEach(r => {
    const line = el('div', 'fr ' + (IO_CLS[r.d] || 'eq'));
    line.appendChild(el('span', 'd', r.d === '=' ? '' : r.d));
    line.appendChild(document.createTextNode(' ' + r.text));
    if (r.ms != null) line.appendChild(el('span', 'ms', r.ms + ' ms'));
    box.appendChild(line);
  });
  (frames || []).forEach(f => {
    hexRows(box, 'TX', f.tx, 'tx', null);
    if (f.ok && f.rx) {
      hexRows(box, 'RX', f.rx, 'rx', f.ms);
    } else {
      const er = el('div', 'fr err');
      er.appendChild(el('span', 'd', 'ERR'));
      er.appendChild(document.createTextNode(' ' + (f.err || 'brak odpowiedzi')));
      box.appendChild(er);
    }
  });
  return box;
}

function renderVerdict(v) {
  const chain = $('#chain');
  const old = chain.querySelector('.node.verdict');
  if (old) old.remove();
  const n = el('div', 'node verdict ' + v.level);
  n.appendChild(el('span', 'nm', 'Wynik'));
  n.appendChild(el('span', 'st', v.head));
  const body = el('div', 'vbody');
  const sect = (title, items, cls) => {
    if (!items || !items.length) return;
    const col = el('div', 'vcol');          // naglowek i lista musza byc jedna komorka siatki
    col.appendChild(el('h4', cls, title));
    const ul = el('ul', cls);
    items.forEach(t => ul.appendChild(el('li', '', t)));
    col.appendChild(ul);
    body.appendChild(col);
  };
  sect('Dzia\u0142a', v.ok, 'good');
  sect('Nie dzia\u0142a', v.bad, 'bad');
  sect('Co zrobi\u0107', v.todo, 'todo');
  n.appendChild(body);
  const ai = el('div', 'aibox off');
  ai.id = 'aibox';
  ai.textContent = 'komentarz AI wy\u0142\u0105czony w konfiguracji';
  n.appendChild(ai);
  chain.appendChild(n);
}

function paintNode(id, st) {
  const n = document.querySelector(`.node[data-id="${id}"]`);
  if (!n) return;
  n.className = 'node ' + (st.state || 'pending');
  n.querySelector('.st').textContent =
    (TRACE_LBL[st.state] || st.state) + (st.ms != null ? ` · ${st.ms} ms` : '');
  n.querySelector('.dt').textContent = st.detail || '';
  const old = n.querySelector('.frames');
  if (old) old.remove();
  if ((st.frames && st.frames.length) || (st.io && st.io.length))
    n.appendChild(frameRows(st.frames, st.io));
}

function traceSkeleton() {
  const chain = $('#chain');
  chain.innerHTML = '';
  [['app', 'Aplikacja modbus-ui'],
   ['net', `Bramka ${DEV.host}:${DEV.port}`],
   ['iface', `Interfejs Modbus (slave ${DEV.slave})`],
   ['rs485', 'Magistrala RS-485'],
   ['uh', 'Magistrala Uh (TU2C-LINK)']].forEach(([id, name], i, all) => {
    const n = el('div', 'node pending');
    n.dataset.id = id;
    n.appendChild(el('span', 'no', (i + 1) + '/' + all.length));
    n.appendChild(el('span', 'nm', name));
    n.appendChild(el('span', 'st', TRACE_LBL.pending));
    n.appendChild(el('span', 'dt', ''));
    chain.appendChild(n);
  });
}

function traceToggle() {
  const panel = $('#trace');
  const closed = panel.classList.toggle('hidden');
  $('#tracebtn').classList.toggle('on', !closed);
  if (!closed && !$('#chain').children.length) {
    traceSkeleton();
    $('#tracets').textContent = 'nie uruchomiono';
    $('#tracedet').innerHTML = '';
  }
}

async function runTrace() {
  const panel = $('#trace');
  panel.classList.remove('hidden');
  $('#tracebtn').classList.add('on');
  $('#chain').innerHTML = '';
  $('#tracedet').innerHTML = '';
  $('#tracets').textContent = 'test w toku…';
  $('#tracerun').disabled = true;

  const hints = [];
  const unitBoxes = el('div', 'unitgrid');
  $('#tracedet').appendChild(unitBoxes);

  try {
    const res = await fetch('/api/trace/stream?device=' + encodeURIComponent(DEV.id));
    if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const part of parts) {
        const line = part.split('\n').find(x => x.startsWith('data:'));
        if (!line) continue;
        const ev = JSON.parse(line.slice(5));

        if (ev.type === 'plan') {
          const chain = $('#chain');
          ev.steps.forEach((stp, i) => {
            const n = el('div', 'node pending');
            n.dataset.id = stp.id;
            n.appendChild(el('span', 'no', (i + 1) + '/' + ev.steps.length));
            n.appendChild(el('span', 'nm', stp.name));
            n.appendChild(el('span', 'st', TRACE_LBL.pending));
            n.appendChild(el('span', 'dt', ''));
            chain.appendChild(n);
          });
        } else if (ev.type === 'step') {
          paintNode(ev.id, ev);
          if (ev.hint) hints.push({ id: ev.id, hint: ev.hint });
        } else if (ev.type === 'unit') {
          const u = ev.unit;
          unitBoxes.appendChild(el('div', 'ubox ' + (u.present ? 'on' : 'off'),
            `${u.label}: ${u.present ? (u.model || 'obecna') : 'brak odpowiedzi'}`));
        } else if (ev.type === 'verdict') {
          renderVerdict(ev);
        } else if (ev.type === 'verdict_ai') {
          const box = $('#aibox');
          if (!box) continue;
          if (ev.state === 'run') { box.className = 'aibox run'; box.textContent = 'analiza lokalnego modelu…'; }
          else if (ev.text) {
            box.className = 'aibox';
            box.innerHTML = '';
            box.appendChild(el('span', 'ailabel', 'AI'));
            box.appendChild(document.createTextNode(' ' + ev.text));
            if (ev.model) box.appendChild(el('span', 'aimodel', ev.model));
          } else {
            box.className = 'aibox off';
            box.textContent = 'lokalny model nie odpowiedzia\u0142 — werdykt powy\u017cej pochodzi z regu\u0142, nie z AI';
          }
        } else if (ev.type === 'error') {
          throw new Error(ev.error);
        }
      }
    }

    hints.forEach(h => {
      const n = document.querySelector(`.node[data-id="${h.id}"] .nm`);
      $('#tracedet').insertBefore(
        el('div', 'hintbox', (n ? n.textContent + ': ' : '') + h.hint), unitBoxes);
    });
    $('#tracets').textContent = 'ostatni test: ' + new Date().toLocaleTimeString('pl-PL');
  } catch (e) {
    $('#tracets').textContent = 'błąd testu: ' + e.message;
  }
  $('#tracerun').disabled = false;
}


// ---------------------------------------------------------------- tryb administracyjny

// Wartosci ze specyfikacji Toshiby (Service Manual A10-2103 rev. 7, rozdz. 7)
// oraz z instrukcji bramek. Nie zgadywane.
const BAUDS = [
  { v: 9600,  sw3: 'Bit3 OFF · Bit4 OFF', note: 'ustawienie fabryczne u nas' },
  { v: 19200, sw3: 'Bit3 ON · Bit4 OFF',  note: 'Bit3 ON + Bit4 ON daje to samo 19200' },
  { v: 38400, sw3: 'Bit3 OFF · Bit4 ON',  note: 'najszybsze, jakie interfejs przyjmuje' },
];

const GATEWAYS = {
  ew11: {
    name: 'Elfin EW11',
    panel: 'panel webowy, logowanie admin/admin (domyslne — zmienic)',
    serial: 'Serial Port Settings: Baud Rate / Data Bit / Stop Bit / Parity',
    mode: 'Communication Settings: Protocol = Tcp Server, Local Port 8899, Rout = Uart',
    framing: 'rtuovertcp',
    framingWhy: 'EW11 przepuszcza bajty bez konwersji, wiec po TCP ida surowe ramki RTU z CRC.',
    apply: 'Submit na stronie serial; zmiana predkosci dziala od razu, bez restartu modulu.',
  },
  waveshare: {
    name: 'Waveshare RS232/485 TO WIFI (POE) ETH (B)',
    panel: 'panel webowy, logowanie admin/admin (domyslne — zmienic)',
    serial: 'Serial: uart_baudrate / uart_bits / uart_parity / uart_stop / uart_fc',
    mode: 'Data_Transfor_Mode = 5 (Modbus TCP <=> Modbus RTU), net_mode server, net_port 502',
    framing: 'tcp',
    framingWhy: 'W trybie 5 bramka sama konwertuje MBAP na RTU, wiec aplikacja laczy sie zwyklym Modbus TCP.',
    apply: 'Apply na stronie, potem Restart modulu.',
  },
};

function adminRow(k, v, cls) {
  const tr = el('tr');
  tr.appendChild(el('th', '', k));
  const td = el('td', cls || '');
  td.innerHTML = v;
  tr.appendChild(td);
  return tr;
}

let ADMMSG = null;

function renderAdmin() {
  const gw = (DEV.gateway || {});
  const g = GATEWAYS[gw.type] || GATEWAYS.ew11;
  const root = $('#adminbody');
  root.innerHTML = '';

  // --- 1. edytowalne parametry polaczenia
  const s1 = el('div', 'adm');
  s1.appendChild(el('h3', '', '1 · Polaczenie z bramka — edytowalne'));
  const form = el('div', 'admform');
  const fields = {};
  const addField = (key, label, type, opts) => {
    const row = el('div', 'frow');
    const lab = el('label', '', label);
    if ((DEV._overridden || []).includes(key)) lab.appendChild(el('span', 'ovr', 'zmienione'));
    row.appendChild(lab);
    let inp;
    if (type === 'select') {
      inp = el('select');
      opts.forEach(o => inp.add(new Option(o[1], o[0])));
      inp.value = String(DEV[key]);
    } else {
      inp = el('input');
      inp.type = type;
      if (type === 'number') { inp.step = opts.step; inp.min = opts.min; inp.max = opts.max; }
      inp.value = DEV[key];
    }
    fields[key] = inp;
    row.appendChild(inp);
    form.appendChild(row);
  };
  addField('host', 'Adres bramki', 'text');
  addField('port', 'Port', 'number', { step: 1, min: 1, max: 65535 });
  addField('framing', 'Ramkowanie', 'select',
    [['rtuovertcp', 'rtuovertcp — most przezroczysty'], ['tcp', 'tcp — bramka konwertuje MBAP']]);
  addField('slave', 'Adres slave', 'number', { step: 1, min: 1, max: 247 });
  addField('timeout', 'Timeout (s)', 'number', { step: 0.5, min: 0.5, max: 60 });

  const grow = el('div', 'frow');
  grow.appendChild(el('label', '', 'Panel bramki'));
  const gurl = el('input'); gurl.type = 'text'; gurl.value = gw.url || '';
  grow.appendChild(gurl); form.appendChild(grow);

  const gtrow = el('div', 'frow');
  gtrow.appendChild(el('label', '', 'Typ bramki'));
  const gtype = el('select');
  [['ew11', 'Elfin EW11'], ['waveshare', 'Waveshare (B)'], ['generic', 'inna']]
    .forEach(o => gtype.add(new Option(o[1], o[0])));
  gtype.value = gw.type || 'ew11';
  gtrow.appendChild(gtype); form.appendChild(gtrow);

  s1.appendChild(form);
  const bar = el('div', 'admbar');
  const save = el('button', 'primary small', 'Zapisz i przelacz');
  const reset = el('button', 'ghost small', 'Przywroc z pliku');
  const msg = el('span', 'admmsg');
  if (ADMMSG) { msg.className = 'admmsg ' + ADMMSG[0]; msg.textContent = ADMMSG[1]; ADMMSG = null; }
  bar.append(save, reset, msg);
  s1.appendChild(bar);
  s1.appendChild(el('p', 'admnote',
    'Zmiany trafiaja do warstwy nadpisan w /var/lib/modbus-ui/overrides.json — '
    + 'plik /etc/modbus-ui/config.json zostaje nietkniety. '
    + '„Przywroc z pliku" kasuje nadpisania dla tego urzadzenia.'));

  const post = async (url, payload, okMsg) => {
    save.disabled = reset.disabled = true;
    msg.className = 'admmsg';
    msg.textContent = 'zapisywanie…';
    try {
      await api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                       body: JSON.stringify(payload) });
      DEVICES = (await api('/api/devices')).devices;
      DEV = DEVICES.find(d => d.id === DEV.id);
      ADMMSG = ['ok', okMsg];
      renderAdmin();
      renderAll();
      refresh();
    } catch (e) {
      msg.className = 'admmsg bad';
      msg.textContent = 'blad: ' + e.message;
      save.disabled = reset.disabled = false;
    }
  };
  save.onclick = () => post('/api/config', { device: DEV.id, changes: {
      host: fields.host.value, port: +fields.port.value, framing: fields.framing.value,
      slave: +fields.slave.value, timeout: +fields.timeout.value,
      gateway: { url: gurl.value, type: gtype.value },
    } }, 'zapisano — trwa ponowny odczyt');
  reset.onclick = () => post('/api/config/reset', { device: DEV.id }, 'przywrocono z pliku');

  const t1 = el('table', 'adm-t');
  t1.appendChild(adminRow('Ramkowanie', g.framingWhy));
  t1.appendChild(adminRow('Adres slave',
    `interfejs zajmuje tez <span class="mono">${DEV.slave + 1}</span> i <span class="mono">${DEV.slave + 2}</span>`));
  t1.appendChild(adminRow('Zapis', DEV.write_enabled ? 'wlaczony' : 'WYLACZONY'));
  s1.appendChild(t1);
  root.appendChild(s1);

  // --- 2. strona bramki
  const s2 = el('div', 'adm');
  s2.appendChild(el('h3', '', '2 · Bramka RS-485 / WiFi — ' + g.name));
  const t2 = el('table', 'adm-t');
  const link = gw.url ? `<a href="${gw.url}" target="_blank" rel="noreferrer">${gw.url}</a>` : '—';
  [['Panel', link + ' — ' + g.panel],
   ['Parametry portu', g.serial],
   ['Tryb pracy', g.mode],
   ['Zatwierdzenie', g.apply],
  ].forEach(([k, v]) => t2.appendChild(adminRow(k, v)));
  if (gw.note) t2.appendChild(adminRow('Uwaga', gw.note, 'warnc'));
  s2.appendChild(t2);
  root.appendChild(s2);

  // --- 3. strona Toshiby
  const s3 = el('div', 'adm');
  s3.appendChild(el('h3', '', '3 · Interfejs Toshiba BMS-IFMB1280U-E — przelaczniki'));
  const t3 = el('table', 'adm-t');
  [['SW1', 'adres slave Modbus, zakres <span class="mono">1–F</span>. '
         + '<b>Przy 0 modul nie odpowiada na nic.</b> Po zmianie wcisnij <span class="mono">SW7</span>.'],
   ['SW2', 'przelacznik testowy — ma byc <span class="mono">0</span>'],
   ['SW3 Bit1', 'tryb ustawiania Central controller ID — <span class="mono">OFF</span> w normalnej pracy'],
   ['SW3 Bit2', 'zrodlo dla LED5: <span class="mono">OFF</span> = RS-485, <span class="mono">ON</span> = Uh line'],
   ['SW3 Bit3/4', 'predkosc RS-485 — patrz tabela nizej. Po zmianie wcisnij <span class="mono">SW7</span>.'],
   ['SW5', 'terminator RS-485 <span class="mono">120 Ω</span> — strona <span class="mono">ON</span>. '
         + 'Wlaczyc tylko na interfejsie o adresie 1.'],
   ['SW6', 'terminator magistrali Uh — zostawic <span class="mono">open</span>, '
         + 'terminacje robi RAC I/F przez SW21'],
   ['SW7', 'reset — czyta na nowo SW1 i SW3'],
   ['Central controller ID', 'przy podlaczonych RAC I/F musi byc <span class="mono">old controller</span>: '
         + 'SW3 Bit1 → ON, SW1 → F, wcisnij SW4, SW3 Bit1 → OFF, <b>SW1 z powrotem na adres</b>, SW7'],
  ].forEach(([k, v]) => t3.appendChild(adminRow(k, v)));
  s3.appendChild(t3);
  root.appendChild(s3);

  // --- 4. odwzorowanie parametrow
  const s4 = el('div', 'adm wide');
  s4.appendChild(el('h3', '', '4 · Co ustawic po obu stronach'));
  const sel = el('select');
  BAUDS.forEach(b => sel.add(new Option(b.v + ' bps', b.v)));
  sel.value = 9600;
  const pick = el('div', 'baudpick');
  pick.appendChild(el('label', '', 'Docelowa predkosc:'));
  pick.appendChild(sel);
  s4.appendChild(pick);

  const t4 = el('table', 'adm-t map');
  t4.innerHTML = '<thead><tr><th>Parametr</th><th>Bramka ' + g.name + '</th>'
               + '<th>Toshiba BMS-IFMB1280U-E</th><th>Zmienne?</th></tr></thead>';
  const tb = el('tbody');
  t4.appendChild(tb);
  const paint = () => {
    const b = BAUDS.find(x => String(x.v) === sel.value);
    tb.innerHTML = '';
    [['Predkosc', `<span class="mono">${b.v}</span> bps`,
      `<span class="mono">SW3 ${b.sw3}</span><br><span class="sub">${b.note}</span>`, 'tak'],
     ['Bity danych', '<span class="mono">8</span>', 'na sztywno <span class="mono">8</span>', 'nie'],
     ['Parzystosc', '<span class="mono">EVEN</span>', 'na sztywno <span class="mono">EVEN</span>', 'nie'],
     ['Bity stopu', '<span class="mono">1</span>', 'na sztywno <span class="mono">1</span>', 'nie'],
     ['Sterowanie przeplywem', '<span class="mono">brak</span>', 'nie dotyczy', 'nie'],
     ['Terminacja', 'zwykle brak — bramka na koncu linii ma wlasna',
      '<span class="mono">SW5 = 120 Ω</span> na interfejsie o adresie 1', 'tak'],
     ['Adres slave', 'nie dotyczy — bramka nie adresuje',
      `<span class="mono">SW1 = ${DEV.slave}</span>`, 'tak'],
    ].forEach(([p, a, c, ch]) => {
      const tr = el('tr');
      [p, a, c].forEach((x, i) => {
        const td = el('td', i === 0 ? 'pname' : 'mono2');
        td.innerHTML = x; tr.appendChild(td);
      });
      tr.appendChild(el('td', ch === 'nie' ? 'fixed' : 'chg', ch === 'nie' ? 'nie' : 'tak'));
      tb.appendChild(tr);
    });
  };
  sel.onchange = paint;
  paint();
  s4.appendChild(t4);
  s4.appendChild(el('p', 'admnote',
    'Parzystosc, bity danych i bit stopu sa okreslone przez specyfikacje Toshiby '
    + '(Specifications Manual, rozdz. 2) i nie da sie ich zmienic po stronie interfejsu — '
    + 'to bramka musi sie do nich dostosowac. Zmienna jest wylacznie predkosc, adres slave i terminacja.'));
  s4.appendChild(el('p', 'admnote warnc',
    'Kolejnosc przy zmianie predkosci: najpierw przestaw SW3 i wcisnij SW7, potem bramke. '
    + 'Miedzy jednym a drugim lacznosc bedzie zerwana — to normalne.'));
  root.appendChild(s4);
}

function adminToggle() {
  const p = $('#admin');
  const closed = p.classList.toggle('hidden');
  $('#adminbtn').classList.toggle('on', !closed);
  if (!closed) renderAdmin();
}

// ---------------------------------------------------------------- adaptery RAC I/F

// Przelaczniki sa fizyczne - aplikacja ich nie czyta i nie ustawia. Panel trzyma to,
// co czlowiek zastal na plytce, a wartosc docelowa liczy serwer z adresow w config.json.
// Zadna z tych operacji nie wysyla ramki na magistrale.

let MODVIEW = null;   // odpowiedz /api/modules
let MODEDIT = {};     // robocza kopia stanu, n -> {sw21,sw61,sw62,sw63,sw64}
let MODMSG = {};      // n -> [klasa, tekst]
let MODPLAN = null;   // wynik ostatniego wyliczenia, do pokazania obok
let MODIFACE = null;  // robocza kopia stanu interfejsu Modbus
let MODIMSG = null;

const clone = o => JSON.parse(JSON.stringify(o));

async function modLoad() {
  MODVIEW = await api('/api/modules?device=' + encodeURIComponent(DEV.id));
  MODEDIT = {};
  MODVIEW.modules.forEach(m => { MODEDIT[m.n] = clone(m.state); });
  MODIFACE = clone(MODVIEW.iface.state);
  renderModules();
}

function modDiff(m) {
  const st = MODEDIT[m.n], out = [];
  m.board.forEach(sw => {
    if (sw.kind === 'dip') {
      sw.bits.forEach(b => {
        const have = !!st[sw.id][b.i - 1];
        if (have !== b.target)
          out.push(`${sw.name} Bit${b.i}: ${have ? 'ON' : 'OFF'} → ${b.target ? 'ON' : 'OFF'}`);
      });
    } else if (sw.kind === 'rotary') {
      if (st[sw.id] !== sw.target) out.push(`${sw.name}: ${st[sw.id]} → ${sw.target}`);
    }
  });
  return out;
}

function modAddress(m) {
  const st = MODEDIT[m.n];
  return (st.sw61[0] ? 100 : 0) + st.sw64 * 10 + st.sw63;
}

function dipRow(m, sw) {
  const st = MODEDIT[m.n];
  const row = el('div', 'dipsw');
  const head = el('div', 'dipname');
  head.appendChild(el('b', '', sw.name));
  head.appendChild(el('span', 'sub', sw.title.split('—').pop().trim()));
  row.appendChild(head);

  const bank = el('div', 'dipbank');
  sw.bits.forEach(b => {
    const cell = el('div', 'dipcell');
    const btn = el('button', 'dip');
    const on = !!st[sw.id][b.i - 1];
    btn.classList.add(on ? 'on' : 'off');
    if (on !== b.target) btn.classList.add('wrong');
    btn.title = `Bit${b.i} — docelowo ${b.target ? 'ON' : 'OFF'}`;
    btn.innerHTML = '<span class="lever"></span>';
    btn.onclick = () => { st[sw.id][b.i - 1] = !st[sw.id][b.i - 1]; renderModules(); };
    cell.appendChild(btn);
    cell.appendChild(el('span', 'dipno', String(b.i)));
    cell.appendChild(el('span', 'dipval' + (on !== b.target ? ' wrongtxt' : ''), on ? 'ON' : 'OFF'));
    bank.appendChild(cell);
  });
  row.appendChild(bank);
  return row;
}

function rotaryRow(m, sw) {
  const st = MODEDIT[m.n];
  const row = el('div', 'dipsw');
  const head = el('div', 'dipname');
  head.appendChild(el('b', '', sw.name));
  head.appendChild(el('span', 'sub', sw.title.split('—').pop().trim()));
  row.appendChild(head);

  const box = el('div', 'rotbox');
  const sel = el('select', 'rot' + (st[sw.id] !== sw.target ? ' wrongsel' : ''));
  for (let i = 0; i <= 9; i++) sel.add(new Option(String(i), String(i)));
  sel.value = String(st[sw.id]);
  sel.onchange = () => { st[sw.id] = +sel.value; renderModules(); };
  box.appendChild(sel);
  box.appendChild(el('span', 'dipval' + (st[sw.id] !== sw.target ? ' wrongtxt' : ''),
    'docelowo ' + sw.target));
  row.appendChild(box);
  return row;
}

function moduleCard(m) {
  const card = el('div', 'modcard');

  const h = el('header', 'modhead');
  h.appendChild(el('strong', '', m.label));
  const addr = modAddress(m);
  const abad = addr !== m.n;
  h.appendChild(el('span', 'badge ' + (abad ? 'bad' : 'ok'), 'adres ' + addr));
  if (m.terminator) h.appendChild(el('span', 'badge term', 'terminator Uh'));
  h.appendChild(el('span', 'grow'));
  if (m.state.saved_at) h.appendChild(el('span', 'sub', 'zapisano ' + m.state.saved_at));
  card.appendChild(h);

  const body = el('div', 'modbodyin');
  m.board.forEach(sw => {
    if (sw.kind === 'dip') body.appendChild(dipRow(m, sw));
    else if (sw.kind === 'rotary') body.appendChild(rotaryRow(m, sw));
  });
  card.appendChild(body);

  const d = modDiff(m);
  const dbox = el('div', 'moddiff' + (d.length ? '' : ' good'));
  if (!d.length) {
    dbox.appendChild(el('span', '', 'Zgodne z dokumentacją — nic do przestawienia.'));
  } else {
    dbox.appendChild(el('span', 'difftitle', `Do przestawienia (${d.length}):`));
    const ul = el('ul');
    d.forEach(x => ul.appendChild(el('li', 'mono', x)));
    dbox.appendChild(ul);
  }
  card.appendChild(dbox);

  const bar = el('div', 'modbar');
  const save = el('button', 'primary small', 'Zapisz stan zastany');
  const goal = el('button', 'ghost small', 'Wypełnij docelowymi');
  const back = el('button', 'ghost small', 'Cofnij zmiany');
  const msg = el('span', 'admmsg');
  if (MODMSG[m.n]) { msg.className = 'admmsg ' + MODMSG[m.n][0]; msg.textContent = MODMSG[m.n][1]; }

  goal.onclick = () => {
    const st = MODEDIT[m.n];
    m.board.forEach(sw => {
      if (sw.kind === 'dip') sw.bits.forEach(b => { st[sw.id][b.i - 1] = b.target; });
      else if (sw.kind === 'rotary') st[sw.id] = sw.target;
    });
    MODMSG[m.n] = ['', 'wypełnione wartościami docelowymi — sprawdź płytkę i zapisz'];
    renderModules();
  };
  back.onclick = () => { MODEDIT[m.n] = clone(m.state); delete MODMSG[m.n]; renderModules(); };
  save.onclick = async () => {
    save.disabled = goal.disabled = back.disabled = true;
    msg.className = 'admmsg'; msg.textContent = 'zapisywanie…';
    try {
      MODVIEW = await api('/api/modules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device: DEV.id, n: m.n, state: MODEDIT[m.n] }),
      });
      MODVIEW.modules.forEach(x => { MODEDIT[x.n] = clone(x.state); });
      MODMSG[m.n] = ['ok', 'zapisano'];
      renderModules();
    } catch (e) {
      MODMSG[m.n] = ['bad', 'błąd: ' + e.message];
      renderModules();
    }
  };
  bar.append(save, goal, back, msg);
  card.appendChild(bar);
  return card;
}


// Znalezisko z sugestia. `applyFn` dostaje c.apply i wpisuje wartosc do kopii roboczej -
// nic nie idzie na sprzet i nic nie jest zapisywane, dopoki ktos nie kliknie zapisu.
function findingRow(c, applyFn) {
  const tr = el('tr');
  tr.appendChild(el('th', c.level === 'bad' ? 'lvbad' : 'lvwarn', c.who || (c.level === 'bad' ? 'błąd' : 'uwaga')));
  const td = el('td', c.level === 'bad' ? 'badc' : 'warnc');
  const p = el('div');
  p.innerHTML = c.text;
  td.appendChild(p);

  if (c.have !== undefined && c.want !== undefined) {
    const hw = el('div', 'hw');
    hw.appendChild(el('span', 'hwlab', 'jest'));
    hw.appendChild(el('span', 'hwhave', c.have));
    hw.appendChild(el('span', 'hwarr', '→'));
    hw.appendChild(el('span', 'hwlab', 'ma być'));
    hw.appendChild(el('span', 'hwwant', c.want));
    td.appendChild(hw);
  }
  if (c.fix) {
    const f = el('div', 'fix');
    f.innerHTML = '<span class="fixlab">jak ustawić</span> ' + c.fix;
    td.appendChild(f);
  }
  if (c.apply && applyFn) {
    const b = el('button', 'ghost tiny', 'Wpisz docelowe');
    b.title = 'wpisuje wartość docelową do karty powyżej — na płytce nadal trzeba to przestawić ręcznie';
    b.onclick = () => applyFn(c.apply);
    td.appendChild(b);
  }
  tr.appendChild(td);
  return tr;
}

function applyToIface(a) {
  const st = MODIFACE;
  if (a.bit) st[a.sw][a.bit - 1] = a.value;
  else st[a.sw] = a.value;
  MODPLAN = null;
  MODIMSG = ['', 'wpisane w kartę interfejsu — sprawdź płytkę i zapisz'];
  renderModules();
}

function applyToModule(a) {
  const st = MODEDIT[a.n];
  if (!st) return;
  if (a.addr !== undefined) {
    st.sw61[0] = a.addr >= 100;
    st.sw64 = Math.floor(a.addr / 10) % 10;
    st.sw63 = a.addr % 10;
  } else if (a.bit) {
    st[a.sw][a.bit - 1] = a.value;
  } else {
    st[a.sw] = a.value;
  }
  MODMSG[a.n] = ['', 'wpisane — sprawdź płytkę i zapisz'];
  renderModules();
}

function ifaceCard() {
  const v = MODVIEW.iface, st = MODIFACE;
  const card = el('div', 'ifacecard');

  const h = el('header', 'modhead');
  h.appendChild(el('strong', '', 'Interfejs Modbus BMS-IFMB1280U-E'));
  h.appendChild(el('span', 'badge ok', 'slave ' + st.sw1));
  h.appendChild(el('span', 'badge term', BAUDNAME(st) + ' bps'));
  h.appendChild(el('span', 'grow'));
  h.appendChild(el('span', 'sub', 'tu wpięta jest bramka RS-485'));
  if (v.state.saved_at) h.appendChild(el('span', 'sub', '· zapisano ' + v.state.saved_at));
  card.appendChild(h);

  const body = el('div', 'ifacebody');
  v.board.forEach(sw => {
    const row = el('div', 'dipsw');
    const nm = el('div', 'dipname');
    nm.appendChild(el('b', '', sw.name));
    nm.appendChild(el('span', 'sub', sw.title.split('—').pop().trim()));
    row.appendChild(nm);

    if (sw.kind === 'hex') {
      const box = el('div', 'rotbox');
      const sel = el('select', 'rot');
      for (let i = 0; i <= 15; i++) sel.add(new Option(i.toString(16).toUpperCase(), String(i)));
      sel.value = String(st[sw.id]);
      sel.onchange = () => { st[sw.id] = +sel.value; MODPLAN = null; renderModules(); };
      box.appendChild(sel);
      if (sw.id === 'sw1')
        box.appendChild(el('span', 'dipval' + (st.sw1 === v.cfg_slave ? '' : ' wrongtxt'),
          'config.json: ' + v.cfg_slave));
      row.appendChild(box);
    } else if (sw.kind === 'dip') {
      const bank = el('div', 'dipbank');
      sw.bits.forEach(b => {
        const cell = el('div', 'dipcell');
        const btn = el('button', 'dip');
        const on = !!st[sw.id][b.i - 1];
        btn.classList.add(on ? 'on' : 'off');
        if (b.target !== null && b.target !== undefined && on !== b.target) btn.classList.add('wrong');
        btn.title = 'Bit' + b.i + (b.target === null || b.target === undefined
          ? ' — wartość zależy od wybranej prędkości' : ' — docelowo ' + (b.target ? 'ON' : 'OFF'));
        btn.innerHTML = '<span class="lever"></span>';
        btn.onclick = () => { st[sw.id][b.i - 1] = !on; MODPLAN = null; renderModules(); };
        cell.append(btn, el('span', 'dipno', String(b.i)), el('span', 'dipval', on ? 'ON' : 'OFF'));
        bank.appendChild(cell);
      });
      row.appendChild(bank);
    } else if (sw.kind === 'two') {
      const box = el('div', 'rotbox');
      const sel = el('select');
      sel.add(new Option(sw.off, 'off'));
      sel.add(new Option(sw.on, 'on'));
      sel.value = st[sw.id] ? 'on' : 'off';
      sel.onchange = () => { st[sw.id] = sel.value === 'on'; MODPLAN = null; renderModules(); };
      box.appendChild(sel);
      row.appendChild(box);
    } else if (sw.kind === 'choice') {
      const box = el('div', 'rotbox');
      const sel = el('select', 'wide');
      sw.options.forEach(o => sel.add(new Option(o[1], o[0])));
      sel.value = st.ccid;
      sel.onchange = () => { st.ccid = sel.value; MODPLAN = null; renderModules(); };
      box.appendChild(sel);
      row.appendChild(box);
    }
    body.appendChild(row);
  });
  card.appendChild(body);

  if (v.checks.length) {
    const t = el('table', 'adm-t find');
    v.checks.forEach(c => t.appendChild(findingRow(c, applyToIface)));
    const wrap = el('div', 'ifacechecks');
    wrap.appendChild(el('div', 'planhead', 'Zapisany stan interfejsu wobec instrukcji:'));
    wrap.appendChild(t);
    card.appendChild(wrap);
  }

  const bar = el('div', 'modbar');
  const save = el('button', 'primary small', 'Zapisz stan interfejsu');
  const calc = el('button', 'ghost small', 'Wylicz ustawienia adapterów');
  const back = el('button', 'ghost small', 'Cofnij zmiany');
  const msg = el('span', 'admmsg');
  if (MODIMSG) { msg.className = 'admmsg ' + MODIMSG[0]; msg.textContent = MODIMSG[1]; MODIMSG = null; }

  save.onclick = async () => {
    save.disabled = calc.disabled = back.disabled = true;
    msg.className = 'admmsg'; msg.textContent = 'zapisywanie…';
    try {
      MODVIEW = await api('/api/interface', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device: DEV.id, state: MODIFACE }),
      });
      MODIFACE = clone(MODVIEW.iface.state);
      MODIMSG = ['ok', 'zapisano'];
    } catch (e) { MODIMSG = ['bad', 'błąd: ' + e.message]; }
    renderModules();
  };
  calc.onclick = async () => {
    save.disabled = calc.disabled = back.disabled = true;
    msg.className = 'admmsg'; msg.textContent = 'liczenie…';
    try {
      MODPLAN = await api('/api/modules/derive', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device: DEV.id, iface: MODIFACE }),
      });
      Object.entries(MODPLAN.states).forEach(([n, x]) => { MODEDIT[+n] = x; });
      MODIMSG = ['ok', 'karty adapterów wypełnione — nic nie jest jeszcze zapisane'];
    } catch (e) { MODIMSG = ['bad', 'błąd: ' + e.message]; }
    renderModules();
  };
  back.onclick = () => { MODIFACE = clone(MODVIEW.iface.state); MODPLAN = null; renderModules(); };
  bar.append(save, calc, back, msg);
  card.appendChild(bar);
  return card;
}

function BAUDNAME(st) {
  const b3 = st.sw3[2], b4 = st.sw3[3];
  return b3 && !b4 ? 19200 : (!b3 && b4 ? 38400 : (b3 && b4 ? 19200 : 9600));
}

function saveAllBar() {
  const bar = el('div', 'derivebar');
  bar.appendChild(el('span', 'dlab',
    'Karty poniżej trzymają stan zastany na adapterach. Po wyliczeniu sprawdź je i zapisz.'));
  bar.appendChild(el('span', 'grow'));
  const all = el('button', 'ghost small', 'Zapisz wszystkie adaptery');
  const msg = el('span', 'admmsg');
  all.onclick = async () => {
    all.disabled = true;
    msg.className = 'admmsg'; msg.textContent = 'zapisywanie…';
    try {
      for (const m of MODVIEW.modules) {
        MODVIEW = await api('/api/modules', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device: DEV.id, n: m.n, state: MODEDIT[m.n] }),
        });
      }
      MODVIEW.modules.forEach(x => { MODEDIT[x.n] = clone(x.state); MODMSG[x.n] = ['ok', 'zapisano']; });
      MODIFACE = clone(MODVIEW.iface.state);
      renderModules();
    } catch (e) {
      msg.className = 'admmsg bad'; msg.textContent = 'błąd: ' + e.message;
      all.disabled = false;
    }
  };
  bar.append(all, msg);
  return bar;
}

function planBox() {
  const box = el('div', 'planbox');
  box.appendChild(el('div', 'planhead',
    'Wyliczone z interfejsu Modbus: slave ' + MODPLAN.slave + ', ' + MODPLAN.baud + ' bps, '
    + (MODPLAN.iface.ccid === 'old' ? 'old controller' : 'central controller ID20')));

  const t = el('table', 'adm-t map');
  t.innerHTML = '<thead><tr><th>Jednostka</th><th>Adres centralny</th><th>SW64 / SW63</th>'
              + '<th>Terminator SW21 Bit1</th></tr></thead>';
  const tb = el('tbody'); t.appendChild(tb);
  MODPLAN.plan.forEach(p => {
    const tr = el('tr');
    tr.appendChild(el('td', 'pname', p.label));
    tr.appendChild(el('td', 'mono2', String(p.addr)));
    tr.appendChild(el('td', 'mono2', p.sw64 + ' / ' + p.sw63));
    tr.appendChild(el('td', p.terminator ? 'chg' : 'fixed', p.terminator ? 'ON' : 'OFF'));
    tb.appendChild(tr);
  });
  box.appendChild(t);

  box.appendChild(el('div', 'planhead', 'Co z czego wynika:'));
  const ul = el('ul', 'whylist');
  MODPLAN.why.forEach(w => { const li = el('li'); li.innerHTML = w; ul.appendChild(li); });
  box.appendChild(ul);

  if (MODPLAN.notes.length) {
    const nt = el('table', 'adm-t find');
    MODPLAN.notes.forEach(n => nt.appendChild(findingRow(n, applyToIface)));
    box.appendChild(nt);
  }
  box.appendChild(el('p', 'admnote',
    'Wyliczenie tylko wypełniło karty adapterów — nic nie jest zapisane. Adresy centralne biorą '
    + 'się z pola n w config.json; interfejs ich nie ustawia, narzuca tylko ich zakres.'));
  return box;
}

function renderModules() {
  const root = $('#modbody');
  root.innerHTML = '';
  if (!MODVIEW) { root.appendChild(el('p', 'admnote', 'wczytywanie…')); return; }

  const intro = el('div', 'adm wide');
  intro.appendChild(el('h3', '', '1 · Interfejs Modbus i adaptery w jednostkach'));
  intro.appendChild(el('p', 'admnote',
    'Przełączniki siedzą na płytce adaptera TCB-SSRL011UUP-E wpiętego w złącze CN50 jednostki '
    + 'wewnętrznej, a interfejs Modbus stoi przed nimi, na końcu kabla od bramki RS-485. '
    + 'Aplikacja nie czyta ani nie ustawia żadnego z nich — klikanie tutaj niczego nie wysyła '
    + 'na magistralę. Zapisujesz to, co widzisz na sprzęcie; ustawienia adapterów wyliczają się '
    + 'z interfejsu, bo to on narzuca zakres adresów i terminację magistrali Uh.'));
  intro.appendChild(ifaceCard());
  intro.appendChild(saveAllBar());
  const grid = el('div', 'modgrid');
  MODVIEW.modules.forEach(m => grid.appendChild(moduleCard(m)));
  intro.appendChild(grid);
  if (MODPLAN) intro.appendChild(planBox());
  root.appendChild(intro);

  // --- 2. nieprawidlowosci, liczone przez serwer regulami
  const s2 = el('div', 'adm wide');
  s2.appendChild(el('h3', '', '2 · Nieprawidłowości w stanie zapisanym'));
  const bad = MODVIEW.checks;
  if (!bad.length) {
    s2.appendChild(el('p', 'admnote', 'Reguły z instrukcji nie zgłaszają nic do zapisanego stanu.'));
  } else {
    const t = el('table', 'adm-t find');
    bad.forEach(c => t.appendChild(findingRow(c, applyToModule)));
    s2.appendChild(t);
    s2.appendChild(el('p', 'admnote',
      'Lista dotyczy stanu zapisanego na serwerze, nie tego, co masz w tej chwili '
      + 'poklikane na ekranie. Zapisz, żeby ją odświeżyć.'));
  }
  root.appendChild(s2);

  // --- 3. legenda przelacznikow
  const s3 = el('div', 'adm wide');
  s3.appendChild(el('h3', '', '3 · Co robi każdy przełącznik'));
  const ref = MODVIEW.modules[0];
  ref.board.forEach(sw => {
    const blk = el('div', 'swref');
    const hd = el('div', 'swrefhead');
    hd.appendChild(el('b', '', sw.name));
    hd.appendChild(el('span', 'swkind', { dip: 'DIP', rotary: 'pokrętło skokowe 0-9',
                                          push: 'przycisk' }[sw.kind]));
    hd.appendChild(el('span', 'grow'));
    hd.appendChild(el('span', 'src', sw.src));
    blk.appendChild(hd);
    blk.appendChild(el('div', 'swtitle', sw.title));
    if (sw.bits) {
      const t = el('table', 'adm-t');
      sw.bits.forEach(b => {
        const tr = el('tr');
        tr.appendChild(el('th', '', 'Bit' + b.i));
        const td = el('td');
        td.innerHTML = b.desc;
        tr.appendChild(td);
        t.appendChild(tr);
      });
      blk.appendChild(t);
    }
    if (sw.table) {
      const t = el('table', 'adm-t map');
      const head = el('tr');
      sw.table[0].forEach(x => head.appendChild(el('th', '', x)));
      t.appendChild(head);
      sw.table.slice(1).forEach(r => {
        const tr = el('tr');
        r.forEach((x, i) => tr.appendChild(el('td', i < 3 ? 'mono2' : 'pname', x)));
        t.appendChild(tr);
      });
      blk.appendChild(t);
    }
    if (sw.note) { const p = el('p', 'admnote'); p.innerHTML = sw.note; blk.appendChild(p); }
    s3.appendChild(blk);
  });
  root.appendChild(s3);

  // --- 4. po zmianie
  const s4 = el('div', 'adm wide');
  s4.appendChild(el('h3', '', '4 · Po przestawieniu przełączników'));
  const ol = el('ol', 'aftlist');
  MODVIEW.after.forEach(x => { const li = el('li'); li.innerHTML = x; ol.appendChild(li); });
  s4.appendChild(ol);
  const t5 = el('table', 'adm-t');
  MODVIEW.leds.forEach(([name, desc]) => {
    const tr = el('tr');
    tr.appendChild(el('th', '', name));
    const td = el('td'); td.innerHTML = desc; tr.appendChild(td);
    t5.appendChild(tr);
  });
  s4.appendChild(t5);
  root.appendChild(s4);
}

function modToggle() {
  const p = $('#modules');
  const closed = p.classList.toggle('hidden');
  $('#modbtn').classList.toggle('on', !closed);
  if (!closed) modLoad().catch(e => {
    $('#modbody').innerHTML = '';
    $('#modbody').appendChild(el('p', 'admnote', 'błąd: ' + e.message));
  });
}

// ---------------------------------------------------------------- zdarzenia

$('#refresh').onclick = refresh;
$('#termbtn').onclick = termToggle;
$('#termclear').onclick = () => {
  $('#termbody').innerHTML = ''; $('#termstat').textContent = ''; MAXCOLS = 0; layoutTerm();
};
$('#termpos').onchange = () => {
  try { localStorage.setItem('termpos', $('#termpos').value); } catch {}
  layoutTerm();
};
window.addEventListener('resize', () => { if (!$('#term').classList.contains('hidden')) layoutTerm(); });
try {
  const saved = localStorage.getItem('termpos');
  if (saved) $('#termpos').value = saved;
} catch {}
$('#adminbtn').onclick = adminToggle;
$('#modbtn').onclick = modToggle;
$('#modclose').onclick = () => {
  $('#modules').classList.add('hidden');
  $('#modbtn').classList.remove('on');
};
$('#adminclose').onclick = () => {
  $('#admin').classList.add('hidden');
  $('#adminbtn').classList.remove('on');
};
$('#tracebtn').onclick = traceToggle;
$('#tracerun').onclick = runTrace;
$('#traceclose').onclick = () => {
  $('#trace').classList.add('hidden');
  $('#tracebtn').classList.remove('on');
};
$('#q').oninput = renderTables;
$('#onlywrite').onchange = renderTables;
$('#mcancel').onclick = () => $('#modal').classList.add('hidden');
$('#mok').onclick = doWrite;
$('#auditbtn').onclick = showAudit;
$('#acancel').onclick = () => $('#auditmodal').classList.add('hidden');
$('#toggledetail').onclick = () => {
  const d = $('#detail'), b = $('#toggledetail');
  const open = d.classList.toggle('hidden');
  b.setAttribute('aria-expanded', String(!open));
};
function resetTimer() {
  if (TIMER) clearInterval(TIMER);
  if ($('#auto').checked) TIMER = setInterval(refresh, +$('#interval').value * 1000);
}
$('#auto').onchange = resetTimer;
$('#interval').onchange = resetTimer;
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden'));
});

boot();
