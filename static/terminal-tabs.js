// Terminal-Tabs (seit 3.9.0, erweitert 3.9.1): mehrere Terminals je Benutzer. Jeder Tab ist eine tmux-Sitzung auf dem
// Server (dashboard/termtabs.py) – Seite neu laden oder Browser schließen beendet nichts, nur „×“ schließt den Tab.
// 3.9.1: Einstellungsfenster (Name, Anheften, Position), Ziehen zum Verschieben, Tabs oben oder seitlich (je Benutzer).
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const st = { tabs: [], aktiv: '', max: 8, layout: 'oben', verdrahtet: false, dialogId: '', zieht: '' };
  const SPEICHER = () => 'cc-term-tab-' + (window._userName || '');
  const PIN = '<svg class="term-pin" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 3l5 5-3 1-4 4 1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 1 4-4z"/></svg>';
  const MEHR = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';

  function gemerkt() { try { return localStorage.getItem(SPEICHER()) || ''; } catch { return ''; } }
  function merken(id) { try { localStorage.setItem(SPEICHER(), id); } catch { /* privat */ } }

  async function laden() {
    verdrahten();
    const r = await api('/api/terminal/tabs');
    if (!r || r.error) { $('term-tab-liste').innerHTML = `<span class="term-tab-fehler">${escHtml((r && r.error) || 'Tabs nicht ladbar')}</span>`; return; }
    st.tabs = r.tabs; st.max = r.max || 8;
    layoutAnwenden((r.einstellungen || {}).layout || 'oben');
    if (!st.tabs.some((t) => t.id === st.aktiv)) {
      const g = gemerkt();
      st.aktiv = st.tabs.some((t) => t.id === g) ? g : (st.tabs[0] || {}).id || '';
    }
    zeichnen();
  }

  function zeichnen() {
    const l = $('term-tab-liste');
    const bauen = () => { l.innerHTML = st.tabs.map((t, i) => `
      <div class="term-tab${t.id === st.aktiv ? ' aktiv' : ''}${t.angeheftet ? ' angeheftet' : ''}" data-tab="${escHtml(t.id)}" data-fl="${escHtml(t.id)}" draggable="true">
        <button type="button" class="term-tab-knopf" aria-pressed="${t.id === st.aktiv}"
          title="${escHtml(t.titel)}${t.angeheftet ? ' (angeheftet)' : ''}${i < 9 ? ' · Alt+' + (i + 1) : ''} – Doppelklick: Einstellungen">${t.angeheftet ? PIN : ''}<span>${escHtml(t.titel)}</span></button>
        <button type="button" class="term-tab-mehr" aria-label="Einstellungen für ${escHtml(t.titel)}" title="Name, Anheften, Position">${MEHR}</button>
        ${t.angeheftet ? '' : `<button type="button" class="term-tab-zu" aria-label="${escHtml(t.titel)} schließen" title="Terminal schließen">×</button>`}
      </div>`).join(''); };
    // 3.10.0: neue Tabs wachsen auf, verschobene gleiten, geschlossene blenden aus
    if (window.Bewegung) Bewegung.flip(l, '.term-tab', 'data-tab', bauen); else bauen();
    $('term-tab-neu').disabled = st.tabs.length >= st.max;
    $('term-tab-neu').title = st.tabs.length >= st.max ? `Höchstens ${st.max} Terminals` : 'Neues Terminal (Alt+T)';
    l.querySelector('.term-tab.aktiv')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // ---------------------------------------------------------------- Layout oben/seitlich (je Benutzer, Server)
  function layoutAnwenden(l) {
    st.layout = l === 'seite' ? 'seite' : 'oben';
    const umschalten = () => $('page-terminal').classList.toggle('term-tabs-seite', st.layout === 'seite');
    // Tabs gleiten von oben in die Seitenspalte und zurück (3.10.0)
    if (window.Bewegung && $('page-terminal').classList.contains('term-tabs-seite') !== (st.layout === 'seite'))
      Bewegung.flip($('term-tabs'), '.term-tab, .term-tab-neu, .term-tab-layout', 'data-fl', umschalten); else umschalten();
    const k = $('term-tab-layout');
    k.setAttribute('aria-pressed', String(st.layout === 'seite'));
    k.title = k.ariaLabel = st.layout === 'seite' ? 'Tabs oben anzeigen' : 'Tabs seitlich anzeigen';
    setTimeout(() => { if (typeof _termSendResize === 'function') _termSendResize(); }, 60);   // Terminal ist schmäler/breiter
  }
  async function layoutWechseln() {
    const neu = st.layout === 'seite' ? 'oben' : 'seite';
    layoutAnwenden(neu);
    const r = await api('/api/terminal/tabs/layout', { method: 'POST', body: JSON.stringify({ layout: neu }) });
    if (r.error) toast(r.error, 'error');
  }

  // ---------------------------------------------------------------- Wechseln / Neu / Schließen
  function wechseln(id) {
    if (!id || id === st.aktiv) { if (typeof termFocus === 'function') termFocus(); return; }
    st.aktiv = id; merken(id); zeichnen();
    neuVerbinden();
  }

  function neuVerbinden() {
    // 3.10.0: Terminal blendet kurz ab, bis der neue Tab sich gezeichnet hat
    const seite = $('page-terminal'); seite.classList.add('wechselt'); setTimeout(() => seite.classList.remove('wechselt'), 380);
    if (typeof _termWs !== 'undefined' && _termWs) { const w = _termWs; _termWs = null; try { w.close(); } catch { /* egal */ } }
    if (typeof _termScreen !== 'undefined') { _termScreen.reset(); _termRender(); }
    termConnect();
  }

  async function neu() {
    const r = await api('/api/terminal/tabs/neu', { method: 'POST', body: JSON.stringify({}) });
    if (r.error) { toast(r.error, 'error', 6000); return; }
    st.tabs.push({ id: r.id, titel: r.titel, angeheftet: false, laeuft: false });
    wechseln(r.id);
  }

  async function schliessen(id) {
    const t = st.tabs.find((x) => x.id === id);
    if (!t) return false;
    if (t.angeheftet) { toast('Angeheftet – zuerst in den Einstellungen lösen.', 'info'); return false; }
    const ok = await uiConfirm(`„${t.titel}“ schließen?\n\nDie Shell und alle Programme darin werden beendet.`, { danger: true, okLabel: 'Schließen' });
    if (!ok) return false;
    const r = await api('/api/terminal/tabs/schliessen', { method: 'POST', body: JSON.stringify({ id }) });
    if (r.error) { toast(r.error, 'error'); return false; }
    const war = st.aktiv === id;
    st.tabs = st.tabs.filter((x) => x.id !== id);
    if (war) { st.aktiv = ''; await laden(); neuVerbinden(); } else if (!st.tabs.length) await laden(); else zeichnen();
    return true;
  }

  // ---------------------------------------------------------------- Reihenfolge
  async function reihenfolgeSpeichern(ids) {
    const r = await api('/api/terminal/tabs/reihenfolge', { method: 'POST', body: JSON.stringify({ ids }) });
    if (r.error) { toast(r.error, 'error'); await laden(); return; }
    const nach = new Map(st.tabs.map((t) => [t.id, t]));
    st.tabs = r.ids.map((i) => nach.get(i)).filter(Boolean);
    zeichnen();
  }
  function verschieben(id, ziel) {
    // ziel: neue Position innerhalb der eigenen Gruppe (angeheftet / normal)
    const t = st.tabs.find((x) => x.id === id); if (!t) return;
    const gruppe = st.tabs.filter((x) => !!x.angeheftet === !!t.angeheftet), rest = st.tabs.filter((x) => !!x.angeheftet !== !!t.angeheftet);
    const i = gruppe.indexOf(t); gruppe.splice(i, 1);
    const j = Math.max(0, Math.min(gruppe.length, ziel));
    gruppe.splice(j, 0, t);
    const alle = t.angeheftet ? [...gruppe, ...rest] : [...rest, ...gruppe];
    return reihenfolgeSpeichern(alle.map((x) => x.id));
  }

  // ---------------------------------------------------------------- Einstellungsfenster
  function positionText(t) {
    const gruppe = st.tabs.filter((x) => !!x.angeheftet === !!t.angeheftet);
    return `${gruppe.indexOf(t) + 1} von ${gruppe.length}${t.angeheftet ? ' (angeheftet)' : ''}`;
  }
  function dialog(id) {
    const t = st.tabs.find((x) => x.id === id); if (!t) return;
    st.dialogId = id;
    const f = $('ttd-form');
    $('ttd-titel').textContent = `Terminal „${t.titel}“`;
    f.titel.value = t.titel; f.angeheftet.checked = !!t.angeheftet;
    $('ttd-pos').textContent = positionText(t);
    $('ttd-fehler').hidden = true;
    $('ttd-schliessen-tab').disabled = !!t.angeheftet;
    $('ttd-schliessen-tab').title = t.angeheftet ? 'Angeheftete Terminals zuerst lösen' : '';
    $('term-tab-dialog').showModal();
    f.titel.select();
  }
  async function dialogSpeichern() {
    const f = $('ttd-form'), id = st.dialogId, t = st.tabs.find((x) => x.id === id);
    if (!t) return;
    const titel = f.titel.value.trim();
    if (!titel) { $('ttd-fehler').textContent = 'Bitte einen Namen eingeben.'; $('ttd-fehler').hidden = false; return; }
    const r = await api('/api/terminal/tabs/aendern', { method: 'POST', body: JSON.stringify({ id, titel, angeheftet: f.angeheftet.checked }) });
    if (r.error) { $('ttd-fehler').textContent = r.error; $('ttd-fehler').hidden = false; return; }
    $('term-tab-dialog').close();
    await laden();
  }

  // ---------------------------------------------------------------- Ereignisse
  function verdrahten() {
    if (st.verdrahtet) return;
    st.verdrahtet = true;
    const l = $('term-tab-liste');
    l.addEventListener('click', (e) => {
      const tab = e.target.closest('.term-tab'); if (!tab) return;
      if (e.target.closest('.term-tab-zu')) schliessen(tab.dataset.tab);
      else if (e.target.closest('.term-tab-mehr')) dialog(tab.dataset.tab);
      else wechseln(tab.dataset.tab);
    });
    l.addEventListener('dblclick', (e) => { const tab = e.target.closest('.term-tab'); if (tab && !e.target.closest('.term-tab-zu, .term-tab-mehr')) dialog(tab.dataset.tab); });
    l.addEventListener('contextmenu', (e) => { const tab = e.target.closest('.term-tab'); if (tab) { e.preventDefault(); dialog(tab.dataset.tab); } });
    l.addEventListener('auxclick', (e) => { const tab = e.target.closest('.term-tab'); if (tab && e.button === 1) { e.preventDefault(); schliessen(tab.dataset.tab); } });
    l.addEventListener('keydown', (e) => {
      const seitlich = st.layout === 'seite';
      const vor = seitlich ? 'ArrowDown' : 'ArrowRight', zurueck = seitlich ? 'ArrowUp' : 'ArrowLeft';
      if (![vor, zurueck].includes(e.key)) return;
      e.preventDefault();
      const i = st.tabs.findIndex((t) => t.id === st.aktiv), n = st.tabs.length;
      if (e.altKey && e.shiftKey) {             // Alt+Umschalt+Pfeil: aktiven Tab verschieben
        const t = st.tabs[i], gruppe = st.tabs.filter((x) => !!x.angeheftet === !!t.angeheftet);
        verschieben(t.id, gruppe.indexOf(t) + (e.key === vor ? 1 : -1)).then(() => l.querySelector('.term-tab.aktiv .term-tab-knopf')?.focus());
        return;
      }
      wechseln(st.tabs[(i + (e.key === vor ? 1 : -1) + n) % n].id);
      setTimeout(() => l.querySelector('.term-tab.aktiv .term-tab-knopf')?.focus(), 0);
    });
    // Ziehen und Ablegen (innerhalb der eigenen Gruppe: angeheftet bleibt vorne)
    l.addEventListener('dragstart', (e) => {
      const tab = e.target.closest('.term-tab'); if (!tab) return;
      st.zieht = tab.dataset.tab; tab.classList.add('zieht');
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', st.zieht);
    });
    l.addEventListener('dragend', () => { st.zieht = ''; l.querySelectorAll('.zieht, .ziel-vor, .ziel-nach').forEach((x) => x.classList.remove('zieht', 'ziel-vor', 'ziel-nach')); });
    const zielBestimmen = (e) => {
      const tab = e.target.closest('.term-tab');
      if (!tab || !st.zieht || tab.dataset.tab === st.zieht) return null;
      const quelle = st.tabs.find((x) => x.id === st.zieht), ziel = st.tabs.find((x) => x.id === tab.dataset.tab);
      if (!quelle || !ziel || !!quelle.angeheftet !== !!ziel.angeheftet) return null;
      const r = tab.getBoundingClientRect();
      const nach = st.layout === 'seite' ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
      return { tab, ziel, nach };
    };
    l.addEventListener('dragover', (e) => {
      const z = zielBestimmen(e);
      l.querySelectorAll('.ziel-vor, .ziel-nach').forEach((x) => x.classList.remove('ziel-vor', 'ziel-nach'));
      if (!z) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      z.tab.classList.add(z.nach ? 'ziel-nach' : 'ziel-vor');
    });
    l.addEventListener('drop', (e) => {
      const z = zielBestimmen(e); if (!z) return;
      e.preventDefault();
      const quelle = st.tabs.find((x) => x.id === st.zieht);
      const gruppe = st.tabs.filter((x) => !!x.angeheftet === !!quelle.angeheftet && x !== quelle);
      verschieben(quelle.id, gruppe.indexOf(z.ziel) + (z.nach ? 1 : 0));
    });
    $('term-tab-neu').addEventListener('click', neu);
    $('term-tab-layout').addEventListener('click', layoutWechseln);
    // Einstellungsfenster
    const d = $('term-tab-dialog');
    d.addEventListener('click', (e) => { if (e.target.closest('[data-schliessen]') || e.target === d) d.close(); });
    $('ttd-form').addEventListener('submit', (e) => { e.preventDefault(); dialogSpeichern(); });
    d.addEventListener('close', () => { if (typeof termFocus === 'function' && currentPage === 'terminal') termFocus(); });
    d.querySelectorAll('[data-schiebe]').forEach((b) => b.addEventListener('click', async () => {
      const t = st.tabs.find((x) => x.id === st.dialogId); if (!t) return;
      const gruppe = st.tabs.filter((x) => !!x.angeheftet === !!t.angeheftet), i = gruppe.indexOf(t), w = b.dataset.schiebe;
      await verschieben(t.id, w === 'anfang' ? 0 : w === 'ende' ? gruppe.length : i + Number(w));
      $('ttd-pos').textContent = positionText(st.tabs.find((x) => x.id === st.dialogId));
    }));
    $('ttd-schliessen-tab').addEventListener('click', async () => { if (await schliessen(st.dialogId)) d.close(); });
    // Alt+T neues Terminal, Alt+1…9 wechseln – nur auf der Terminal-Seite
    document.addEventListener('keydown', (e) => {
      if (typeof currentPage === 'undefined' || currentPage !== 'terminal' || !e.altKey || e.ctrlKey || e.metaKey || d.open) return;
      if (e.key === 't' || e.key === 'T') { e.preventDefault(); e.stopPropagation(); neu(); }
      else if (/^[1-9]$/.test(e.key) && st.tabs[+e.key - 1]) { e.preventDefault(); e.stopPropagation(); wechseln(st.tabs[+e.key - 1].id); }
    }, true);
  }

  window.termTabs = {
    aktiv: () => st.aktiv,
    laden,
    // Shell im Tab wurde mit `exit` beendet → Tab verschwindet, nächster wird aktiv
    beendet: async (id) => {
      st.tabs = st.tabs.filter((t) => t.id !== id);
      if (st.aktiv === id) st.aktiv = '';
      toast('Terminal beendet', 'info', 2500);
      await laden();
      neuVerbinden();
    },
  };
})();
