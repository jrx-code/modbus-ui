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

function renderAdmin() {
  const gw = (DEV.gateway || {});
  const g = GATEWAYS[gw.type] || GATEWAYS.ew11;
  const root = $('#adminbody');
  root.innerHTML = '';

  // --- 1. co widzi aplikacja
  const s1 = el('div', 'adm');
  s1.appendChild(el('h3', '', '1 · Czym aplikacja laczy sie z bramka'));
  const t1 = el('table', 'adm-t');
  [['Adres', `<span class="mono">${DEV.host}:${DEV.port}</span>`],
   ['Ramkowanie', `<span class="mono">${DEV.framing}</span> — ${g.framingWhy}`],
   ['Adres slave', `<span class="mono">${DEV.slave}</span> (interfejs zajmuje tez ${DEV.slave + 1} i ${DEV.slave + 2})`],
   ['Timeout', `<span class="mono">${DEV.timeout} s</span>`],
   ['Zapis', DEV.write_enabled ? 'wlaczony' : 'WYLACZONY'],
  ].forEach(([k, v]) => t1.appendChild(adminRow(k, v)));
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
