// Angriffs-Radar (seit 3.6.0, 19.11.2026) – Seite „Angriffe“.
// Daten: GET /api/security/angriffe?bereich=24h|7d|30d (dashboard/angriffe.py), gesammelt vom Host-Dienst
// angriffe-sammeln.timer (schutz/sbin/angriffe-sammeln.py) alle 5 Minuten. Lädt alle 60 s neu, solange die Seite offen ist.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const zahl = (n) => Number(n || 0).toLocaleString('de-DE');
  const KAT = {
    geheim: { name: 'Geheimnisse', farbe: '--g-1' },
    luecke: { name: 'Lücken & Exploits', farbe: '--g-2' },
    login: { name: 'Logins', farbe: '--g-3' },
    netz: { name: 'Netzwerk (IDS)', farbe: '--g-4' },
  };
  const BEREICH = { '24h': { kurz: 'Letzte 24 Std', vorher: 'Vortag' }, '7d': { kurz: 'Letzte 7 Tage', vorher: 'Vorwoche' }, '30d': { kurz: 'Letzte 30 Tage', vorher: 'Vormonat' } };
  const st = { bereich: '24h', timer: null, verdrahtet: false, laedt: false, neu: true };
  try { const b = localStorage.getItem('cc-angriffe-bereich'); if (BEREICH[b]) st.bereich = b; } catch { /* privat */ }

  const WTAG = new Intl.DateTimeFormat('de-AT', { weekday: 'short', day: 'numeric', month: 'numeric' });
  const UHR = new Intl.DateTimeFormat('de-AT', { hour: '2-digit', minute: '2-digit' });
  const TAG_UHR = new Intl.DateTimeFormat('de-AT', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  function wann(ts) {
    const d = new Date(ts * 1000), heute = new Date();
    return d.toDateString() === heute.toDateString() ? UHR.format(d) : TAG_UHR.format(d);
  }
  function vorAus(ts) {
    const s = Math.max(0, Date.now() / 1000 - ts);
    return s < 90 ? 'gerade eben' : s < 3600 ? `vor ${Math.round(s / 60)} Min` : s < 86400 ? `vor ${Math.round(s / 3600)} Std` : `vor ${Math.round(s / 86400)} Tagen`;
  }

  function verdrahten() {
    if (st.verdrahtet) return;
    st.verdrahtet = true;
    document.querySelectorAll('[data-ag-bereich]').forEach((b) => b.addEventListener('click', () => {
      st.bereich = b.dataset.agBereich; st.neu = true;
      try { localStorage.setItem('cc-angriffe-bereich', st.bereich); } catch { /* privat */ }
      knoepfe(); laden();
    }));
    $('ag-ips-body').addEventListener('click', (e) => {
      const k = e.target.closest('[data-ag-sperren]');
      if (k) sperren(k.dataset.agSperren);
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && aktiv()) laden(); });
  }
  const aktiv = () => typeof currentPage !== 'undefined' && currentPage === 'angriffe';
  function knoepfe() {
    document.querySelectorAll('[data-ag-bereich]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.agBereich === st.bereich)));
  }

  async function laden() {
    if (st.laedt) return;
    st.laedt = true;
    try {
      const d = await api('/api/security/angriffe?bereich=' + st.bereich);
      zeichnen(d);
    } finally { st.laedt = false; }
  }

  function delta(id, jetzt, vorher, ok) {
    const e = $(id);
    if (!ok || !vorher) { e.textContent = ''; e.removeAttribute('title'); return; }
    const p = Math.round(((jetzt - vorher) / vorher) * 100);
    e.textContent = (p > 0 ? '+' : p < 0 ? '−' : '±') + Math.abs(p) + ' %';
    e.title = `${BEREICH[st.bereich].vorher}: ${zahl(vorher)}`;
    e.className = 'kpi-zusatz ' + (p > 25 ? 'ag-mehr' : p < -25 ? 'ag-weniger' : '');
  }

  function zeichnen(d) {
    const fehlt = $('ag-fehlt');
    if (!d || d.error || d.fehler || d.fehlt) {
      fehlt.hidden = false;
      fehlt.textContent = d && d.fehlt ? 'Noch keine Daten: Der Sammler (angriffe-sammeln.timer) ist auf diesem Server nicht eingerichtet.'
        : 'Daten konnten nicht geladen werden: ' + ((d && (d.fehler || d.error)) || 'unbekannter Fehler');
      return;
    }
    fehlt.hidden = true;
    const s = d.summen, v = d.vorher, alt = Date.now() / 1000 - d.letzter_lauf;
    const stand = $('ag-stand');
    stand.className = 'kopf-pille' + (alt > 900 ? ' ag-alt' : '');
    stand.innerHTML = `<span class="status-dot"></span><b>${alt > 900 ? 'Sammler hängt – ' : 'Stand '}${esc(vorAus(d.letzter_lauf))}</b>`;

    $('ag-gesamt').textContent = zahl(s.gesamt);
    $('ag-ips').textContent = zahl(s.ips);
    $('ag-geheim').textContent = zahl(s.kategorien.geheim);
    $('ag-sperren').textContent = zahl(s.sperren);
    $('ag-gesamt-unter').textContent = BEREICH[st.bereich].kurz;
    delta('ag-d-gesamt', s.gesamt, v.gesamt, d.vergleich);
    delta('ag-d-ips', s.ips, v.ips, d.vergleich);
    delta('ag-d-geheim', s.kategorien.geheim, v.kategorien.geheim, d.vergleich);
    delta('ag-d-sperren', s.sperren, v.sperren, d.vergleich);

    // Verlauf: eine Linie je Art; Fächer = Stunde (24 Std), 6 Std (7 Tage), Tag (30 Tage)
    if (window.Graph) {
      const lang = d.schritt >= 86400, mittel = d.schritt >= 3600 * 6;
      Graph.verlauf($('ag-verlauf'), {
        titel: 'Versuche nach Art', zeiten: d.zeiten, schritt: d.schritt,
        jetzt: d.zeiten[d.zeiten.length - 1], bereichS: d.zeiten[d.zeiten.length - 1] - d.zeiten[0],
        bereichKurz: BEREICH[st.bereich].kurz, neu: st.neu, hoehe: 220,
        reihen: Object.entries(KAT).map(([k, o]) => ({ name: o.name, farbe: o.farbe, werte: d.reihen[k] })),
        format: (x) => zahl(Math.round(x)) + (x === 1 ? ' Versuch' : ' Versuche'),
        achse: (x) => zahl(Math.round(x)),
        zeitText: (t, kurz) => {
          const dt = new Date(t * 1000);
          if (lang) return WTAG.format(dt);
          if (mittel) return kurz ? WTAG.format(dt) : `${WTAG.format(dt)}, ${UHR.format(dt)}`;
          return UHR.format(dt);
        },
      });
      const summe = d.zeiten.map((_, i) => Object.keys(KAT).reduce((a, k) => a + (d.reihen[k][i] || 0), 0));
      Graph.funke($('ag-funke'), summe, { farbe: '--g-1', format: (x) => zahl(x) });
    }
    st.neu = false;

    // Wer greift an?
    $('ag-ips-zahl').textContent = d.top_ips.length ? `Top ${d.top_ips.length}` : '';
    $('ag-ips-body').innerHTML = d.top_ips.length ? d.top_ips.map((r) => {
      const arten = Object.entries(r.kategorien).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `<span class="ag-art ag-${k}" title="${esc(KAT[k].name)}: ${zahl(n)}">${esc(KAT[k].name)}</span>`).join('');
      const aktion = r.gesperrt ? '<span class="pille schlecht" title="Gerade gesperrt (fail2ban/IDS)">gesperrt</span>'
        : `<button type="button" class="btn btn-sm" data-ag-sperren="${esc(r.ip)}">Sperren</button>`;
      return `<tr><td class="ag-ip"><a href="https://ipinfo.io/${encodeURIComponent(r.ip)}" target="_blank" rel="noopener noreferrer" title="Herkunft nachschlagen (ipinfo.io)">${esc(r.ip)}</a></td>
        <td class="zahl"><b>${zahl(r.anzahl)}</b></td><td><div class="ag-arten">${arten}</div></td>
        <td class="ag-ziel">${esc(r.ziele.join(', '))}</td><td class="ag-zeit" title="Erster Versuch: ${esc(wann(r.erst))}">${esc(wann(r.letzt))}</td><td>${aktion}</td></tr>`;
    }).join('') : '<tr><td colspan="6" class="ag-leer">Keine Versuche in diesem Zeitraum.</td></tr>';

    balken('ag-ziele', d.ziele.map((z) => ({ text: z.ziel, n: z.anzahl, unter: `${zahl(z.ips)} IPs · ${z.login ? 'Logins' : 'Scans'}`, kat: z.login > z.web ? 'login' : 'luecke' })));
    balken('ag-pfade', d.pfade.map((p) => ({ text: p.pfad, n: p.anzahl, unter: `${zahl(p.ips)} IPs`, kat: p.art === 'geheim' ? 'geheim' : 'luecke', code: true })));
    balken('ag-ids', d.ids.map((p) => ({ text: p.signatur, n: p.anzahl, unter: `${zahl(p.ips)} IPs`, kat: 'netz' })));

    $('ag-letzte-body').innerHTML = d.letzte.length ? d.letzte.map((r) => `<tr>
        <td class="ag-zeit">${esc(wann(r.ts))}</td><td class="ag-ip">${esc(r.ip)}</td>
        <td><span class="ag-art ag-${esc(r.kat)}">${esc((KAT[r.kat] || {}).name || r.kat)}</span></td>
        <td class="ag-ziel">${esc(r.ziel)}</td><td class="ag-anfrage"><code>${esc(r.detail)}</code></td>
        <td class="zahl">${r.status ? esc(r.status) : '–'}</td></tr>`).join('')
      : '<tr><td colspan="6" class="ag-leer">Noch nichts aufgezeichnet.</td></tr>';
    if (window.Bewegung) Bewegung.neueZeilen($('ag-letzte-body'), (tr) => tr.textContent.slice(0, 80));   // 3.10.0: neue Versuche leuchten auf
  }

  function balken(id, zeilen) {
    const el = $(id);
    if (!zeilen.length) { el.innerHTML = '<p class="ag-leer">Nichts in diesem Zeitraum.</p>'; return; }
    const max = Math.max(...zeilen.map((z) => z.n));
    el.innerHTML = '<ol>' + zeilen.map((z) => `<li>
        <div class="ag-b-kopf"><span class="ag-b-text${z.code ? ' ag-code' : ''}" title="${esc(z.text)}">${esc(z.text)}</span><b>${zahl(z.n)}</b></div>
        <div class="ag-b-spur" aria-hidden="true"><i class="ag-${esc(z.kat)}" style="width:${Math.max(1.5, (z.n / max) * 100).toFixed(1)}%"></i></div>
        <div class="ag-b-unter">${esc(z.unter)}</div></li>`).join('') + '</ol>';
  }

  async function sperren(ip) {
    const ok = await uiConfirm(`IP ${ip} sperren?\n\nDie IP wird 4 Wochen lang am Cloudflare-Rand (alle Seiten) und an der Server-Firewall gesperrt.\nAufheben jederzeit unter „Sicherheit & Sperren“ → Entsperren.`,
      { okLabel: 'Sperren', danger: true });
    if (!ok) return;
    toast(`Sperre ${ip} …`, 'info', 3000);
    const r = await api('/api/security/ban', { method: 'POST', body: JSON.stringify({ ip }) });
    if (r.success) {
      toast(`${r.ip} gesperrt (Jail manuell)`, 'success');
      document.querySelectorAll(`[data-ag-sperren="${CSS.escape(ip)}"]`).forEach((b) => { b.outerHTML = '<span class="pille schlecht">gesperrt</span>'; });
    } else toast(`Sperren fehlgeschlagen: ${r.error || 'siehe Protokoll'}`, 'error', 8000);
  }

  window.angriffeLaden = function () {
    verdrahten(); knoepfe(); st.neu = true; laden();
    clearInterval(st.timer);
    st.timer = setInterval(() => {
      if (!aktiv()) { clearInterval(st.timer); st.timer = null; return; }
      if (document.visibilityState === 'visible') laden();
    }, 60000);
  };
})();
