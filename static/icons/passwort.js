/* Passwort-Regeln + Stärke-Anzeige (seit 3.1.0) – gleiche Regeln wie dashboard/konto.py (der Server entscheidet).
 * Genutzt auf der Anmeldeseite (Passwort vergessen) und in „Mein Konto“.
 *
 *   PasswortUI.binden({ neu, wdh, liste, staerke, benutzer: () => 'name', aenderung: ok => … })
 *     neu/wdh: <input>, liste: <ul> für die Regeln, staerke: Element für Balken + Text
 *     liefert { ok() } – true, wenn alle Regeln erfüllt und beide Eingaben gleich sind
 */
(function () {
  'use strict';
  const HAEUFIG = ['passwort', 'password', 'qwertz', 'qwerty', '123456', 'iloveyou', 'letmein', 'welcome', 'willkommen',
    'admin', 'administrator', 'root', 'changeme', 'sommer', 'winter', 'hallo', 'schatz', 'geheim', 'dragon', 'monkey',
    'football', 'fussball', 'master', 'superman', 'batman', 'trustno', 'server', 'linux', 'ubuntu', 'debian', 'dashboard',
    'commandcenter', 'slxt'];
  const FOLGEN = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertzuiopasdfghjklyxcvbnm', 'qwertyuiopasdfghjklzxcvbnm'];

  function pruefen(pw, benutzer) {
    pw = pw || '';
    const k = pw.toLowerCase();
    const arten = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length;
    const lang = pw.length >= 20;
    let folge = false;
    for (const f of FOLGEN) for (let i = 0; i + 4 <= f.length; i++) {
      const s = f.slice(i, i + 4);
      if (k.includes(s) || k.includes([...s].reverse().join(''))) folge = true;
    }
    const kern = k.replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/[5$]/g, 's')
      .replace(/@/g, 'a').replace(/[^a-z]/g, '');
    const regeln = [
      { id: 'laenge', text: 'Mindestens 12 Zeichen', ok: pw.length >= 12 && pw.length <= 128 },
      lang ? { id: 'arten', text: 'Passphrase: drei Arten von Zeichen', ok: arten >= 3 }
           : { id: 'gross_klein', text: 'Groß- und Kleinbuchstaben', ok: /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
      ...(lang ? [] : [{ id: 'ziffer', text: 'Mindestens eine Ziffer', ok: /[0-9]/.test(pw) },
                       { id: 'sonder', text: 'Mindestens ein Sonderzeichen', ok: /[^A-Za-z0-9]/.test(pw) }]),
      { id: 'muster', text: 'Kein Benutzername, keine Folgen (1234) oder Wiederholungen (aaa)',
        ok: !!pw && !(benutzer && benutzer.length >= 3 && k.includes(benutzer.toLowerCase())) && !/(.)\1\1/.test(pw) && !folge },
      { id: 'haeufig', text: 'Kein bekanntes oder häufiges Passwort',
        ok: !!pw && !HAEUFIG.some(w => kern === w || (w.length >= 6 && kern.includes(w) && kern.length - w.length < 4)) },
      { id: 'rand', text: 'Keine Leerzeichen am Anfang oder Ende', ok: pw === pw.trim() },
    ];
    return regeln;
  }

  // Grobe Stärke aus Länge × Zeichenvorrat, mit Abzug für Muster: 0…4
  function staerke(pw, regeln) {
    if (!pw) return 0;
    let vorrat = 0;
    if (/[a-z]/.test(pw)) vorrat += 26;
    if (/[A-Z]/.test(pw)) vorrat += 26;
    if (/[0-9]/.test(pw)) vorrat += 10;
    if (/[^A-Za-z0-9]/.test(pw)) vorrat += 33;
    let bits = pw.length * Math.log2(Math.max(vorrat, 2));
    if (regeln.some(r => !r.ok && (r.id === 'muster' || r.id === 'haeufig'))) bits *= 0.5;
    if (!regeln.every(r => r.ok)) return bits >= 50 ? 2 : bits >= 28 ? 1 : 0;
    return bits >= 100 ? 4 : bits >= 75 ? 3 : 2;
  }
  const STUFEN = ['Sehr schwach', 'Schwach', 'Mittel', 'Stark', 'Sehr stark'];

  function binden(o) {
    const zeichnen = () => {
      const pw = o.neu.value, regeln = pruefen(pw, o.benutzer ? o.benutzer() : '');
      if (o.liste) {
        o.liste.innerHTML = '';
        for (const r of regeln) {
          const li = document.createElement('li');
          li.className = 'pw-regel' + (pw ? (r.ok ? ' ok' : ' nein') : '');
          li.textContent = r.text;
          const sr = document.createElement('span');
          sr.className = 'sr-only';
          sr.textContent = pw ? (r.ok ? ' – erfüllt' : ' – fehlt') : '';
          li.appendChild(sr);
          o.liste.appendChild(li);
        }
        if (o.wdh) {
          const li = document.createElement('li');
          const gleich = !!pw && o.wdh.value === pw;
          li.className = 'pw-regel' + (o.wdh.value ? (gleich ? ' ok' : ' nein') : '');
          li.textContent = 'Beide Eingaben gleich';
          o.liste.appendChild(li);
        }
      }
      const s = staerke(pw, regeln);
      if (o.staerke) {
        o.staerke.dataset.stufe = pw ? s : '';
        o.staerke.querySelector('.pw-text').textContent = pw ? `Stärke: ${STUFEN[s]}` : 'Stärke: –';
      }
      const ok = regeln.every(r => r.ok) && (!o.wdh || o.wdh.value === pw);
      if (o.aenderung) o.aenderung(ok);
      return ok;
    };
    o.neu.addEventListener('input', zeichnen);
    if (o.wdh) o.wdh.addEventListener('input', zeichnen);
    zeichnen();
    return { ok: zeichnen };
  }

  window.PasswortUI = { pruefen, staerke, binden };
})();
