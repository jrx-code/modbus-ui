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

function frameRows(frames) {
  const box = el('div', 'frames');
  (frames || []).forEach(f => {
    const tx = el('div', 'fr tx');
    tx.appendChild(el('span', 'd', 'TX'));
    tx.appendChild(document.createTextNode(' ' + grp(f.tx)));
    box.appendChild(tx);
    if (f.ok && f.rx) {
      const rx = el('div', 'fr rx');
      rx.appendChild(el('span', 'd', 'RX'));
      rx.appendChild(document.createTextNode(' ' + grp(f.rx)));
      rx.appendChild(el('span', 'ms', f.ms + ' ms'));
      box.appendChild(rx);
    } else {
      const er = el('div', 'fr err');
      er.appendChild(el('span', 'd', 'ERR'));
      er.appendChild(document.createTextNode(' ' + (f.err || 'brak odpowiedzi')));
      box.appendChild(er);
    }
  });
  return box;
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
  if (st.frames && st.frames.length) n.appendChild(frameRows(st.frames));
}

function traceSkeleton() {
  const chain = $('#chain');
  chain.innerHTML = '';
  [['app', 'Aplikacja modbus-ui'],
   ['net', `Bramka ${DEV.host}:${DEV.port}`],
   ['iface', `Interfejs Modbus (slave ${DEV.slave})`],
   ['rs485', 'Magistrala RS-485'],
   ['uh', 'Magistrala Uh (TU2C-LINK)']].forEach(([id, name]) => {
    const n = el('div', 'node pending');
    n.dataset.id = id;
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
          ev.steps.forEach(stp => {
            const n = el('div', 'node pending');
            n.dataset.id = stp.id;
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
