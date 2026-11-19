/* Navigation des Command Centers (seit 3.0.0, Bewegung + Suche 3.1.0, 10.11.2026)
 *
 * - Seitenleiste mit Gruppen und Text (≥ 1100 px); einklappbar auf Symbole (Knopf oben, Strg/⌘+B), gemerkt in
 *   localStorage „cc-nav“. Zwischen 769 und 1099 px immer Symbolleiste mit Tooltips.
 * - Handy (≤ 768 px): Tableiste unten mit vier Zielen + „Mehr“. „Mehr“ öffnet dieselbe Seitenleiste als Blatt.
 * - Bewegung: Die Markierung der aktiven Seite gleitet (Seitenleiste, Tableiste, alle Segmente); Karten blenden beim
 *   Seitenwechsel gestaffelt ein. Alles aus bei „Bewegung reduzieren“.
 * - Suche (Strg/⌘+K): Seiten, Aktionen, Docker-Container und Dienste; unscharfe Treffer mit hervorgehobenen
 *   Buchstaben, „Zuletzt“ (localStorage „cc-zuletzt“), Bereiche, Tastatur ↑↓ ↵ Tab, Esc.
 * - Sichtbarkeit kommt weiter aus app.js (Rolle, Einstellungen → style.display der nav-btn-*). Dieses Skript
 *   beobachtet das und blendet leere Gruppen aus, baut die Tableiste und hält Titel/aktive Markierung aktuell.
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const leiste = () => document.getElementById('seitenleiste');
  const TAB_WUNSCH = ['dashboard', 'docker', 'terminal', 'security', 'vms', 'connections', 'browser'];
  const handy = () => matchMedia('(max-width: 768px)').matches;
  const ruhig = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const speicher = {
    lesen(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    schreiben(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ── Einklappen (Desktop) ── */
  function einklappenSetzen(zu) {
    document.documentElement.classList.toggle('nav-eingeklappt', zu);
    const b = $('.sb-einklappen');
    if (b) {
      b.setAttribute('aria-expanded', String(!zu));
      b.setAttribute('aria-label', zu ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen');
    }
    setTimeout(markierungSetzen, 340);
  }
  window.navEinklappen = function () {
    const zu = !document.documentElement.classList.contains('nav-eingeklappt');
    einklappenSetzen(zu);
    speicher.schreiben('cc-nav', zu ? 'zu' : 'auf');
  };
  einklappenSetzen(speicher.lesen('cc-nav') === 'zu');

  /* ── „Mehr“-Blatt (Handy) ── */
  let vorherFokus = null;
  window.navMehr = function (an) {
    const offen = document.body.classList.contains('nav-offen');
    an = an == null ? !offen : !!an;
    if (an === offen) return;
    document.body.classList.toggle('nav-offen', an);
    const mehr = document.getElementById('tab-mehr');
    if (mehr) mehr.setAttribute('aria-expanded', String(an));
    const l = leiste();
    if (an) {
      vorherFokus = document.activeElement;
      l.setAttribute('role', 'dialog'); l.setAttribute('aria-modal', 'true');
      setTimeout(() => { markierungSetzen(); (l.querySelector('.nav-item.active') || l.querySelector('.nav-item:not([style*="none"])'))?.focus(); }, 40);
    } else {
      l.removeAttribute('role'); l.removeAttribute('aria-modal');
      if (vorherFokus && document.contains(vorherFokus)) vorherFokus.focus();
    }
  };

  /* ── Sichtbare Ziele ── */
  function sichtbar(btn) { return btn && btn.style.display !== 'none'; }
  function ziele() {
    return [...document.querySelectorAll('#seitenleiste .nav-item[id^="nav-btn-"]')].filter(sichtbar).map(b => ({
      id: b.id.slice(8), name: b.querySelector('.nav-label')?.textContent || b.id.slice(8),
      gruppe: b.closest('.nav-gruppe')?.getAttribute('aria-label') || '', svg: b.querySelector('svg')?.outerHTML || '',
    }));
  }
  function aktiveSeite() {
    const a = document.querySelector('#seitenleiste .nav-item.active, #nav-btn-konto.active');
    return a ? a.id.slice(8) : '';
  }

  /* ── Gleitende Markierung der aktiven Seite ── */
  let markierung = null;
  function markierungSetzen() {
    const items = document.querySelector('#seitenleiste .nav-items');
    if (!items) return;
    if (!markierung) {
      markierung = document.createElement('span');
      markierung.className = 'nav-markierung';
      markierung.setAttribute('aria-hidden', 'true');
      items.prepend(markierung);
    }
    const a = items.querySelector('.nav-item.active');
    if (!a || !a.offsetParent) { markierung.classList.remove('an'); return; }
    const ir = items.getBoundingClientRect(), ar = a.getBoundingClientRect();
    const x = ar.left - ir.left + items.scrollLeft, y = ar.top - ir.top + items.scrollTop;
    const erst = !markierung.classList.contains('an');
    if (erst) markierung.style.transition = 'none';
    markierung.style.width = ar.width + 'px';
    markierung.style.height = ar.height + 'px';
    markierung.style.transform = `translate(${x}px, ${y}px)`;
    markierung.classList.add('an');
    if (erst) { void markierung.offsetWidth; markierung.style.transition = ''; }
  }

  /* ── Gleitende Segmente (ein Daumen hinter dem gewählten Knopf, für alle Umschalter) ── */
  const SEG = '.seg, .dk-tabs, .ids-range, .ntf-range, .dk-filter, .eb-segment, div:has(> .vm-mgmt-tab)';
  const AKTIV = '.active, [aria-pressed="true"]';
  function segmentSetzen(seg) {
    let d = seg.querySelector(':scope > .seg-daumen');
    if (!d) {
      d = document.createElement('span');
      d.className = 'seg-daumen'; d.setAttribute('aria-hidden', 'true');
      seg.prepend(d);
      seg.classList.add('seg-gleitet');
    }
    const a = [...seg.children].find(c => c !== d && c.matches(AKTIV) && c.offsetParent);
    if (!a) { d.classList.remove('an'); return; }
    const erst = !d.classList.contains('an') || seg._breite !== seg.clientWidth;
    seg._breite = seg.clientWidth;
    if (erst) d.style.transition = 'none';
    d.style.width = a.offsetWidth + 'px';
    d.style.height = a.offsetHeight + 'px';
    d.style.transform = `translate(${a.offsetLeft}px, ${a.offsetTop}px)`;
    d.classList.add('an');
    if (erst) { void d.offsetWidth; d.style.transition = ''; }
    if (a.offsetLeft < seg.scrollLeft || a.offsetLeft + a.offsetWidth > seg.scrollLeft + seg.clientWidth) {
      seg.scrollTo({ left: a.offsetLeft - 16, behavior: ruhig() ? 'auto' : 'smooth' });
    }
  }
  function segmenteAlle() { document.querySelectorAll(SEG).forEach(s => { if (s.offsetParent) segmentSetzen(s); }); }
  let segGeplant = 0;
  const segmenteBald = () => { if (!segGeplant) segGeplant = requestAnimationFrame(() => { segGeplant = 0; segmenteAlle(); }); };

  /* ── Gestaffeltes Einblenden beim Seitenwechsel ── */
  function einblenden(seite) {
    if (ruhig()) return;
    const p = document.getElementById('page-' + seite);
    if (!p) return;
    const teile = [...p.querySelectorAll(':scope > .header-bar, .kpi, :scope > .card, .raster > *, .card-grid > .card, .card-grid-2 > .card, .dk-grid > *, .vm-grid > *')]
      .filter(e => e.offsetParent).slice(0, 14);
    teile.forEach((e, i) => {
      e.classList.remove('ein'); void e.offsetWidth;
      e.style.setProperty('--i', i);
      e.classList.add('ein');
      e.addEventListener('animationend', () => e.classList.remove('ein'), { once: true });
    });
  }

  const KURZ = { dashboard: 'Übersicht', security: 'Sicherheit', vms: 'VMs', connections: 'Verbindungen' };
  function tableisteBauen() {
    const t = document.getElementById('tableiste');
    if (!t) return;
    const alle = ziele();
    const ids = new Set(alle.map(z => z.id));
    const tabs = TAB_WUNSCH.filter(id => ids.has(id)).slice(0, 4).map(id => alle.find(z => z.id === id));
    const aktiv = aktiveSeite();
    const imMehr = aktiv && !tabs.some(z => z.id === aktiv);
    const schluessel = tabs.map(z => z.id).join() + '|' + aktiv;
    if (t._schluessel === schluessel) return;
    t._schluessel = schluessel;
    t.innerHTML = tabs.map(z => `<button type="button" class="tab${z.id === aktiv ? ' active' : ''}" data-ziel="${z.id}"
        ${z.id === aktiv ? 'aria-current="page"' : ''}>${z.svg}<span>${KURZ[z.id] || z.name}</span></button>`).join('') +
      `<button type="button" class="tab${imMehr ? ' active' : ''}" id="tab-mehr" aria-haspopup="dialog" aria-expanded="false"
        aria-controls="seitenleiste"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg>
        <span>${imMehr ? esc(aktiv === 'konto' ? 'Konto' : (KURZ[aktiv] || (alle.find(z => z.id === aktiv) || {}).name || 'Mehr')) : 'Mehr'}</span></button>`;
  }

  function gruppenPruefen() {
    document.querySelectorAll('#seitenleiste .nav-gruppe').forEach(g => {
      g.hidden = ![...g.querySelectorAll('.nav-item')].some(sichtbar);
    });
  }

  function kontoZeigen() {
    const n = window._userName || '', r = window._userRole || '';
    const b = document.getElementById('sb-benutzer');
    if (!b || !n) return;
    b.textContent = n;
    document.getElementById('sb-rolle').textContent = { superadmin: 'Superadmin', admin: 'Admin', user: 'Benutzer' }[r] || r;
    const av = document.getElementById('sb-avatar');
    if (av && av.textContent === '?' && !av.querySelector('img')) av.textContent = n.slice(0, 1).toUpperCase();
  }

  const TITEL = 'Command Center';
  let letzteSeite = '';
  function nachSeite() {
    const a = aktiveSeite();
    document.querySelectorAll('#seitenleiste .nav-item, #nav-btn-konto').forEach(b => {
      if (b.classList.contains('active')) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    const z = ziele().find(x => x.id === a);
    document.title = a === 'konto' ? `Mein Konto · ${TITEL}` : z && a !== 'dashboard' ? `${z.name} · ${TITEL}` : TITEL;
    tableisteBauen();
    markierungSetzen();
    if (a && a !== letzteSeite) {
      letzteSeite = a;
      zuletztMerken(a);
    }
  }

  let geplant = 0;
  function aktualisieren() {
    if (geplant) return;
    geplant = requestAnimationFrame(() => { geplant = 0; gruppenPruefen(); kontoZeigen(); nachSeite(); });
  }
  window.navAktualisieren = aktualisieren;

  // showPage (app.js) umhüllen: Blatt schließen, Titel/Tableiste/Markierung, gestaffelt einblenden
  const vorher = window.showPage;
  if (typeof vorher === 'function') {
    window.showPage = function (seite) {
      const r = vorher.apply(this, arguments);
      if (document.body.classList.contains('nav-offen')) navMehr(false);
      aktualisieren();
      einblenden(seite);
      setTimeout(segmenteAlle, 30);
      return r;
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    const l = leiste();
    new MutationObserver(aktualisieren).observe(l, { subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    // Segmente: auf Klassen-/aria-Wechsel und neue Knöpfe reagieren
    new MutationObserver(ms => {
      for (const m of ms) {
        const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (t && (t.closest(SEG) || t.matches?.('.page'))) { segmenteBald(); return; }
      }
    }).observe(document.querySelector('.main-content'), { subtree: true, attributes: true, attributeFilter: ['class', 'aria-pressed'], childList: true });
    addEventListener('resize', () => { markierungSetzen(); segmenteBald(); });
    l.querySelector('.nav-items')?.addEventListener('scroll', () => {}, { passive: true });
    document.getElementById('tableiste').addEventListener('click', e => {
      const b = e.target.closest('.tab');
      if (!b) return;
      if (b.id === 'tab-mehr') navMehr();
      else window.showPage(b.dataset.ziel);
    });
    const h = document.getElementById('sys-hostname');
    if (h) new MutationObserver(() => {
      const t = h.textContent.trim();
      if (t && !/^Lade|^Loading/.test(t)) document.getElementById('sb-host').textContent = t;
    }).observe(h, { childList: true, characterData: true, subtree: true });
    aktualisieren();
    setTimeout(() => { aktualisieren(); segmenteAlle(); }, 800);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { markierungSetzen(); segmenteAlle(); });
  });

  /* ═══ Suche („Springen zu …“) ═══════════════════════════════════════════════════════════════════════════ */
  function zuletztLesen() {
    try { return JSON.parse(speicher.lesen('cc-zuletzt') || '[]').filter(x => typeof x === 'string').slice(0, 5); } catch (_) { return []; }
  }
  function zuletztMerken(id) {
    if (id === 'dashboard') return;
    const z = [id, ...zuletztLesen().filter(x => x !== id)].slice(0, 5);
    speicher.schreiben('cc-zuletzt', JSON.stringify(z));
  }

  const BESCHR = {
    dashboard: 'CPU, RAM, Netzwerk, Datenträger – Graphen', startseite: 'Kacheln der eigenen Startseite',
    processes: 'Laufende Prozesse beenden', services: 'systemd-Dienste starten und stoppen', updates: 'Paket-Updates',
    terminal: 'Shell auf dem Host', docker: 'Container, Images, Netzwerke, Stacks', vms: 'libvirt-VMs, Netze, ISOs',
    connections: 'SSH, VNC, RDP zu anderen Rechnern', browser: 'Isolierte Browser-Sitzungen',
    security: 'IDS, fail2ban, gesperrte IPs', angriffe: 'Angriffs-Radar: Scans, Logins, IDS', notifications: 'ntfy-Meldungen', users: 'Linux-Benutzer und Rollen',
    konten: 'Eingebettete Konten-Apps', codes: 'Zugangscodes', backups: 'Sicherungen', hilfe: 'Anleitung, Tastenkürzel, Rechte',
    werkzeuge: 'Entwickler-Werkzeuge', automationen: 'n8n-Workflows, Läufe, Ein/Aus', settings: 'Tabs, Standard-SSH-Zugang', konto: 'Profilbild, Passwort, E-Mail',
  };
  const SYM = {
    konto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    container: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg>',
    dienst: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/></svg>',
  };

  function aktionen() {
    const dunkel = document.documentElement.dataset.modus === 'dunkel';
    return [
      { id: '!konto', name: 'Mein Konto', beschr: BESCHR.konto, art: 'Seite', gruppe: 'Aktionen', svg: SYM.konto, tun: () => window.showPage('konto') },
      { id: '!modus', name: dunkel ? 'Heller Modus' : 'Dunkler Modus', beschr: 'Erscheinungsbild wechseln', art: 'Aktion', gruppe: 'Aktionen',
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/></svg>',
        tun: () => document.querySelector('[data-modus-schalter]')?.click() },
      { id: '!leiste', name: 'Seitenleiste ein-/ausklappen', beschr: 'Nur Symbole oder mit Text', art: 'Aktion', gruppe: 'Aktionen', kurz: '⌘B',
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>',
        tun: () => navEinklappen(), nurDesktop: true },
      { id: '!passwort', name: 'Passwort ändern', beschr: 'Linux-Passwort dieses Kontos', art: 'Aktion', gruppe: 'Aktionen',
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
        tun: () => { window.showPage('konto'); setTimeout(() => document.getElementById('ko-pw-alt')?.focus(), 350); } },
      { id: '!abmelden', name: 'Abmelden', beschr: 'Sitzung auf diesem Gerät beenden', art: 'Aktion', gruppe: 'Aktionen',
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
        tun: () => { window.location.href = '/logout'; } },
    ].filter(a => !(a.nurDesktop && handy()));
  }

  // Container/Dienste nachladen (nur Superadmins, 60 s zwischengespeichert)
  const extra = { t: 0, container: [], dienste: [], laedt: null };
  function extraLaden() {
    if (window._userRole !== 'superadmin' || extra.laedt || Date.now() - extra.t < 60000) return extra.laedt;
    extra.laedt = Promise.all([
      api('/api/docker/containers').then(d => (d && d.containers) || []).catch(() => []),
      api('/api/services').then(d => Array.isArray(d) ? d : []).catch(() => []),
    ]).then(([c, s]) => {
      extra.container = c.map(x => ({ id: '#c:' + (x.id || x.Id || x.name), cid: x.id || x.Id, name: (x.name || x.Names || '').toString().replace(/^\//, ''),
        beschr: [String(x.image || x.Image || '').split('@')[0], x.status || x.Status || x.state || x.State].filter(Boolean).join(' · '), art: 'Container', gruppe: 'Docker-Container', svg: SYM.container,
        zustand: (x.state || x.State || '').toLowerCase() }));
      extra.dienste = s.map(x => ({ id: '#s:' + x.name, name: x.name, beschr: x.description || '', art: 'Dienst', gruppe: 'Dienste', svg: SYM.dienst,
        zustand: x.active === 'active' || x.status === 'running' ? 'running' : '' }));
      extra.t = Date.now(); extra.laedt = null;
      if (pal && pal.open) palZeigen();
    });
    return extra.laedt;
  }

  // Unscharfe Suche: Buchstaben in Reihenfolge; Punkte für Wortanfang, Folgen, Treffer im Namen
  function treffer(text, q) {
    const t = text.toLowerCase();
    const i = t.indexOf(q);
    if (i >= 0) return { punkte: 100 - i + (i === 0 || /[\s\-_.]/.test(t[i - 1]) ? 40 : 0) + q.length * 2, pos: [...Array(q.length).keys()].map(k => k + i) };
    let p = 0, punkte = 0, letzte = -2;
    const pos = [];
    for (const c of q) {
      const j = t.indexOf(c, p);
      if (j < 0) return null;
      pos.push(j);
      punkte += j === letzte + 1 ? 6 : (j === 0 || /[\s\-_.]/.test(t[j - 1]) ? 4 : 1);
      letzte = j; p = j + 1;
    }
    return { punkte, pos };
  }
  function markieren(text, pos) {
    if (!pos || !pos.length) return esc(text);
    const set = new Set(pos);
    return [...text].map((c, i) => set.has(i) ? `<mark>${esc(c)}</mark>` : esc(c)).join('');
  }

  let pal = null, palWahl = 0, palListe = [];
  function palBauen() {
    pal = document.createElement('dialog');
    pal.className = 'palette';
    pal.setAttribute('aria-label', 'Suche');
    pal.innerHTML = `<div class="pal-feld"><svg class="pal-lupe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input type="text" role="combobox" aria-expanded="true" aria-controls="pal-liste" aria-autocomplete="list" aria-label="Suchen"
        placeholder="Seite, Container, Dienst oder Aktion …" autocomplete="off" spellcheck="false">
      <button type="button" class="pal-esc" aria-label="Suche schließen"><kbd>Esc</kbd></button></div>
      <div class="pal-linie" aria-hidden="true"></div>
      <div class="pal-chips" role="group" aria-label="Bereich">
        <button type="button" data-filter="" aria-pressed="true">Alles</button><button type="button" data-filter="Seite" aria-pressed="false">Seiten</button>
        <button type="button" data-filter="Container" aria-pressed="false">Container</button><button type="button" data-filter="Dienst" aria-pressed="false">Dienste</button>
        <button type="button" data-filter="Aktion" aria-pressed="false">Aktionen</button></div>
      <div class="pal-inhalt"><span class="pal-wahl" aria-hidden="true"></span><ul id="pal-liste" role="listbox" aria-label="Treffer"></ul></div>
      <div class="pal-fuss" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> wählen</span><span><kbd>↵</kbd> öffnen</span><span><kbd>Tab</kbd> Bereich</span><span class="pal-zahl"></span></div>`;
    document.body.appendChild(pal);
    const ein = pal.querySelector('input');
    pal._filter = '';
    ein.addEventListener('input', () => { palWahl = 0; palZeigen(); pal.querySelector('.pal-linie').style.setProperty('--fuell', Math.min(1, ein.value.length / 12)); });
    ein.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); palWahl = Math.min(palListe.length - 1, palWahl + 1); palMarkieren(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); palWahl = Math.max(0, palWahl - 1); palMarkieren(); }
      else if (e.key === 'Enter') { e.preventDefault(); palAusfuehren(palListe[palWahl]); }
      else if (e.key === 'Tab') {
        e.preventDefault();
        const ks = [...pal.querySelectorAll('.pal-chips button')];
        const i = ks.findIndex(k => k.getAttribute('aria-pressed') === 'true');
        ks[(i + (e.shiftKey ? ks.length - 1 : 1)) % ks.length].click();
      }
    });
    pal.querySelector('.pal-chips').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      pal._filter = b.dataset.filter;
      pal.querySelectorAll('.pal-chips button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      palWahl = 0; palZeigen(); ein.focus();
    });
    pal.querySelector('.pal-esc').addEventListener('click', palSchliessen);
    pal.addEventListener('cancel', e => { e.preventDefault(); palSchliessen(); });
    pal.addEventListener('click', e => {
      if (e.target === pal) { palSchliessen(); return; }
      const li = e.target.closest('[data-i]');
      if (li) palAusfuehren(palListe[+li.dataset.i]);
    });
    pal.addEventListener('pointermove', e => {
      const li = e.target.closest('[data-i]');
      if (li && +li.dataset.i !== palWahl) { palWahl = +li.dataset.i; palMarkieren(true); }
    });
  }

  function kandidaten() {
    const seiten = ziele().map(z => ({ ...z, art: 'Seite', beschr: BESCHR[z.id] || '' }));
    return [...seiten, ...aktionen(), ...extra.container, ...extra.dienste];
  }

  function palZeigen() {
    const q = pal.querySelector('input').value.trim().toLowerCase();
    const f = pal._filter;
    let liste;
    const alle = kandidaten().filter(z => !f || z.art === f || (f === 'Seite' && z.art === 'Seite'));
    if (!q) {
      const zl = f ? [] : zuletztLesen().map(id => alle.find(z => z.id === id) || (id === 'konto' ? aktionen().find(a => a.id === '!konto') : null))
        .filter(Boolean).map(z => ({ ...z, gruppe: 'Zuletzt geöffnet', pos: null }));
      const ids = new Set(zl.map(z => z.id));
      const rest = alle.filter(z => !ids.has(z.id) && (f || (z.art !== 'Container' && z.art !== 'Dienst')));
      liste = [...zl, ...rest.map(z => ({ ...z, gruppe: z.art === 'Seite' ? (z.gruppe || 'Seiten') : z.gruppe }))];
    } else {
      liste = alle.map(z => {
        const a = treffer(z.name, q), b = z.beschr ? treffer(z.beschr, q) : null;
        const p = a ? a.punkte + (z.art === 'Seite' ? 25 : z.art === 'Aktion' ? 15 : 0) : b ? b.punkte / 4 : -1;
        return p < 0 ? null : { ...z, punkte: p, pos: a ? a.pos : null };
      }).filter(Boolean).sort((x, y) => y.punkte - x.punkte).slice(0, 40)
        .map(z => ({ ...z, gruppe: z.art === 'Seite' ? 'Seiten' : z.art === 'Aktion' ? 'Aktionen' : z.gruppe }));
      // Bereiche zusammenhalten, Reihenfolge nach bestem Treffer je Bereich
      const reihenfolge = [...new Set(liste.map(z => z.gruppe))];
      liste.sort((x, y) => reihenfolge.indexOf(x.gruppe) - reihenfolge.indexOf(y.gruppe));
    }
    palListe = liste;
    const ul = pal.querySelector('ul');
    let gruppe = null;
    ul.innerHTML = liste.length ? liste.map((z, i) => {
      const kopf = z.gruppe !== gruppe ? `<li class="pal-gruppe" role="presentation">${esc((gruppe = z.gruppe))}</li>` : '';
      const zu = z.zustand ? `<span class="pille ${z.zustand === 'running' ? 'gut' : 'neutral'} pal-zustand">${z.zustand === 'running' ? 'läuft' : esc(z.zustand || 'aus')}</span>` : '';
      return `${kopf}<li role="option" id="pal-${i}" data-i="${i}" aria-selected="false" style="--i:${Math.min(i, 10)}">
        <span class="pal-sym pal-sym-${esc((z.art || '').toLowerCase())}">${z.svg || ''}</span>
        <span class="pal-text"><b>${markieren(z.name, z.pos)}</b>${z.beschr ? `<small>${esc(z.beschr)}</small>` : ''}</span>
        ${zu}${z.kurz ? `<kbd>${esc(z.kurz)}</kbd>` : ''}<span class="pal-enter" aria-hidden="true">↵</span></li>`;
    }).join('') : `<li class="pal-leer" role="presentation"><b>Nichts gefunden</b><span>Versuch z. B. „docker“, „sperren“ oder einen Container-Namen.</span></li>`;
    pal.querySelector('.pal-zahl').textContent = liste.length ? `${liste.length} Treffer` : '';
    palMarkieren();
  }
  function palMarkieren(zeiger) {
    let wahl = null;
    pal.querySelectorAll('[role=option]').forEach(li => {
      const an = +li.dataset.i === palWahl;
      li.setAttribute('aria-selected', String(an));
      if (an) wahl = li;
    });
    const w = pal.querySelector('.pal-wahl');
    if (wahl) {
      if (!zeiger) wahl.scrollIntoView({ block: 'nearest' });
      w.style.transform = `translateY(${wahl.offsetTop}px)`;
      w.style.height = wahl.offsetHeight + 'px';
      w.classList.add('an');
    } else w.classList.remove('an');
    pal.querySelector('input').setAttribute('aria-activedescendant', wahl ? wahl.id : '');
  }
  function palSchliessen() {
    if (!pal || !pal.open) return;
    if (ruhig()) { pal.close(); return; }
    pal.classList.add('zu');
    setTimeout(() => { pal.classList.remove('zu'); pal.close(); }, 160);
  }
  function palAusfuehren(z) {
    if (!z) return;
    palSchliessen();
    if (z.tun) z.tun();
    else if (z.cid && window.openDockerDetail) { window.showPage('docker'); setTimeout(() => openDockerDetail(z.cid), 60); zuletztMerken('docker'); }
    else if (z.id.startsWith('#s:')) {
      window.showPage('services');
      setTimeout(() => { const s = document.querySelector('#page-services .header-search'); if (s) { s.value = z.name; s.dispatchEvent(new Event('input')); } }, 400);
    } else window.showPage(z.id);
  }
  window.paletteOeffnen = function () {
    if (!pal) palBauen();
    if (document.body.classList.contains('nav-offen')) navMehr(false);
    pal.querySelector('input').value = '';
    pal.querySelector('.pal-linie').style.setProperty('--fuell', 0);
    palWahl = 0; palZeigen();
    pal.showModal();
    pal.querySelector('input').focus();
    const l = extraLaden(); if (l) l.then(() => pal.open && palZeigen());
  };

  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && e.key.toLowerCase() === 'k') {
      if (e.ctrlKey && !e.metaKey && document.activeElement && document.activeElement.closest('#page-terminal')) return;
      e.preventDefault();
      if (pal && pal.open) palSchliessen(); else paletteOeffnen();
    } else if (mod && !e.altKey && e.key.toLowerCase() === 'b' && !handy()) {
      if (document.activeElement && document.activeElement.closest('#page-terminal')) return;
      e.preventDefault(); navEinklappen();
    } else if (e.key === 'Escape' && document.body.classList.contains('nav-offen')) {
      navMehr(false);
    }
  });
  matchMedia('(max-width: 768px)').addEventListener('change', () => { if (!handy()) navMehr(false); setTimeout(markierungSetzen, 50); });
})();
