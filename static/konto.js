/* „Mein Konto“ (seit 3.1.0): Profilbild, Passwort ändern, E-Mail zur Wiederherstellung, andere Geräte abmelden.
 * Server: dashboard/konto.py (GET /api/konto, POST /api/konto/…). Profilbild auch in der Seitenleiste.
 *
 * Profilbild-Arten:  slxt    optionales Ebenen-Bild (funktionen.json „profilbild_ebenen“, Grafik unter icons/profil)
 *                    bild    eigenes Bild (/api/konto/bild?v=…), auf dem Server neu kodiert
 *                    initial erster Buchstabe auf Verlauf
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let profil = null;

  const ROLLE = { superadmin: 'Superadmin', admin: 'Admin', user: 'Benutzer' };

  // Avatar in ein Element zeichnen (auch für andere Skripte: window.kontoAvatar)
  function avatar(el, p, art) {
    if (!el || !p) return;
    art = art || p.bild_art;
    el.textContent = '';
    el.dataset.art = art;
    if (art === 'slxt') {
      for (const [k, src] of [['nacht', 'profil-bg-dunkel-192.webp'], ['tag', 'profil-bg-hell-192.webp'], ['gesicht', 'profil-gesicht-192.webp']]) {
        const i = document.createElement('img');
        i.className = 'av-ebene av-' + k; i.alt = ''; i.src = '/icons/profil/' + src; i.decoding = 'async';
        el.appendChild(i);
      }
    } else if (art === 'bild') {
      const i = document.createElement('img');
      i.className = 'av-ebene'; i.alt = ''; i.src = '/api/konto/bild?v=' + (p.bild_v || 0); i.decoding = 'async';
      i.onerror = () => { el.textContent = (p.benutzer || '?').slice(0, 1).toUpperCase(); el.dataset.art = 'initial'; };
      el.appendChild(i);
    } else if (art !== 'leer') {
      el.textContent = (p.benutzer || '?').slice(0, 1).toUpperCase();
    }
  }
  window.kontoAvatar = avatar;

  async function holen() {
    const p = await api('/api/konto');
    if (!p || p.error) return null;
    profil = p;
    avatar($('sb-avatar'), p);
    return p;
  }

  function zeigen() {
    const p = profil;
    if (!p) return;
    avatar($('ko-avatar-gross'), p);
    $('ko-name').textContent = p.benutzer;
    $('ko-rolle').textContent = ROLLE[window._userRole] || window._userRole || '';
    $('ko-pw-benutzer').value = p.benutzer;
    document.querySelectorAll('.ko-bildwahl [data-art]').forEach(b => {
      const art = b.dataset.art;
      b.setAttribute('aria-checked', String(p.bild_art === art));
      avatar(b.querySelector('.avatar'), p, art === 'bild' && !p.bild_vorhanden ? 'leer' : art);
    });
    $('ko-bild-weg').hidden = !p.bild_vorhanden;
    $('ko-pw-hinweis').textContent = p.cc_passwort
      ? 'Eigenes Command-Center-Passwort (steht in deinem Tresor) – unabhängig vom Linux-Passwort für SSH/sudo. Nach dem Ändern werden alle anderen Geräte abgemeldet.'
      : 'Das ist dein Linux-Passwort auf dem Server. Nach dem Ändern werden alle anderen Geräte abgemeldet.';
    $('ko-pw-datum').textContent = p.passwort_geaendert
      ? 'Zuletzt geändert ' + new Date(p.passwort_geaendert * 1000).toLocaleDateString('de-DE') : '';
    const st = $('ko-mail-status');
    st.className = 'pille ' + (p.email_bestaetigt ? 'gut' : 'neutral');
    st.textContent = p.email_bestaetigt ? 'bestätigt' : 'keine';
    $('ko-mail-aktuell').hidden = !p.email_bestaetigt;
    $('ko-mail-adresse').textContent = p.email || '';
    $('ko-mail-weg').hidden = !p.email_bestaetigt;
    if (!p.mail_bereit) {
      $('ko-mail-fehler').textContent = 'Mailversand ist auf dem Server noch nicht eingerichtet – Zurücksetzen per E-Mail geht erst danach.';
    }
    if (p.email_ausstehend) $('ko-mail-code').hidden = false;
  }

  window.kontoLaden = async function () { await holen(); zeigen(); };

  async function senden(url, daten, knopf) {
    if (knopf) knopf.disabled = true;
    try {
      return await api(url, { method: 'POST', body: JSON.stringify(daten || {}) });
    } finally { if (knopf) knopf.disabled = false; }
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(holen, 300);

    // Profilbild wählen
    document.querySelector('.ko-bildwahl').addEventListener('click', async e => {
      const b = e.target.closest('[data-art]');
      if (!b) return;
      if (b.dataset.art === 'bild' && profil && !profil.bild_vorhanden) { $('ko-datei').click(); return; }
      const r = await senden('/api/konto/bild/art', { art: b.dataset.art }, b);
      if (r.success) { await kontoLaden(); toast('Profilbild geändert', 'success'); }
      else toast(r.error || 'Ging nicht', 'error');
    });
    document.querySelector('.ko-bildwahl').addEventListener('keydown', e => {
      const knoepfe = [...document.querySelectorAll('.ko-bildwahl [data-art]')];
      const i = knoepfe.indexOf(document.activeElement);
      if (i < 0 || !['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();
      knoepfe[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : knoepfe.length - 1)) % knoepfe.length].focus();
    });
    $('ko-datei-knopf').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('ko-datei').click(); } });
    $('ko-datei').addEventListener('change', async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { toast('Bild ist größer als 5 MB', 'error'); return; }
      // im Browser schon quadratisch verkleinern (spart Upload), der Server kodiert trotzdem neu
      let daten = f;
      try {
        const bmp = await createImageBitmap(f);
        const s = Math.min(bmp.width, bmp.height), c = document.createElement('canvas');
        c.width = c.height = Math.min(512, s);
        c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, c.width, c.height);
        daten = await new Promise(r => c.toBlob(r, 'image/png'));
      } catch (_) {}
      const r = await fetch('/api/konto/bild', { method: 'POST', body: daten, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream' } }).then(x => x.json()).catch(() => ({ error: 'Upload fehlgeschlagen' }));
      if (r.success) { await kontoLaden(); toast('Profilbild gespeichert', 'success'); }
      else toast(r.error || 'Upload fehlgeschlagen', 'error');
    });
    $('ko-bild-weg').addEventListener('click', async () => {
      if (!await uiConfirm('Eigenes Profilbild löschen?', { okLabel: 'Löschen', danger: true })) return;
      const r = await senden('/api/konto/bild/loeschen', {});
      if (r.success) { await kontoLaden(); toast('Bild entfernt', 'success'); }
    });
    $('ko-github').addEventListener('submit', async e => {
      e.preventDefault();
      const r = await senden('/api/konto/bild/github', { name: $('ko-github-name').value }, e.submitter);
      if (r.success) { $('ko-github-name').value = ''; await kontoLaden(); toast('Bild von GitHub übernommen', 'success'); }
      else toast(r.error || 'Ging nicht', 'error');
    });

    // Passwort ändern
    const ui = PasswortUI.binden({ neu: $('ko-pw-neu'), wdh: $('ko-pw-wdh'), liste: $('ko-pw-regeln'), staerke: $('ko-pw-staerke'),
      benutzer: () => (profil && profil.benutzer) || window._userName || '',
      aenderung: ok => { $('ko-pw-knopf').disabled = !ok || !$('ko-pw-alt').value; } });
    $('ko-pw-alt').addEventListener('input', () => ui.ok());
    $('ko-pw-zeigen').addEventListener('change', e => {
      for (const id of ['ko-pw-alt', 'ko-pw-neu', 'ko-pw-wdh']) $(id).type = e.target.checked ? 'text' : 'password';
    });
    $('ko-pw').addEventListener('submit', async e => {
      e.preventDefault();
      if (!ui.ok()) return;
      $('ko-pw-fehler').textContent = '';
      const r = await senden('/api/konto/passwort', { aktuell: $('ko-pw-alt').value, neu: $('ko-pw-neu').value }, $('ko-pw-knopf'));
      if (r.success) {
        for (const id of ['ko-pw-alt', 'ko-pw-neu', 'ko-pw-wdh']) $(id).value = '';
        ui.ok(); await kontoLaden();
        toast('Passwort geändert – andere Geräte sind abgemeldet', 'success', 6000);
      } else {
        $('ko-pw-fehler').textContent = r.error || 'Ging nicht';
        if (r.feld === 'aktuell') $('ko-pw-alt').focus(); else if (r.feld === 'neu') $('ko-pw-neu').focus();
      }
      $('ko-pw-knopf').disabled = !ui.ok() || !$('ko-pw-alt').value;
    });

    // E-Mail
    $('ko-mail').addEventListener('submit', async e => {
      e.preventDefault();
      $('ko-mail-fehler').textContent = '';
      const r = await senden('/api/konto/email', { email: $('ko-mail-neu').value }, e.submitter);
      if (r.success) { $('ko-mail-code').hidden = false; $('ko-mail-code-ein').focus(); toast(`Code an ${r.an} gesendet`, 'success'); }
      else $('ko-mail-fehler').textContent = r.error || 'Ging nicht';
    });
    $('ko-mail-code').addEventListener('submit', async e => {
      e.preventDefault();
      const r = await senden('/api/konto/email/bestaetigen', { code: $('ko-mail-code-ein').value }, e.submitter);
      if (r.success) {
        $('ko-mail-code').hidden = true; $('ko-mail-code-ein').value = ''; $('ko-mail-neu').value = '';
        await kontoLaden(); toast('E-Mail bestätigt', 'success');
      } else $('ko-mail-fehler').textContent = r.error || 'Ging nicht';
    });
    $('ko-mail-weg').addEventListener('click', async () => {
      if (!await uiConfirm('E-Mail entfernen? Dann geht „Passwort vergessen?“ nicht mehr.', { okLabel: 'Entfernen', danger: true })) return;
      const r = await senden('/api/konto/email/entfernen', {});
      if (r.success) { await kontoLaden(); toast('E-Mail entfernt', 'success'); }
    });

    $('ko-andere-ab').addEventListener('click', async e => {
      const r = await senden('/api/konto/abmelden-andere', {}, e.currentTarget);
      if (r.success) toast('Alle anderen Geräte sind abgemeldet', 'success');
    });
  });
})();
