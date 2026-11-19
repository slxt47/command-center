// Benutzer & Gruppen (seit 3.8.0, 19.11.2026) – Seite „Benutzer“.
// Daten: GET /api/users, GET /api/gruppen. Aktionen: /api/user/create|gruppen|passwort|delete, /api/gruppe/speichern|loeschen.
// Rechte prüft der Server (dashboard/rechte.py); hier wird nur ein- und ausgeblendet.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { ansicht: 'benutzer', users: [], g: null, verdrahtet: false, bearbeite: null, gruppe: null };
  try { const a = localStorage.getItem('cc-bg-ansicht'); if (['benutzer', 'gruppen', 'matrix'].includes(a)) st.ansicht = a; } catch { /* privat */ }

  const istSuper = () => typeof isSuperadmin === 'function' && isSuperadmin();
  const darf = (r) => typeof hatRecht === 'function' ? hatRecht(r) : istSuper();
  const KRIT = '<span class="bg-krit" title="Kritisch: entspricht praktisch Root-Zugriff bzw. Zugang zu Geheimnissen">⚠</span>';

  function rechteVon(u) {
    if (u.superadmin) return new Set(st.g.katalog.map((r) => r.schluessel));
    const r = new Set(st.g.gruppen.alle ? st.g.gruppen.alle.rechte : []);
    for (const g of u.gruppen || []) for (const x of (st.g.gruppen[g] || {}).rechte || []) r.add(x);
    return r;
  }
  const rechtInfo = (k) => st.g.katalog.find((r) => r.schluessel === k) || { name: k, kritisch: false };
  const gruppenName = (id) => (st.g.gruppen[id] || {}).name || id;
  const mitgliederVon = (gid) => st.users.filter((u) => (u.gruppen || []).includes(gid)).map((u) => u.username);

  // ---------------------------------------------------------------- Laden
  async function laden() {
    verdrahten();
    const [u, g] = await Promise.all([api('/api/users'), api('/api/gruppen')]);
    if (u.error || g.error) { $('bg-inhalt').innerHTML = `<p class="bg-fehler">${esc(u.error || g.error)}</p>`; return; }
    st.users = u.users || []; st.g = g;
    const ich = st.users.find((x) => x.username === u.ich) || {};
    $('bg-ich').innerHTML = `<span class="status-dot"></span>Du: <b>${esc(u.ich)}</b>${ich.inhaber ? ' · Inhaber' : ich.superadmin ? ' · Superadmin' : ''}`;
    $('bg-neu-gruppe').hidden = !(g.darf_gruppen_bearbeiten && st.ansicht === 'gruppen');
    $('bg-neu-benutzer').hidden = !darf('benutzer.verwalten') || st.ansicht !== 'benutzer';
    zeichnen();
  }
  window.loadUsers = laden;

  function verdrahten() {
    if (st.verdrahtet) return;
    st.verdrahtet = true;
    document.querySelectorAll('[data-bg-ansicht]').forEach((b) => b.addEventListener('click', () => {
      st.ansicht = b.dataset.bgAnsicht;
      try { localStorage.setItem('cc-bg-ansicht', st.ansicht); } catch { /* privat */ }
      knoepfe(); laden();
    }));
    knoepfe();
    $('bg-neu-benutzer').addEventListener('click', () => benutzerDialog(null));
    $('bg-neu-gruppe').addEventListener('click', () => gruppenDialog(null));
    $('bg-inhalt').addEventListener('click', (e) => {
      const k = e.target.closest('[data-aktion]');
      if (!k) return;
      const { aktion, wer } = k.dataset;
      if (aktion === 'bearbeiten') benutzerDialog(wer);
      else if (aktion === 'loeschen') loeschen(wer);
      else if (aktion === 'gruppe') gruppenDialog(wer);
    });
    for (const d of ['bg-dialog-benutzer', 'bg-dialog-gruppe']) {
      $(d).addEventListener('click', (e) => { if (e.target.closest('[data-schliessen]') || e.target === $(d)) $(d).close(); });
    }
    $('bg-form-benutzer').addEventListener('submit', (e) => { e.preventDefault(); benutzerSpeichern(); });
    $('bg-form-gruppe').addEventListener('submit', (e) => { e.preventDefault(); gruppeSpeichern(); });
    $('bg-gruppen-liste').addEventListener('change', ergebnis);
    $('bg-pw-knopf').addEventListener('click', passwortSetzen);
    $('bg-dg-loeschen').addEventListener('click', gruppeLoeschen);
  }
  function knoepfe() {
    document.querySelectorAll('[data-bg-ansicht]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.bgAnsicht === st.ansicht)));
  }

  // ---------------------------------------------------------------- Ansichten
  function zeichnen() {
    const bauen = () => (st.ansicht === 'gruppen' ? gruppenZeichnen() : st.ansicht === 'matrix' ? matrixZeichnen() : benutzerZeichnen());
    const box = $('bg-inhalt'), neuAnsicht = box.dataset.ansicht !== st.ansicht;
    box.dataset.ansicht = st.ansicht;
    if (!window.Bewegung) return bauen();
    if (neuAnsicht) { bauen(); Bewegung.staffeln(box.querySelectorAll('.bg-karte, :scope > .card, :scope > details')); }
    else Bewegung.flip(box, '.bg-karte', 'data-k', bauen);    // 3.10.0: Änderungen gleiten statt springen
  }

  function benutzerZeichnen() {
    const n = st.g.katalog.length;
    const dienst = st.users.filter((u) => u.dienstkonto);
    $('bg-inhalt').innerHTML = '<div class="raster raster-3 bg-karten">' + st.users.filter((u) => !u.dienstkonto).map((u) => {
      const r = rechteVon(u), krit = [...r].filter((x) => rechtInfo(x).kritisch).length;
      const marken = [u.inhaber ? '<span class="bg-marke bg-inhaber">Inhaber</span>' : '', u.superadmin ? '<span class="bg-marke bg-super">Superadmin</span>' : '',
        u.locked ? '<span class="bg-marke bg-gesperrt">gesperrt</span>' : '', u.cc_passwort ? '<span class="bg-marke">eigenes CC-Passwort</span>' : '',
        u.shell && !u.shell.endsWith('nologin') && !u.system ? '<span class="bg-marke" title="Kann sich per SSH anmelden">SSH</span>' : ''].join('');
      const gruppen = u.superadmin ? '<span class="bg-leise">alle Rechte</span>'
        : (u.gruppen || []).length ? u.gruppen.map((g) => `<span class="bg-chip">${esc(gruppenName(g))}</span>`).join('') : '<span class="bg-leise">nur Grundrechte</span>';
      const ich = u.username === window._userName;
      const gruppenOk = !u.superadmin && darf('benutzer.verwalten') && !ich;
      const knoepfe = [
        gruppenOk || (window._inhaber && !u.system) ? `<button class="btn btn-sm" data-aktion="bearbeiten" data-wer="${esc(u.username)}">${gruppenOk && window._inhaber ? 'Gruppen & Passwort' : gruppenOk ? 'Gruppen' : 'Passwort'}</button>` : '',
        !u.system && !ich && !u.inhaber && darf('benutzer.verwalten') && (!u.superadmin || istSuper()) ? `<button class="btn btn-sm btn-danger" data-aktion="loeschen" data-wer="${esc(u.username)}">Löschen</button>` : '',
      ].join('');
      return `<section class="card bg-karte" data-k="u-${esc(u.username)}">
        <div class="bg-kopf"><span class="bg-avatar" aria-hidden="true">${esc((u.username[0] || '?').toUpperCase())}</span>
          <div class="bg-name"><b>${esc(u.username)}</b>${ich ? ' <span class="bg-leise">(du)</span>' : ''}<div class="bg-marken">${marken}</div></div></div>
        <div class="bg-gruppen">${gruppen}</div>
        <div class="bg-zahl"><b>${r.size}</b> von ${n} Rechten${krit ? ` · <span class="bg-krit-text">${krit} kritisch</span>` : ''}</div>
        <div class="bg-aktionen">${knoepfe}</div></section>`;
    }).join('') + '</div>' +
      (dienst.length ? `<details class="card bg-dienst"><summary>${dienst.length} Dienstkonten (geschützt)</summary><p class="bg-leise">Technische Konten von Programmen – keine Anmeldung möglich, nicht löschbar: ${dienst.map((u) => `<code>${esc(u.username)}</code>`).join(', ')}.</p></details>` : '');
  }

  function gruppenZeichnen() {
    const g = st.g, kann = g.darf_gruppen_bearbeiten;
    const ids = Object.keys(g.gruppen).sort((a, b) => (a === 'alle' ? -1 : b === 'alle' ? 1 : gruppenName(a).localeCompare(gruppenName(b), 'de')));
    $('bg-inhalt').innerHTML = '<div class="raster raster-3 bg-karten">' + ids.map((id) => {
      const gr = g.gruppen[id], m = id === 'alle' ? ['jeder Angemeldete'] : mitgliederVon(id);
      const rechte = (gr.rechte || []).map((k) => { const i = rechtInfo(k); return `<span class="bg-chip${i.kritisch ? ' bg-chip-krit' : ''}">${i.kritisch ? '⚠ ' : ''}${esc(i.name)}</span>`; }).join('');
      return `<section class="card bg-karte" data-k="g-${esc(id)}">
        <div class="bg-kopf"><span class="bg-avatar bg-avatar-gruppe" aria-hidden="true">${esc((gr.name[0] || '?').toUpperCase())}</span>
          <div class="bg-name"><b>${esc(gr.name)}</b><div class="bg-leise">${esc(gr.beschreibung || '')}</div></div></div>
        <div class="bg-gruppen">${rechte || '<span class="bg-leise">keine Rechte</span>'}</div>
        <div class="bg-zahl">${id === 'alle' ? 'Gilt für jeden' : `${m.length} Mitglied${m.length === 1 ? '' : 'er'}${m.length ? ': ' + esc(m.join(', ')) : ''}`}</div>
        <div class="bg-aktionen">${kann ? `<button class="btn btn-sm" data-aktion="gruppe" data-wer="${esc(id)}">Bearbeiten</button>` : ''}</div></section>`;
    }).join('') + '</div>';
  }

  function matrixZeichnen() {
    const leute = st.users.filter((u) => !u.dienstkonto);
    const bereiche = [...new Set(st.g.katalog.map((r) => r.bereich))];
    const rv = new Map(leute.map((u) => [u.username, rechteVon(u)]));
    $('bg-inhalt').innerHTML = `<section class="card"><div class="card-header"><h2 class="card-title">Wer darf was?</h2><span class="card-zusatz">✓ = Recht vorhanden · ⚠ = kritisch</span></div>
      <div class="ag-scroll bg-matrix-scroll" tabindex="0" role="region" aria-label="Rechte-Übersicht"><table class="process-table ag-tabelle bg-matrix">
      <thead><tr><th>Recht</th>${leute.map((u) => `<th class="bg-m-kopf">${esc(u.username)}</th>`).join('')}</tr></thead><tbody>` +
      bereiche.map((b) => `<tr class="bg-m-bereich"><th colspan="${leute.length + 1}">${esc(b)}</th></tr>` +
        st.g.katalog.filter((r) => r.bereich === b).map((r) => `<tr><td title="${esc(r.text)}">${r.kritisch ? KRIT + ' ' : ''}${esc(r.name)}</td>` +
          leute.map((u) => rv.get(u.username).has(r.schluessel) ? '<td class="bg-m-ja" aria-label="ja">✓</td>' : '<td class="bg-m-nein" aria-label="nein">–</td>').join('') + '</tr>').join('')).join('') +
      '</tbody></table></div></section>';
  }

  // ---------------------------------------------------------------- Benutzer-Dialog
  function benutzerDialog(name) {
    const u = name ? st.users.find((x) => x.username === name) : null;
    st.bearbeite = u;
    const f = $('bg-form-benutzer'), neu = !u;
    $('bg-db-titel').textContent = neu ? 'Benutzer anlegen' : `${u.username} bearbeiten`;
    f.querySelector('.bg-neu-felder').hidden = !neu;
    $('bg-shell-feld').hidden = !istSuper();
    f.username.value = ''; f.password.value = ''; f.shell.value = '/usr/sbin/nologin';
    const zeigeGruppen = neu || (!u.superadmin && darf('benutzer.verwalten') && u.username !== window._userName);
    f.querySelector('.bg-gruppenwahl').hidden = !zeigeGruppen;
    $('bg-ergebnis').hidden = !zeigeGruppen;
    $('bg-db-ok').hidden = !zeigeGruppen;
    $('bg-db-ok').textContent = neu ? 'Anlegen' : 'Gruppen speichern';
    $('bg-pw-bereich').hidden = neu || !window._inhaber;
    $('bg-pw-neu').value = '';
    $('bg-db-fehler').hidden = true;
    const meine = new Set(st.g.meine_rechte), aktiv = new Set(u ? u.gruppen : []);
    $('bg-gruppen-liste').innerHTML = Object.entries(st.g.gruppen).filter(([id]) => id !== 'alle')
      .sort((a, b) => a[1].name.localeCompare(b[1].name, 'de')).map(([id, g]) => {
        const fremd = (g.rechte || []).filter((r) => !meine.has(r));
        const krit = (g.rechte || []).some((r) => rechtInfo(r).kritisch);
        return `<label class="bg-wahl${fremd.length ? ' bg-wahl-aus' : ''}"><input type="checkbox" value="${esc(id)}"${aktiv.has(id) ? ' checked' : ''}${fremd.length ? ' disabled' : ''}>
          <span><b>${esc(g.name)}${krit ? ' ' + KRIT : ''}</b><small>${esc(g.beschreibung || '')}${fremd.length ? ' – enthält Rechte, die du nicht hast' : ''}</small></span></label>`;
      }).join('');
    ergebnis();
    $('bg-dialog-benutzer').showModal();
    (neu ? f.username : (zeigeGruppen ? f.querySelector('.bg-wahl input:not([disabled])') : $('bg-pw-neu')))?.focus();
  }

  function ergebnis() {
    const gew = [...$('bg-gruppen-liste').querySelectorAll('input:checked')].map((i) => i.value);
    const r = rechteVon({ gruppen: gew });
    const krit = [...r].filter((x) => rechtInfo(x).kritisch);
    $('bg-ergebnis').innerHTML = `<b>Ergebnis: ${r.size} Rechte</b> – ${[...r].map((x) => esc(rechtInfo(x).name)).join(', ') || 'keine'}` +
      (krit.length ? `<div class="bg-warn">⚠ Kritisch: ${krit.map((x) => esc(rechtInfo(x).name)).join(', ')} – damit kann man den Server praktisch übernehmen oder Geheimnisse sehen.</div>` : '');
  }

  function fehler(id, text) { const e = $(id); e.textContent = text; e.hidden = !text; }

  async function benutzerSpeichern() {
    const f = $('bg-form-benutzer'), u = st.bearbeite;
    const gruppen = [...$('bg-gruppen-liste').querySelectorAll('input:checked')].map((i) => i.value);
    let r;
    if (!u) {
      const name = f.username.value.trim();
      if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(name)) return fehler('bg-db-fehler', 'Benutzername: nur Kleinbuchstaben, Ziffern, _ und -, max. 32 Zeichen.');
      r = await api('/api/user/create', { method: 'POST', body: JSON.stringify({ username: name, password: f.password.value, gruppen, shell: f.shell.value }) });
    } else {
      r = await api('/api/user/gruppen', { method: 'POST', body: JSON.stringify({ username: u.username, gruppen }) });
    }
    if (r.error) return fehler('bg-db-fehler', r.error);
    toast(u ? 'Gruppen gespeichert – gilt sofort' : 'Benutzer angelegt', 'success');
    $('bg-dialog-benutzer').close(); laden();
  }

  async function passwortSetzen() {
    const u = st.bearbeite, pw = $('bg-pw-neu').value;
    if (!u || !pw) return;
    const ok = await uiConfirm(`Passwort von ${u.username} jetzt ändern?\n\n${u.username === window._userName ? 'Das ist dein eigenes Konto.' : 'Alle offenen Sitzungen von ' + u.username + ' werden beendet.'}`, { okLabel: 'Passwort setzen' });
    if (!ok) return;
    const r = await api('/api/user/passwort', { method: 'POST', body: JSON.stringify({ username: u.username, password: pw }) });
    if (r.error) return fehler('bg-db-fehler', r.error + (r.regeln ? ` (${r.regeln.join(', ')})` : ''));
    $('bg-pw-neu').value = '';
    toast(`Passwort von ${u.username} gesetzt`, 'success');
  }

  async function loeschen(name) {
    if (!(await uiConfirm(`Benutzer „${name}“ wirklich löschen?\n\nDas Home-Verzeichnis wird mit entfernt, offene Sitzungen enden sofort.`, { danger: true, okLabel: 'Löschen' }))) return;
    const r = await api('/api/user/delete', { method: 'POST', body: JSON.stringify({ username: name, remove_home: true }) });
    if (r.error) { toast('Fehler: ' + r.error, 'error', 7000); return; }
    toast('Benutzer gelöscht', 'success'); laden();
  }

  // ---------------------------------------------------------------- Gruppen-Dialog
  function gruppenDialog(id) {
    const g = id ? st.g.gruppen[id] : null;
    st.gruppe = id;
    const f = $('bg-form-gruppe');
    $('bg-dg-titel').textContent = g ? `Gruppe „${g.name}“` : 'Neue Gruppe';
    f.name.value = g ? g.name : ''; f.beschreibung.value = g ? g.beschreibung || '' : '';
    $('bg-dg-loeschen').hidden = !id || id === 'alle';
    fehler('bg-dg-fehler', '');
    const hat = new Set(g ? g.rechte : []);
    const bereiche = [...new Set(st.g.katalog.map((r) => r.bereich))];
    $('bg-rechte-liste').innerHTML = bereiche.map((b) => `<fieldset><legend>${esc(b)}</legend>` +
      st.g.katalog.filter((r) => r.bereich === b).map((r) => `<label class="bg-wahl${r.kritisch ? ' bg-wahl-krit' : ''}">
        <input type="checkbox" value="${esc(r.schluessel)}"${hat.has(r.schluessel) ? ' checked' : ''}>
        <span><b>${esc(r.name)}${r.kritisch ? ' ' + KRIT : ''}</b><small>${esc(r.text)}</small></span></label>`).join('') + '</fieldset>').join('');
    $('bg-dialog-gruppe').showModal();
    f.name.focus();
  }

  async function gruppeSpeichern() {
    const f = $('bg-form-gruppe');
    const rechte = [...$('bg-rechte-liste').querySelectorAll('input:checked')].map((i) => i.value);
    const r = await api('/api/gruppe/speichern', { method: 'POST', body: JSON.stringify({ id: st.gruppe || '', name: f.name.value, beschreibung: f.beschreibung.value, rechte }) });
    if (r.error) return fehler('bg-dg-fehler', r.error);
    toast('Gruppe gespeichert – gilt sofort für alle Mitglieder', 'success');
    $('bg-dialog-gruppe').close(); laden();
  }

  async function gruppeLoeschen() {
    const id = st.gruppe, g = st.g.gruppen[id];
    if (!id || !(await uiConfirm(`Gruppe „${g.name}“ löschen?\n\n${mitgliederVon(id).length} Mitglied(er) verlieren die Rechte dieser Gruppe sofort.`, { danger: true, okLabel: 'Löschen' }))) return;
    const r = await api('/api/gruppe/loeschen', { method: 'POST', body: JSON.stringify({ id }) });
    if (r.error) return fehler('bg-dg-fehler', r.error);
    toast('Gruppe gelöscht', 'success'); $('bg-dialog-gruppe').close(); laden();
  }
})();
