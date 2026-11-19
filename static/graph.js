/* Graphen des Command Centers (seit 3.0.0, interaktiv seit 3.1.0) – kleine SVG-Bibliothek ohne Fremdcode.
 *
 *   Graph.gruppe()              Verbund: Graphen teilen Fadenkreuz (gleiche Uhrzeit) und Zoom
 *   Graph.verlauf(el, opts)     Linien-/Flächendiagramm über die Zeit
 *   Graph.funke(el, werte, o)   Sparkline mit Wert unter dem Zeiger
 *   Graph.zaehlen(el, z, fmt)   Zahl weich hochzählen (Kennzahlen)
 *
 * Bedienung eines Verlaufs:
 *   Zeiger/Finger     Fadenkreuz + Tooltip (im Verbund auf allen Graphen zur selben Zeit)
 *   Ziehen (Maus)     Zeitraum markieren → hineinzoomen; Doppelklick oder „Zoom zurücksetzen“ → zurück
 *   Legende           Reihe ein-/ausblenden (Achse passt sich an; eine bleibt immer sichtbar)
 *   Tastatur          ← → (Umschalt = 12 Schritte), Pos1/Ende, + / − zoomen um das Fadenkreuz, 0 zurück, Esc
 *   „Tabelle“         Werte als Tabelle (tabelleUmschalten)
 * Darunter: Ø und Höchstwert jeder sichtbaren Reihe im gezeigten Zeitraum.
 *
 * Regeln (dataviz-Skill, HIG charting-data.md): Farben nur aus Tokens --g-1…4, feste Reihenfolge, Text nie in
 * Serienfarbe, eine Achse, Linien 2 px, Lücken (Neustart) nicht überbrückt. Zwei SVG-Ebenen: „fest“ (Gitter,
 * Linien) wird nur bei neuen Daten/Größe/Zoom gezeichnet, „oben“ (Fadenkreuz, Auswahl) bei jeder Zeigerbewegung.
 */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const RAND_R = 10, RAND_T = 10, RAND_B = 24;
  const ruhig = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, attrs, eltern) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (eltern) eltern.appendChild(e);
    return e;
  }
  function html(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function schoen(max) {
    if (!(max > 0)) return { oben: 1, schritt: 0.25 };
    const p = Math.pow(10, Math.floor(Math.log10(max)));
    const f = max / p;
    const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return { oben: n * p, schritt: n * p / (n === 2.5 || n === 5 ? 5 : 4) };
  }
  const zeit = (t, sek) => new Date(t * 1000).toLocaleTimeString('de-DE',
    sek ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
  // Eigene Zeitbeschriftung je Graph (o.zeitText(t, kurz)), z. B. mit Datum für Tage/Wochen (seit 3.6.0)
  const zt = (st, t, sek, kurz) => (st && st.o && st.o.zeitText) ? st.o.zeitText(t, !!kurz) : zeit(t, sek);
  const spanneText = s => s >= 3600 ? (s / 3600).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' Std'
    : Math.max(1, Math.round(s / 60)) + ' Min';

  /* ── Verbund ── */
  function gruppe() {
    const g = { graphen: new Set(), hoverT: null, zoom: null };
    g.oben = () => g.graphen.forEach(st => st.obenZeichnen());
    g.alles = () => g.graphen.forEach(st => st.zeichne());
    g.zoomen = z => { g.zoom = z; g.graphen.forEach(st => { st.einblenden = true; }); g.alles(); };
    return g;
  }

  /* ── Verlauf ── */
  function verlauf(wurzel, o) {
    let st = wurzel._graph;
    if (!st) st = aufbauen(wurzel, o.gruppe || gruppe());
    const war = st.o;
    st.o = o;
    if (!war || o.neu) st.einblenden = true;
    st.zeichne();
    return st;
  }

  function aufbauen(wurzel, grp) {
    const st = wurzel._graph = { grp, aus: new Set(), tabelle: false, tastIndex: null, ziehen: null, sicht: [], sichtIdx: [] };
    grp.graphen.add(st);
    wurzel.classList.add('g-wurzel');
    wurzel.innerHTML = '';
    st.legende = html('div', 'g-legende');
    st.legende.setAttribute('role', 'group');
    st.legende.setAttribute('aria-label', 'Reihen ein- oder ausblenden');
    st.flaeche = html('div', 'g-flaeche');
    st.flaeche.tabIndex = 0;
    st.flaeche.setAttribute('role', 'img');
    st.fest = el('svg', { 'aria-hidden': 'true', focusable: 'false', class: 'g-fest' });
    st.oben = el('svg', { 'aria-hidden': 'true', focusable: 'false', class: 'g-oben' });
    st.tip = html('div', 'g-tip'); st.tip.setAttribute('aria-hidden', 'true');
    st.zurueck = html('button', 'g-zurueck', 'Zoom zurücksetzen');
    st.zurueck.type = 'button'; st.zurueck.hidden = true;
    st.zurueck.addEventListener('click', () => grp.zoomen(null));
    st.flaeche.append(st.fest, st.oben, st.tip, st.zurueck);
    st.stat = html('div', 'g-stat');
    st.tab = html('div', 'g-tabelle'); st.tab.hidden = true;
    st.live = html('div', 'sr-only'); st.live.setAttribute('aria-live', 'polite');
    wurzel.append(st.legende, st.flaeche, st.stat, st.tab, st.live);

    st.legende.addEventListener('click', e => {
      const b = e.target.closest('button[data-reihe]');
      if (!b) return;
      const n = b.dataset.reihe;
      if (st.aus.has(n)) st.aus.delete(n);
      else if (st.o.reihen.length - st.aus.size > 1) st.aus.add(n);
      st.zeichne();
      st.legende.querySelector(`button[data-reihe="${CSS.escape(n)}"]`)?.focus();
    });

    const xZuT = x => st.geo ? st.geo.t0 + (x - st.geo.l) / st.geo.pw * (st.geo.t1 - st.geo.t0) : null;
    const lokal = e => e.clientX - st.flaeche.getBoundingClientRect().left;
    st.flaeche.addEventListener('pointerdown', e => {
      if (e.target === st.zurueck) return;
      st.tastIndex = null;
      const x = lokal(e);
      if (e.pointerType === 'mouse' && e.button === 0 && st.geo && x >= st.geo.l) {
        st.ziehen = { x0: x, x1: x };
        st.flaeche.setPointerCapture(e.pointerId);
      }
      grp.hoverT = xZuT(x); grp.oben();
    });
    st.flaeche.addEventListener('pointermove', e => {
      const x = lokal(e);
      if (st.ziehen) st.ziehen.x1 = x;
      st.tastIndex = null;
      grp.hoverT = xZuT(x); grp.oben();
    });
    st.flaeche.addEventListener('pointerup', () => {
      const z = st.ziehen; st.ziehen = null;
      if (z && Math.abs(z.x1 - z.x0) > 8) {
        const a = xZuT(Math.min(z.x0, z.x1)), b = xZuT(Math.max(z.x0, z.x1));
        if (b - a >= (st.o.schritt || 5) * 4) { grp.zoomen([a, b]); st.live.textContent = `Gezoomt auf ${zt(st, a)} bis ${zt(st, b)}`; return; }
      }
      grp.oben();
    });
    st.flaeche.addEventListener('pointerleave', e => {
      if (e.pointerType === 'mouse' && !st.ziehen) { grp.hoverT = null; grp.oben(); }
    });
    st.flaeche.addEventListener('dblclick', () => grp.zoomen(null));
    st.flaeche.addEventListener('keydown', e => {
      const z = st.sicht;
      if (!z.length || !st.geo) return;
      let i = st.tastIndex == null ? z.length - 1 : st.tastIndex;
      const { t0, t1 } = st.geo;
      if (e.key === 'ArrowLeft') i = Math.max(0, i - (e.shiftKey ? 12 : 1));
      else if (e.key === 'ArrowRight') i = Math.min(z.length - 1, i + (e.shiftKey ? 12 : 1));
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = z.length - 1;
      else if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
        e.preventDefault();
        const mitte = grp.hoverT != null ? grp.hoverT : (t0 + t1) / 2;
        const f = e.key === '+' || e.key === '=' ? 0.5 : 2;
        const halb = Math.max((st.o.schritt || 5) * 6, (t1 - t0) * f / 2);
        const voll = st.vollBereich();
        const a = Math.max(voll[0], mitte - halb), b = Math.min(voll[1], mitte + halb);
        grp.zoomen(b - a >= voll[1] - voll[0] - 1 ? null : [a, b]);
        return;
      } else if (e.key === '0') { e.preventDefault(); grp.zoomen(null); return; }
      else if (e.key === 'Escape') { st.tastIndex = null; grp.hoverT = null; grp.oben(); return; }
      else return;
      e.preventDefault();
      st.tastIndex = i;
      grp.hoverT = z[i]; grp.oben();
      st.live.textContent = st.tipText(i);
    });
    st.flaeche.addEventListener('blur', () => { if (st.tastIndex != null) { st.tastIndex = null; grp.hoverT = null; grp.oben(); } });
    if ('ResizeObserver' in window) {
      let w0 = 0;
      new ResizeObserver(es => { const w = Math.round(es[0].contentRect.width); if (w && w !== w0) { w0 = w; st.zeichne(); } })
        .observe(st.flaeche);
    }

    st.vollBereich = () => {
      const o = st.o, z = o.zeiten || [];
      const t1 = o.jetzt || (z.length ? z[z.length - 1] : Date.now() / 1000);
      return [t1 - (o.bereichS || 3600), t1];
    };
    st.tipText = i => {
      const o = st.o, t = st.sicht[i], j = st.sichtIdx[i];
      return zt(st, t, o.schritt < 60) + ': ' + o.reihen.filter(r => !st.aus.has(r.name))
        .map(r => r.name + ' ' + (r.werte[j] == null ? '–' : o.format(r.werte[j]))).join(', ');
    };

    /* feste Ebene */
    st.zeichne = function () {
      const o = st.o, f = st.flaeche;
      if (!o) return;
      const w = Math.max(120, Math.round(f.clientWidth)), h = o.hoehe || 200;
      f.style.height = h + 'px';
      const zeiten = o.zeiten || [];
      const voll = st.vollBereich();
      const [t0, t1] = grp.zoom ? grp.zoom : voll;
      st.zurueck.hidden = !grp.zoom;
      const sichtbar = o.reihen.filter(r => !st.aus.has(r.name));
      const idx = [];
      for (let i = 0; i < zeiten.length; i++) if (zeiten[i] >= t0 && zeiten[i] <= t1) idx.push(i);
      st.sichtIdx = idx; st.sicht = idx.map(i => zeiten[i]);
      if (st.tastIndex != null && st.tastIndex >= idx.length) st.tastIndex = null;

      let max = o.max;
      if (max == null) {
        max = o.minMax || 0;
        for (const r of sichtbar) for (const i of idx) if (r.werte[i] > max) max = r.werte[i];
      }
      const teiler = typeof o.teiler === 'function' ? o.teiler(max) : (o.teiler || 1);
      let oben, schritt;
      if (o.max != null) { oben = o.max; schritt = o.max / 4; }
      else { const n = schoen(max / teiler); oben = n.oben * teiler; schritt = n.schritt * teiler; }
      const fmtA = o.achse || o.format;
      let lang = 0;
      for (let v = 0; v <= oben + 1e-9; v += schritt) lang = Math.max(lang, String(fmtA(v)).length);
      const l = Math.max(34, Math.round(lang * 6.4 + 14));
      const pw = w - l - RAND_R, ph = h - RAND_T - RAND_B;
      const X = t => l + (t - t0) / (t1 - t0) * pw;
      const Y = v => RAND_T + ph - Math.min(1, Math.max(0, v / oben)) * ph;
      st.geo = { X, Y, l, pw, ph, w, h, t0, t1 };

      const svg = st.fest;
      for (const s of [svg, st.oben]) { s.setAttribute('width', w); s.setAttribute('height', h); s.setAttribute('viewBox', `0 0 ${w} ${h}`); }
      svg.textContent = '';
      const gitter = el('g', { class: 'g-gitter' }, svg);
      for (let v = 0; v <= oben + 1e-9; v += schritt) {
        const y = Math.round(Y(v)) + 0.5;
        el('line', { x1: l, x2: w - RAND_R, y1: y, y2: y, class: v === 0 ? 'g-null' : '' }, gitter);
        el('text', { x: l - 8, y, 'text-anchor': 'end', 'dominant-baseline': 'middle', class: 'g-achse' }, gitter).textContent = fmtA(v);
      }
      const spanne = t1 - t0;
      const schritte = [30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800, 345600, 604800];
      const sx = schritte.find(s => spanne / s <= Math.max(2, Math.floor(pw / 90))) || 604800;
      const ov = -new Date(t0 * 1000).getTimezoneOffset() * 60;      // Striche an Ortszeit ausrichten (Tage ab Mitternacht)
      for (let t = Math.ceil((t0 + ov) / sx) * sx - ov; t <= t1; t += sx) {
        const x = X(t);
        if (x < l + 14 || x > w - RAND_R - 14) continue;
        el('text', { x, y: h - 6, 'text-anchor': 'middle', class: 'g-achse' }, gitter).textContent = zt(st, t, sx < 60, true);
      }

      const luecke = (o.schritt || 5) * 3.5;
      const stuecke = [];
      let an = 0;
      for (let k = 1; k <= idx.length; k++) {
        if (k === idx.length || zeiten[idx[k]] - zeiten[idx[k - 1]] > luecke) { stuecke.push([an, k]); an = k; }
      }
      const linien = el('g', { class: 'g-linien' + (st.einblenden && !ruhig() ? ' g-ein' : '') }, svg);
      st.einblenden = false;
      o.reihen.forEach((r, ri) => {
        if (st.aus.has(r.name)) return;
        const farbe = `var(${r.farbe})`;
        const g = el('g', { class: 'g-reihe' }, linien);
        for (const [a, b] of stuecke) {
          const pts = [];
          for (let k = a; k < b; k++) { const v = r.werte[idx[k]]; if (v != null) pts.push([X(zeiten[idx[k]]), Y(v)]); }
          if (!pts.length) continue;
          const d = pts.map((p, k) => (k ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
          if ((o.flaeche !== false && ri === 0) || o.flaeche === 'alle') {
            el('path', { d: d + `L${pts[pts.length - 1][0].toFixed(1)} ${Y(0)}L${pts[0][0].toFixed(1)} ${Y(0)}Z`, fill: farbe, class: 'g-flaeche-fuell' }, g);
          }
          el('path', { d, stroke: farbe, class: 'g-linie' }, g);
          if (pts.length === 1) el('circle', { cx: pts[0][0], cy: pts[0][1], r: 3, fill: farbe }, g);
        }
        // „jetzt“: letzter Punkt mit leisem Puls (nur ohne Zoom)
        if (!grp.zoom && idx.length) {
          const v = r.werte[idx[idx.length - 1]];
          if (v != null) el('circle', { cx: X(zeiten[idx[idx.length - 1]]), cy: Y(v), r: 3.5, fill: farbe, class: 'g-jetzt' }, g);
        }
      });

      // Legende: Schalter mit aktuellem Wert (Fokus bleibt beim Neuzeichnen erhalten)
      const fokus = document.activeElement && st.legende.contains(document.activeElement) ? document.activeElement.dataset.reihe : null;
      const letzt = zeiten.length - 1;
      st.legende.textContent = '';
      for (const r of o.reihen) {
        const b = html('button', 'g-leg');
        b.type = 'button'; b.dataset.reihe = r.name;
        const ein = !st.aus.has(r.name);
        b.setAttribute('aria-pressed', String(ein));
        b.title = ein ? `${r.name} ausblenden` : `${r.name} einblenden`;
        const i = html('i'); i.style.background = `var(${r.farbe})`;
        b.append(i, html('span', 'g-leg-name', r.name), html('b', 'g-leg-wert', letzt >= 0 && r.werte[letzt] != null ? o.format(r.werte[letzt]) : '–'));
        st.legende.appendChild(b);
        if (fokus === r.name) b.focus();
      }

      // Ø / Höchstwert im gezeigten Zeitraum
      st.stat.textContent = '';
      st.stat.appendChild(html('span', 'g-stat-zeit', grp.zoom ? `${zt(st, t0)}–${zt(st, t1)} · ${spanneText(t1 - t0)}` : (o.bereichKurz || spanneText(t1 - t0))));
      const zus = [];
      for (const r of sichtbar) {
        let s = 0, n = 0, m = -Infinity, mt = 0;
        for (const i of idx) { const v = r.werte[i]; if (v == null) continue; s += v; n++; if (v > m) { m = v; mt = zeiten[i]; } }
        if (!n) continue;
        const sp = html('span', 'g-stat-r');
        const ii = html('i'); ii.style.background = `var(${r.farbe})`;
        sp.append(ii, document.createTextNode(`${r.name} Ø `), html('b', '', o.format(s / n)), document.createTextNode(' · max '),
          html('b', '', o.format(m)), html('span', 'g-stat-t', ` um ${zt(st, mt, o.schritt < 60)}`));
        st.stat.appendChild(sp);
        zus.push(`${r.name}: Durchschnitt ${o.format(s / n)}, höchstens ${o.format(m)}`);
      }
      f.setAttribute('aria-label', `${o.titel || 'Verlauf'}, ${grp.zoom ? 'gezoomt' : (o.bereichText || '')}. ${zus.join('; ') || 'keine Daten'}. ` +
        'Pfeiltasten: Werte, Plus/Minus: zoomen, 0: zurück.');
      st.obenZeichnen();
      if (st.tabelle) tabelle(st);
    };

    /* obere Ebene: Fadenkreuz, Punkte, Tooltip, Auswahl */
    st.obenZeichnen = function () {
      const o = st.o, g = st.geo, svg = st.oben;
      if (!g) return;
      svg.textContent = '';
      const z = st.ziehen;
      if (z) {
        const a = Math.max(g.l, Math.min(z.x0, z.x1)), b = Math.min(g.l + g.pw, Math.max(z.x0, z.x1));
        el('rect', { x: a, y: RAND_T, width: Math.max(0, b - a), height: g.ph, class: 'g-auswahl', rx: 6 }, svg);
      }
      const t = grp.hoverT;
      const aus = () => st.tip.classList.remove('an');
      if (t == null || !st.sicht.length || t < g.t0 - 1 || t > g.t1 + 1) return aus();
      let best = 0, bd = Infinity;
      if (st.tastIndex != null) { best = st.tastIndex; bd = 0; }
      else for (let k = 0; k < st.sicht.length; k++) { const d = Math.abs(st.sicht[k] - t); if (d < bd) { bd = d; best = k; } }
      if (bd > Math.max((o.schritt || 5) * 4, (g.t1 - g.t0) / g.pw * 12)) return aus();
      const j = st.sichtIdx[best];
      const x = Math.round(g.X(st.sicht[best])) + 0.5;
      el('line', { x1: x, x2: x, y1: RAND_T, y2: RAND_T + g.ph, class: 'g-kreuz' }, svg);
      for (const r of o.reihen) {
        if (st.aus.has(r.name) || r.werte[j] == null) continue;
        el('circle', { cx: x, cy: g.Y(r.werte[j]), r: 4.5, fill: `var(${r.farbe})`, class: 'g-punkt' }, svg);
      }
      st.tip.textContent = '';
      st.tip.appendChild(html('b', '', zt(st, st.sicht[best], o.schritt < 60)));
      for (const r of o.reihen) {
        if (st.aus.has(r.name)) continue;
        const zz = html('div', 'g-tip-z');
        const i = html('i'); i.style.background = `var(${r.farbe})`;
        zz.append(i, html('span', '', r.name), html('em', '', r.werte[j] == null ? '–' : o.format(r.werte[j])));
        st.tip.appendChild(zz);
      }
      st.tip.classList.add('an');
      const tw = st.tip.offsetWidth;
      let left = x + 14;
      if (left + tw > g.w) left = x - tw - 14;
      st.tip.style.transform = `translateX(${Math.max(0, left)}px)`;
    };

    st.tabelleUmschalten = an => {
      st.tabelle = an == null ? !st.tabelle : !!an;
      st.tab.hidden = !st.tabelle;
      st.flaeche.hidden = st.tabelle;
      if (st.tabelle) tabelle(st);
      return st.tabelle;
    };
    return st;
  }

  function tabelle(st) {
    const o = st.o, idx = st.sichtIdx || [], z = o.zeiten || [];
    const reihen = o.reihen.filter(r => !st.aus.has(r.name));
    const schritt = Math.max(1, Math.ceil(idx.length / 60));
    const t = html('table', 'g-tab');
    t.appendChild(html('caption', 'sr-only', (o.titel || 'Verlauf') + ' als Tabelle'));
    const kopf = html('tr');
    kopf.appendChild(html('th', '', 'Zeit'));
    for (const r of reihen) kopf.appendChild(html('th', '', r.name));
    const thead = html('thead'); thead.appendChild(kopf);
    const tb = html('tbody');
    for (let k = idx.length - 1; k >= 0; k -= schritt) {
      const i = idx[k], tr = html('tr');
      tr.appendChild(html('td', '', zt(st, z[i], o.schritt < 60)));
      for (const r of reihen) tr.appendChild(html('td', '', r.werte[i] == null ? '–' : o.format(r.werte[i])));
      tb.appendChild(tr);
    }
    t.append(thead, tb);
    st.tab.textContent = '';
    st.tab.appendChild(idx.length ? t : html('p', 'g-leer', 'Noch keine Messwerte.'));
  }

  /* ── Sparkline ── */
  function funke(wurzel, werte, o) {
    o = o || {};
    wurzel._funke = { werte, o };
    const w = Math.max(40, Math.round(wurzel.clientWidth || 120)), h = o.hoehe || 36;
    let svg = wurzel.querySelector('svg.g-funke');
    if (!svg) {
      wurzel.textContent = '';
      wurzel.classList.add('g-funke-wurzel');
      svg = el('svg', { 'aria-hidden': 'true', focusable: 'false', class: 'g-funke' }, wurzel);
      const blase = html('span', 'g-blase'); blase.setAttribute('aria-hidden', 'true');
      wurzel.appendChild(blase);
      wurzel.addEventListener('pointermove', e => {
        const f = wurzel._funke; if (!f || !f.geo) return;
        const r = wurzel.getBoundingClientRect();
        const i = Math.max(0, Math.min(f.werte.length - 1, Math.round((e.clientX - r.left - 1) / f.geo.dx)));
        const v = f.werte[i];
        if (v == null) return;
        const p = svg.querySelector('.g-funke-zeiger');
        p.setAttribute('cx', f.geo.X(i)); p.setAttribute('cy', f.geo.Y(v)); p.style.opacity = 1;
        blase.textContent = (f.o.format || (x => x.toFixed(1)))(v);
        blase.style.transform = `translateX(${Math.min(f.geo.w - blase.offsetWidth, Math.max(0, f.geo.X(i) - blase.offsetWidth / 2))}px)`;
        blase.classList.add('an');
      });
      wurzel.addEventListener('pointerleave', () => {
        blase.classList.remove('an');
        const p = svg.querySelector('.g-funke-zeiger'); if (p) p.style.opacity = 0;
      });
    }
    svg.setAttribute('width', w); svg.setAttribute('height', h); svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.textContent = '';
    const ws = werte.filter(v => v != null);
    if (ws.length < 2) return;
    let max = o.max;
    if (max == null) max = Math.max(...ws, o.minMax || 0) || 1;
    const n = werte.length, dx = (w - 2) / (n - 1);
    const X = i => 1 + i * dx, Y = v => h - 2 - Math.min(1, v / max) * (h - 4);
    wurzel._funke.geo = { X, Y, dx, w };
    const pts = [];
    werte.forEach((v, i) => { if (v != null) pts.push([X(i), Y(v)]); });
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
    const farbe = `var(${o.farbe || '--g-1'})`;
    el('path', { d: d + `L${pts[pts.length - 1][0].toFixed(1)} ${h}L${pts[0][0].toFixed(1)} ${h}Z`, fill: farbe, class: 'g-flaeche-fuell' }, svg);
    el('path', { d, stroke: farbe, class: 'g-linie g-linie-duenn' }, svg);
    const l = pts[pts.length - 1];
    el('circle', { cx: l[0], cy: l[1], r: 2.5, fill: farbe, class: 'g-jetzt' }, svg);
    el('circle', { cx: 0, cy: 0, r: 3.5, fill: farbe, class: 'g-funke-zeiger g-punkt', style: 'opacity:0' }, svg);
  }

  const zahl = (v, d) => v.toLocaleString('de-DE', { maximumFractionDigits: d == null ? 1 : d });
  function bits(v) {
    if (v >= 1e9) return zahl(v / 1e9, 2) + ' Gbit/s';
    if (v >= 1e6) return zahl(v / 1e6, v >= 1e8 ? 0 : 1) + ' Mbit/s';
    if (v >= 1e3) return zahl(v / 1e3, 0) + ' kbit/s';
    return zahl(v, 0) + ' bit/s';
  }
  function bytesS(v) {
    if (v >= 1073741824) return zahl(v / 1073741824, 1) + ' GB/s';
    if (v >= 1048576) return zahl(v / 1048576, 1) + ' MB/s';
    if (v >= 1024) return zahl(v / 1024, 0) + ' KB/s';
    return zahl(v, 0) + ' B/s';
  }

  /* Zahl weich hochzählen (Kennzahlen); bei „Bewegung reduzieren“ sofort */
  function zaehlen(elem, ziel, fmt) {
    fmt = fmt || (v => String(Math.round(v)));
    const alt = parseFloat(elem.dataset.wert);
    elem.dataset.wert = ziel;
    if (isNaN(alt) || ruhig() || alt === ziel) { elem.textContent = fmt(ziel); return; }
    const start = performance.now(), dauer = 650;
    cancelAnimationFrame(elem._zaehl);
    const schritt = jetzt => {
      const p = Math.min(1, (jetzt - start) / dauer), e = 1 - Math.pow(1 - p, 3);
      elem.textContent = fmt(alt + (ziel - alt) * e);
      if (p < 1) elem._zaehl = requestAnimationFrame(schritt);
    };
    elem._zaehl = requestAnimationFrame(schritt);
  }

  window.Graph = { gruppe, verlauf, funke, zaehlen, format: { zahl, bits, bytesS, prozent: v => zahl(v, 1) + ' %' } };
})();
