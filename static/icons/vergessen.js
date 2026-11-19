/* Anmeldeseite: „Passwort vergessen?“ (seit 3.1.0). Schritt 1 Benutzername → Code per Mail, Schritt 2 Code + neues
 * Passwort. Server: POST /api/konto/reset/anfordern | /setzen (dashboard/konto.py). Antworten verraten nie, ob es
 * das Konto gibt. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  document.addEventListener('DOMContentLoaded', () => {
    const anmelden = document.querySelector('form[action="/login"]');
    const knopf = $('vergessen-knopf'), bereich = $('vergessen');
    if (!anmelden || !knopf || !bereich) return;
    const notiz = document.querySelector('.note'), fehlerAlt = document.querySelector('.box > .error');
    const meldung = (text, art) => {
      const m = $('vg-meldung'); m.textContent = '';
      if (!text) return;
      const d = document.createElement('div'); d.className = art === 'ok' ? 'erfolg' : 'error'; d.textContent = text; m.appendChild(d);
    };
    const zeigen = an => {
      anmelden.hidden = an; knopf.hidden = an; if (notiz) notiz.hidden = an; if (fehlerAlt) fehlerAlt.hidden = an;
      bereich.hidden = !an;
      if (an) { $('vg-u').value = $('u').value; $('vg-titel').focus(); }
      else { $('p').value = ''; ($('u').value ? $('p') : $('u')).focus(); }
    };
    knopf.addEventListener('click', () => zeigen(true));
    $('vg-zurueck').addEventListener('click', () => {
      zeigen(false); meldung(''); $('vg-schritt1').hidden = false; $('vg-schritt2').hidden = true;
    });
    const post = async (url, daten) => {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(daten),
        credentials: 'same-origin' });
      let j = {}; try { j = await r.json(); } catch (_) {}
      return { ok: r.ok, j };
    };
    const ui = window.PasswortUI.binden({ neu: $('vg-neu'), wdh: $('vg-wdh'), liste: $('vg-regeln'), staerke: $('vg-staerke'),
      benutzer: () => $('vg-u').value.trim(), aenderung: ok => { $('vg-setzen').disabled = !ok; } });
    $('vg-code').addEventListener('input', e => {
      const z = e.target.value.replace(/\D/g, '').slice(0, 8);
      e.target.value = z.length > 4 ? z.slice(0, 4) + ' ' + z.slice(4) : z;
    });
    $('vg-schritt1').addEventListener('submit', async e => {
      e.preventDefault();
      const b = e.submitter || e.target.querySelector('button'); b.disabled = true;
      try {
        const { ok, j } = await post('/api/konto/reset/anfordern', { benutzer: $('vg-u').value.trim() });
        if (!ok) { meldung(j.error || 'Das hat nicht geklappt.', 'fehler'); return; }
        meldung(j.hinweis, 'ok');
        $('vg-schritt1').hidden = true; $('vg-schritt2').hidden = false; $('vg-code').focus();
      } catch (_) { meldung('Server nicht erreichbar.', 'fehler'); }
      finally { b.disabled = false; }
    });
    $('vg-schritt2').addEventListener('submit', async e => {
      e.preventDefault();
      if (!ui.ok()) return;
      const b = $('vg-setzen'); b.disabled = true;
      try {
        const { ok, j } = await post('/api/konto/reset/setzen',
          { benutzer: $('vg-u').value.trim(), code: $('vg-code').value, passwort: $('vg-neu').value });
        if (!ok) { meldung(j.error || 'Das hat nicht geklappt.', 'fehler'); if (j.feld) $('vg-' + (j.feld === 'neu' ? 'neu' : 'code')).focus(); return; }
        $('u').value = $('vg-u').value.trim();
        $('vg-neu').value = $('vg-wdh').value = $('vg-code').value = '';
        $('vg-schritt1').hidden = false; $('vg-schritt2').hidden = true;
        zeigen(false);
        const d = document.createElement('div'); d.className = 'erfolg'; d.setAttribute('role', 'status');
        d.textContent = 'Passwort geändert. Melde dich jetzt mit dem neuen Passwort an.';
        anmelden.before(d);
      } catch (_) { meldung('Server nicht erreichbar.', 'fehler'); }
      finally { b.disabled = !ui.ok(); }
    });
  });
})();
