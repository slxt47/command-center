// Mehrsprachigkeit (seit 3.14.0)
//
// Das Command Center ist auf Deutsch geschrieben. Für jede andere Sprache liegt eine Datei
// /icons/sprache-<code>.js daneben, die ein Wörterbuch Deutsch → Sprache mitbringt:
//   CC_SPRACHE_LADEN({ code, name, locale, texte: {de: x}, muster: [[de, x]], hilfe: [...] })
// Dieses Skript übersetzt beim Anzeigen: Texte und Attribute (title, placeholder, aria-label, alt) im DOM,
// Dialoge (alert/confirm/prompt), den Seitentitel sowie Datums- und Zahlenformate. Neue Inhalte erfasst
// ein MutationObserver. Terminal, Logs, Code und Elemente mit translate="no" bleiben unangetastet.
//
// Welche Sprache? Cookie „cc_sprache“ (setzt die Sprachwahl; das Konto merkt sie sich auf allen Geräten)
// → Voreinstellung des Servers (<html data-cc-sprache>, aus CC_SPRACHE in dashboard.env) → Deutsch.
(function () {
  'use strict';
  const SPRACHEN = { de: 'Deutsch', en: 'English' };   // neue Sprache: hier eintragen + sprache-<code>.js
  const cookie = (document.cookie.match(/(?:^|;\s*)cc_sprache=([a-z]{2})/) || [])[1];
  const vorgabe = document.documentElement.getAttribute('data-cc-sprache');
  let code = cookie || vorgabe || 'de';
  if (!SPRACHEN[code]) code = 'de';

  const api = {
    code, sprachen: SPRACHEN, daten: null,
    t: (s) => s,
    // Sprache wählen: Cookie setzen, im Konto merken (falls angemeldet) und neu laden
    setzen(neu, ohneNeuladen) {
      if (!SPRACHEN[neu]) return;
      document.cookie = `cc_sprache=${neu}; path=/; max-age=31536000; SameSite=Lax`;
      document.cookie = 'cc_sprache_neu=1; path=/; max-age=86400; SameSite=Lax';   // nach der Anmeldung ins Konto übernehmen
      const fertig = () => { if (!ohneNeuladen) location.reload(); };
      fetch('/api/prefs', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sprache: neu }) }).then(fertig, fertig);
    },
  };
  window.CC_I18N = api;
  document.documentElement.lang = code;
  if (code === 'de') { window.CC_SPRACHE_LADEN = () => {}; return; }

  // Sprachdatei synchron nachladen (steht im <head>, vor allen anderen Skripten)
  window.CC_SPRACHE_LADEN = function (d) {
    api.daten = d;
    vorbereiten(d);
  };
  document.write(`<script src="/icons/sprache-${code}.js?v=c575cb0562"><\/script>`);

  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  let TEXTE = new Map(), MUSTER = [], EINHEITEN = [];
  const cache = new Map();

  function vorbereiten(d) {
    TEXTE = new Map(Object.entries(d.texte || {}));
    // Muster: feste Teile + Platzhalter. Vor dem (teuren) regulären Ausdruck prüft ein schneller Test, ob alle festen
    // Teile in der richtigen Reihenfolge vorkommen – sonst würde jeder lange Text jedes Muster durchprobieren.
    MUSTER = (d.muster || []).map(([de, x]) => {
      const roh = de.split('\u0000').map((t) => t.replace(/\s+/g, ' '));
      roh[0] = roh[0].replace(/^ /, ''); roh[roh.length - 1] = roh[roh.length - 1].replace(/ $/, '');
      const fest = roh.filter((t) => t.trim());
      // zu unspezifisch? Ein Platzhalter braucht ein festes Zeichen (z. B. „Ø“), mehrere mindestens 3 Buchstaben
      const buchst = fest.join('').replace(/[^A-Za-zÄÖÜäöüß]/g, '').length;
      if (roh.length > 2 ? buchst < 3 : !fest.join('').trim()) return null;
      const re = new RegExp('^' + roh.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*?)') + '$', 's');
      return [re, x, fest];
    }).filter(Boolean);
    EINHEITEN = (d.einheiten || []).map(([re, x]) => [new RegExp(re), x]);
    if (d.locale) zahlenUndDaten(d.locale);
    if (Array.isArray(d.hilfe)) window.CC_HILFE = d.hilfe;
  }

  function ganz(k) {
    const v = TEXTE.get(k);
    if (v !== undefined) return v;
    if (k.length <= 600) for (const [re, x, fest] of MUSTER) {
      let pos = 0, ok = true;
      for (const f of fest) { const i = k.indexOf(f, pos); if (i < 0) { ok = false; break; } pos = i + f.length; }
      if (!ok) continue;
      const m = k.match(re);
      if (m) return x.replace(/\{(\d)\}/g, (_, i) => { const w = m[+i + 1] || ''; return uebersetzen(w) || w; });
    }
    for (const [re, x] of EINHEITEN) if (re.test(k)) return k.replace(re, x);
    return null;
  }

  // Liefert die Übersetzung oder null (= unverändert lassen)
  function uebersetzen(s) {
    if (!s || s.length > 4000) return null;
    const k = norm(s);
    if (!k || !/[A-Za-zÄÖÜäöüß]/.test(k)) return null;
    if (cache.has(k)) return cache.get(k);
    let r = ganz(k);
    // Zusammengesetzte Texte: Absätze, „Kopf: Rest“, „a · b“ einzeln übersetzen
    if (r == null && /\n/.test(s)) {
      const teile = s.split(/(\n+)/);
      let treffer = false;
      const neu = teile.map((t) => { if (/^\n+$/.test(t) || !t.trim()) return t; const x = uebersetzen(t); if (x != null) treffer = true; return x != null ? x : t; });
      if (treffer) r = neu.join('');
    }
    if (r == null) {
      const m = k.match(/^(.{2,60}?):\s+(.+)$/s);
      if (m) {
        const a = ganz(m[1] + ':') || (ganz(m[1]) != null ? ganz(m[1]) + ':' : null);
        const b = uebersetzen(m[2]);
        if (a != null || b != null) r = (a != null ? a : m[1] + ':') + ' ' + (b != null ? b : m[2]);
      }
    }
    if (r == null && / [·•] /.test(k)) {
      const teile = k.split(/( [·•] )/);
      let treffer = false;
      const neu = teile.map((t) => { if (/^ [·•] $/.test(t)) return t; const x = ganz(t.trim()); if (x != null) treffer = true; return x != null ? x : t; });
      if (treffer) r = neu.join('');
    }
    if (cache.size > 5000) cache.clear();
    cache.set(k, r);
    return r;
  }
  api.t = (s) => { const r = uebersetzen(String(s)); return r == null ? s : r; };

  // ── DOM ──────────────────────────────────────────────────────────────────
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'data-tip', 'aria-description'];
  // Ganz auslassen (auch Attribute) bzw. nur den Textinhalt auslassen (Eingabefelder: Platzhalter werden übersetzt)
  const AUSLASSEN_GANZ = 'script,style,pre,code,kbd,.xterm,.terminal,[translate="no"],[contenteditable],.no-i18n';
  const AUSLASSEN = AUSLASSEN_GANZ + ',textarea';
  const fertig = new WeakMap();   // Textknoten → übersetzter Wert (verhindert Doppelarbeit)

  function textKnoten(n) {
    const p = n.parentElement;
    if (!p || p.closest(AUSLASSEN)) return;
    const s = n.nodeValue;
    if (fertig.get(n) === s) return;
    const r = uebersetzen(s);
    if (r != null) {
      const vor = s.match(/^\s*/)[0], nach = s.match(/\s*$/)[0];
      const neu = vor + r + nach;
      fertig.set(n, neu);
      if (neu !== s) n.nodeValue = neu;
    } else fertig.set(n, s);
  }

  function element(el) {
    if (el.closest(AUSLASSEN_GANZ)) return;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v) { const r = uebersetzen(v); if (r != null && r !== v) el.setAttribute(a, r); }
    }
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/.test(el.type) && el.value) {
      const r = uebersetzen(el.value); if (r != null) el.value = r;
    }
  }

  function baum(wurzel) {
    if (wurzel.nodeType === 3) { textKnoten(wurzel); return; }
    if (wurzel.nodeType !== 1 && wurzel.nodeType !== 9 && wurzel.nodeType !== 11) return;
    if (wurzel.nodeType === 1) { if (wurzel.closest(AUSLASSEN_GANZ)) return; element(wurzel); }
    const w = document.createTreeWalker(wurzel, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeType === 1 && n.matches(AUSLASSEN_GANZ)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) textKnoten(n); else element(n); }
  }

  function start() {
    if (!api.daten) return;
    baum(document.body);
    const t = uebersetzen(document.title); if (t) document.title = t;
    new MutationObserver((liste) => {
      for (const m of liste) {
        if (m.type === 'childList') m.addedNodes.forEach(baum);
        else if (m.type === 'characterData') textKnoten(m.target);
        else if (m.type === 'attributes' && m.target.nodeType === 1) element(m.target);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    const titel = document.querySelector('title');
    if (titel) new MutationObserver(() => { const x = uebersetzen(document.title); if (x && x !== document.title) document.title = x; })
      .observe(titel, { childList: true, characterData: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  // ── Dialoge ──────────────────────────────────────────────────────────────
  const _alert = window.alert.bind(window), _confirm = window.confirm.bind(window), _prompt = window.prompt.bind(window);
  window.alert = (m) => _alert(api.t(m == null ? '' : String(m)));
  window.confirm = (m) => _confirm(api.t(m == null ? '' : String(m)));
  window.prompt = (m, v) => _prompt(api.t(m == null ? '' : String(m)), v);

  // ── Datum & Zahlen: deutsche Formate auf die Sprache umstellen ───────────
  function zahlenUndDaten(locale) {
    const um = (l) => (l == null || /^de(-|$)/i.test(String(l))) ? locale : l;
    for (const [proto, namen] of [[Date.prototype, ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']], [Number.prototype, ['toLocaleString']]]) {
      for (const n of namen) { const f = proto[n]; proto[n] = function (l, o) { return f.call(this, um(l), o); }; }
    }
    for (const n of ['DateTimeFormat', 'NumberFormat', 'RelativeTimeFormat']) {
      const K = Intl[n]; if (!K) continue;
      const neu = function (l, o) { return new K(um(l), o); };
      neu.prototype = K.prototype; neu.supportedLocalesOf = K.supportedLocalesOf;
      Intl[n] = neu;
    }
  }
})();
