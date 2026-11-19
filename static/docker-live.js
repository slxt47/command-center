// Container-Livedaten (seit 3.8.0, 19.11.2026): Detailseite misst jede Sekunde statt alle 2–5 s.
// GET /api/docker/stats/live?id=…&seit=… liefert nur neue Punkte; der Server hält 5 Minuten Verlauf (dashboard/docker.py).
// Oben vier Kacheln mit Sparkline (immer sichtbar), im Tab „Stats“ drei Graphen wie in der Übersicht.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const st = { id: null, timer: null, punkte: [], felder: null, info: {}, seit: 0, laedt: false, neu: true };

  const fmtB = (v) => (typeof formatBytes === 'function' ? formatBytes(v) : Math.round(v) + ' B');
  const rate = (v) => (window.Graph ? Graph.format.bytesS(v) : fmtB(v) + '/s');
  const zahl = (v, n = 1) => Number(v || 0).toLocaleString('de-DE', { minimumFractionDigits: n, maximumFractionDigits: n });

  window.dkLiveStart = function (d, statsTab) {
    const leiste = $('dkd-live');
    if (!d || !d.running) {
      if (leiste) leiste.hidden = true;
      stop();
      const n = $('dkd-stat-note'); if (n && statsTab) n.textContent = 'Container läuft nicht – keine Messwerte.';
      return;
    }
    if (leiste) leiste.hidden = false;
    if (st.id !== d.id) { st.id = d.id; st.punkte = []; st.seit = 0; st.info = {}; st.neu = true; }
    if (!st.timer) takt();
    else zeichnen();
  };

  function stop() { clearTimeout(st.timer); st.timer = null; }
  const aktiv = () => typeof currentPage !== 'undefined' && currentPage === 'docker-detail' && typeof _dkDetailId !== 'undefined' && _dkDetailId === st.id;

  async function takt() {
    st.timer = null;
    if (!aktiv()) return;
    if (document.visibilityState === 'visible' && !st.laedt) {
      st.laedt = true;
      try {
        const id = st.id;
        const r = await api(`/api/docker/stats/live?id=${encodeURIComponent(id)}&seit=${st.seit}`);
        if (id === st.id && r && !r.error) {
          st.felder = r.felder; st.info = r.info || st.info;
          if (r.punkte.length) { st.punkte.push(...r.punkte); st.seit = r.punkte[r.punkte.length - 1][0]; }
          const grenze = (r.jetzt || Date.now() / 1000) - 300;
          while (st.punkte.length && st.punkte[0][0] < grenze) st.punkte.shift();
          zeichnen();
        }
      } finally { st.laedt = false; }
    }
    if (aktiv()) st.timer = setTimeout(takt, 1000);
  }

  function reihe(name) { const i = st.felder.indexOf(name); return st.punkte.map((p) => p[i]); }

  function zeichnen() {
    if (!st.felder || !st.punkte.length) return;
    const cpus = st.info.cpus || 1, letzt = st.punkte[st.punkte.length - 1], F = st.felder, w = (k) => letzt[F.indexOf(k)];
    const cpuAnteil = reihe('cpu').map((v) => v / cpus);
    $('dkl-cpu').textContent = zahl(w('cpu') / cpus);
    $('dkl-cpus').textContent = `${cpus} Kern${cpus === 1 ? '' : 'e'}`;
    $('dkl-cpu-u').textContent = `${zahl(w('cpu'))} % eines Kerns · live`;
    $('dkl-ram').textContent = fmtB(w('mem'));
    $('dkl-ram-u').textContent = st.info.mem_limit ? `${zahl(w('mem_pct'))} % von ${fmtB(st.info.mem_limit)}` : 'kein Limit';
    $('dkl-rx').textContent = rate(w('rx')); $('dkl-tx').textContent = rate(w('tx'));
    $('dkl-rd').textContent = rate(w('rd')); $('dkl-wr').textContent = rate(w('wr'));
    $('dkl-pids').textContent = `${w('pids')} Prozesse`;
    if (window.Graph) {
      const k = (a) => a.slice(-90);
      Graph.funke($('dkl-f-cpu'), k(cpuAnteil), { max: 100, farbe: '--g-1', format: (v) => zahl(v) + ' %' });
      Graph.funke($('dkl-f-ram'), k(reihe('mem_pct')), { max: 100, farbe: '--g-2', format: (v) => zahl(v) + ' %' });
      Graph.funke($('dkl-f-net'), k(reihe('rx').map((v, i) => v + reihe('tx')[i])), { farbe: '--g-1', minMax: 1024, format: rate });
      Graph.funke($('dkl-f-io'), k(reihe('rd').map((v, i) => v + reihe('wr')[i])), { farbe: '--g-3', minMax: 1024, format: rate });
    }
    // Stats-Tab
    if (typeof _dkDetailTab !== 'undefined' && _dkDetailTab === 'stats' && $('dkg-last') && window.Graph) {
      const zeiten = reihe('t'), jetzt = zeiten[zeiten.length - 1];
      const gemein = { zeiten, schritt: 1, jetzt, bereichS: 300, bereichKurz: 'Letzte 5 Min', neu: st.neu };
      const achseB = (v) => (v === 0 ? '0' : rate(v));
      Graph.verlauf($('dkg-last'), { ...gemein, titel: 'Auslastung', max: 100,
        reihen: [{ name: 'CPU', farbe: '--g-1', werte: cpuAnteil }, { name: 'RAM', farbe: '--g-2', werte: reihe('mem_pct') }],
        format: Graph.format.prozent, achse: (v) => Math.round(v) + ' %' });
      Graph.verlauf($('dkg-netz'), { ...gemein, titel: 'Netzwerk', minMax: 1024,
        reihen: [{ name: 'Empfangen', farbe: '--g-1', werte: reihe('rx') }, { name: 'Gesendet', farbe: '--g-2', werte: reihe('tx') }],
        format: rate, achse: achseB });
      Graph.verlauf($('dkg-io'), { ...gemein, titel: 'Datenträger', minMax: 1024,
        reihen: [{ name: 'Lesen', farbe: '--g-3', werte: reihe('rd') }, { name: 'Schreiben', farbe: '--g-4', werte: reihe('wr') }],
        format: rate, achse: achseB });
      const kv = $('dkd-stat-kv');
      if (kv) kv.innerHTML = `<dt>Netz empfangen</dt><dd>${fmtB(st.info.net_rx || 0)}</dd><dt>Netz gesendet</dt><dd>${fmtB(st.info.net_tx || 0)}</dd>
        <dt>Gelesen</dt><dd>${fmtB(st.info.blk_read || 0)}</dd><dt>Geschrieben</dt><dd>${fmtB(st.info.blk_write || 0)}</dd>
        <dt>Prozesse</dt><dd>${w('pids')}</dd><dt>RAM-Limit</dt><dd>${st.info.mem_limit ? fmtB(st.info.mem_limit) : '–'}</dd>`;
      st.neu = false;
    }
  }

  // Kacheln öffnen den Stats-Tab
  document.addEventListener('click', (e) => { if (e.target.closest('[data-dk-stats]') && typeof dkdSwitchTab === 'function') dkdSwitchTab('stats'); });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('[data-dk-stats]')) { e.preventDefault(); dkdSwitchTab('stats'); }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && aktiv() && !st.timer) takt(); });
})();
