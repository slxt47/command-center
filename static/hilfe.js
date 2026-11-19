// Hilfe (seit 3.13.0): eigene Seite „Hilfe“ – Abschnitte je Bereich, Suche, Sprungmarken, Taste „?“ öffnet die Hilfe
// zur gerade offenen Seite. Inhalt steht hier (kein Server nötig); Seiten-IDs wie in index.html.
(function () {
  'use strict';
  const K = (t) => `<kbd>${t}</kbd>`;
  // [id, Titel, Seiten, die hierher führen, HTML]
  const ABSCHNITTE = [
    ['start', 'Erste Schritte', ['dashboard'], `
      <p>Das <b>Command Center</b> verwaltet deinen Linux-Server im Browser: Auslastung, Docker, virtuelle Maschinen, Terminal,
      Benutzer und Sicherheit – an einem Ort, hell und dunkel, am Handy wie am PC.</p>
      <ul>
        <li><b>Anmelden</b> mit einem Linux-Benutzer des Servers (oder einem eigenen Command-Center-Passwort, siehe „Mein Konto“).</li>
        <li><b>Navigation:</b> Seitenleiste links (am Handy unten), ${K('⌘/Strg')} + ${K('K')} öffnet „Springen zu …“ für Seiten, Container und Dienste.</li>
        <li><b>Was du siehst, hängt von deinen Rechten ab.</b> Superadmins sehen alles, alle anderen nur die Seiten ihrer Gruppen.</li>
        <li><b>Hilfe zur aktuellen Seite:</b> Taste ${K('?')}.</li>
      </ul>`],
    ['uebersicht', 'Übersicht', ['dashboard'], `
      <p>Kennzahlen (CPU, Arbeitsspeicher, Netzwerk, Datenträger) mit Mini-Verlauf und darunter Graphen der letzten 15 Minuten bis 24 Stunden.</p>
      <ul><li>Graphen: Zeigen zeigt Werte, Ziehen zoomt, Legende blendet Reihen aus, „Tabelle“ zeigt die Zahlen.</li>
      <li>Kachel antippen springt zum passenden Graphen.</li></ul>`],
    ['system', 'Prozesse, Dienste, Updates', ['processes', 'services', 'updates'], `
      <ul><li><b>Prozesse:</b> sortierbar, Prozess beenden (Recht „Prozesse beenden“).</li>
      <li><b>Dienste:</b> systemd-Dienste suchen, starten, stoppen, neu starten.</li>
      <li><b>Updates:</b> offene Paket-Updates, auf Wunsch einspielen.</li></ul>`],
    ['terminal', 'Terminal & Tabs', ['terminal'], `
      <p>Echte Shell auf dem Server. Jeder Tab ist eine eigene Sitzung, die <b>weiterläuft</b> – auch wenn du die Seite schließt
      oder das Command Center neu startet –, bis du den Tab schließt oder ${K('exit')} tippst.</p>
      <table><tr><td>${K('Alt')} + ${K('T')}</td><td>neues Terminal</td></tr>
      <tr><td>${K('Alt')} + ${K('1')}…${K('9')}</td><td>zu Tab 1–9 wechseln</td></tr>
      <tr><td>${K('Alt')} + ${K('⇧')} + ${K('←/→')}</td><td>aktiven Tab verschieben</td></tr>
      <tr><td>Doppelklick / Rechtsklick / ⋯</td><td>Einstellungen: Name, Anheften, Position, Schließen</td></tr>
      <tr><td>Mittelklick</td><td>Tab schließen</td></tr></table>
      <ul><li><b>Anheften:</b> Tab bleibt vorne und hat kein ×.</li>
      <li><b>Ziehen</b> verschiebt Tabs; der Knopf neben „+“ stellt die Tabs <b>seitlich</b> (wird pro Benutzer gespeichert).</li>
      <li><b>Wer nicht Superadmin ist</b>, bekommt die Shell als eigener Linux-Benutzer – ohne <code>sudo</code>/<code>su</code> (technisch gesperrt).</li>
      <li>Kopieren: ${K('Strg')} + ${K('⇧')} + ${K('C')}, Einfügen: ${K('Strg')} + ${K('⇧')} + ${K('V')}.</li></ul>`],
    ['docker', 'Docker', ['docker', 'docker-detail'], `
      <ul><li><b>Container:</b> Status, Live-CPU/RAM, Start/Stopp/Neustart, Logs (live), Konsole, Dateien, Prozesse, Inspect.</li>
      <li><b>Container öffnen</b> zeigt oben vier Live-Kacheln (jede Sekunde) und im Tab „Stats“ Graphen der letzten 5 Minuten.</li>
      <li><b>Images, Netze, Volumes, Stacks</b> (Compose-Projekte), <b>System</b> (Speicher, Aufräumen).</li>
      <li>Rechte: „Docker ansehen“, „Container starten/stoppen“, „Docker verwalten“ (⚠ entspricht Root).</li></ul>`],
    ['vms', 'Virtuelle Maschinen', ['vms', 'vm-detail'], `
      <p>libvirt/KVM: VMs anlegen, starten, Konsole im Browser (VNC/SPICE), Snapshots, Geräte, Netze, ISOs.
      Wer das Recht „Eigene virtuelle Maschinen“ hat, sieht und bedient nur seine eigenen VMs (Name beginnt mit seinem Präfix) und freigegebene.</p>`],
    ['zugriff', 'Verbindungen & Browser', ['connections', 'browser'], `
      <ul><li><b>Verbindungen:</b> SSH/VNC/RDP zu anderen Rechnern speichern und im Browser öffnen.</li>
      <li><b>Browser:</b> isolierte Browser-Sitzungen in einem Container – z. B. für Seiten, die man nicht im eigenen Browser öffnen will.</li></ul>`],
    ['sicherheit', 'Sicherheit & Sperren', ['security'], `
      <ul><li><b>IDS-Wächter</b> (Suricata): Datenverkehr, Treffer, letzte Sperren – live.</li>
      <li><b>Gesperrte IPs:</b> von fail2ban, IDS und von Hand; sperren/entsperren (auch mehrere), Sperre gilt am Cloudflare-Rand und an der Firewall.</li>
      <li><b>Meldungen:</b> Fehlversuche, Sperren, Logins – filtern nach Anwendung, Quelle, Text.</li></ul>`],
    ['angriffe', 'Angriffe (Angriffs-Radar)', ['angriffe'], `
      <p>Sammelt alle 2 Minuten Angriffsversuche: Suche nach Geheimnissen (<code>.env</code>, <code>.git</code> …), Lücken-Scans und
      Exploits, falsche Logins und IDS-Treffer – 24 Std / 7 / 30 Tage, Herkunft, Ziele, gesuchte Pfade.</p>
      <ul><li><b>Automatische Sperre:</b> 3 Scans in einer Stunde oder 1 Exploit-Versuch → gesperrt (1 Tag, bei Wiederholung länger).</li>
      <li>Normaler Verkehr wird nicht gespeichert, nur Versuche (90 Tage).</li></ul>`],
    ['benutzer', 'Benutzer, Gruppen & Rechte', ['users'], `
      <p>Rechte vergibst du über <b>Gruppen</b>; ein Benutzer kann in mehreren sein. Ansicht „Übersicht“ zeigt als Tabelle, wer was darf.</p>
      <ul><li><b>24 Rechte</b> in fünf Bereichen; mit ⚠ markierte sind kritisch (praktisch Root oder Zugang zu Geheimnissen).</li>
      <li><b>Vorlagen:</b> Beobachter, Docker-Betreuer, Docker-Admin, System-Admin, Sicherheit, VM-Nutzer, Benutzerpflege, Werkzeuge, Tresor, „Alle Angemeldeten“.</li>
      <li><b>Passwörter anderer Benutzer</b> setzt nur der <b>Inhaber</b> (ein festgelegter Superadmin).</li>
      <li>„Benutzerpflege“ darf nur Gruppen vergeben, deren Rechte sie selbst hat. Dienstkonten von Programmen sind geschützt.</li>
      <li>Der Server prüft jedes Recht bei jeder Aktion – das Menü blendet nur aus.</li></ul>`],
    ['benachrichtigungen', 'Benachrichtigungen', ['notifications'], `<p>Meldungen aus ntfy (z. B. Sperren, Logins, Server-Warnungen) zum Nachlesen.</p>`],
    ['werkzeuge', 'Optionale Seiten', ['konten', 'codes', 'backups', 'werkzeuge', 'startseite', 'automationen'], `
      <p>Konten, Codes, Backups, IT-Tools, Mein Dashboard und Automationen gibt es nur, wenn der Server sie in
      <code>funktionen.json</code> einträgt. Eingebettete Apps laufen in einer Sandbox ohne Zugriff auf das Command Center.</p>`],
    ['einstellungen', 'Einstellungen & Mein Konto', ['settings', 'konto'], `
      <ul><li><b>Sichtbare Tabs:</b> Seiten aus der eigenen Seitenleiste ausblenden (Rechte ändern sich nicht).</li>
      <li><b>Standard-SSH-Zugang</b> für Verbindungen. <b>Datenbank:</b> Zustand des Schnellspeichers (PostgreSQL mit Kopie, Rückfall SQLite).</li>
      <li><b>Mein Konto:</b> Profilbild, Passwort ändern, E-Mail für „Passwort vergessen?“, auf allen anderen Geräten abmelden.</li></ul>`],
    ['tasten', 'Alle Tastenkürzel', [], `
      <table><tr><td>${K('⌘/Strg')} + ${K('K')}</td><td>Springen zu … (Seiten, Container, Dienste, Aktionen)</td></tr>
      <tr><td>${K('⌘/Strg')} + ${K('B')}</td><td>Seitenleiste ein-/ausklappen</td></tr>
      <tr><td>${K('?')}</td><td>Hilfe zur aktuellen Seite</td></tr>
      <tr><td>${K('Alt')} + ${K('T')} / ${K('1')}…${K('9')}</td><td>Terminal: neuer Tab / Tab wechseln</td></tr>
      <tr><td>${K('Esc')}</td><td>Fenster und Suche schließen</td></tr></table>`],
    ['probleme', 'Wenn etwas nicht geht', [], `
      <ul><li><b>„Dafür fehlt dir das Recht …“</b> – ein Superadmin kann dich unter Benutzer → Gruppen freischalten.</li>
      <li><b>Seite lädt nicht / alte Ansicht:</b> neu laden (${K('⌘/Strg')} + ${K('⇧')} + ${K('R')}).</li>
      <li><b>Terminal getrennt:</b> „Neu“ verbindet neu – die Sitzung läuft weiter.</li>
      <li><b>Datenbank „SQLite“ statt PostgreSQL:</b> der Datenbank-Container ist nicht erreichbar; alles läuft weiter, Status unter Einstellungen.</li>
      <li><b>Update:</b> auf dem Server <code>sudo command-center update</code> (oder <code>git pull && sudo ./install.sh --update</code>).</li></ul>`],
  ];

  const $ = (id) => document.getElementById(id);
  let gebaut = false;

  function bauen() {
    if (gebaut) return;
    gebaut = true;
    $('hilfe-inhalt').innerHTML = ABSCHNITTE.map(([id, titel, , html]) =>
      `<section class="card hilfe-abschnitt" id="hilfe-${id}" data-titel="${titel.toLowerCase()}"><h2>${titel}</h2>${html}</section>`).join('');
    $('hilfe-sprung').innerHTML = ABSCHNITTE.map(([id, titel]) => `<a href="#hilfe/${id}" data-id="${id}">${titel}</a>`).join('');
    $('hilfe-sprung').addEventListener('click', (e) => { const a = e.target.closest('a'); if (!a) return; e.preventDefault(); springen(a.dataset.id); });
    $('hilfe-suche').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      let n = 0;
      document.querySelectorAll('.hilfe-abschnitt').forEach((s) => { const ja = !q || s.textContent.toLowerCase().includes(q); s.hidden = !ja; n += ja; });
      $('hilfe-leer').hidden = n > 0;
    });
  }

  function springen(id) {
    const s = $('hilfe-' + id); if (!s) return;
    s.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    s.classList.remove('aufleuchten'); void s.offsetWidth; s.classList.add('aufleuchten');
  }

  window.hilfeLaden = function (ziel) { bauen(); if (ziel) setTimeout(() => springen(ziel), 120); };
  window.hilfeFuer = function (seite) {
    const a = ABSCHNITTE.find(([, , seiten]) => seiten.includes(seite));
    if (typeof showPage === 'function') showPage('hilfe');
    window.hilfeLaden(a ? a[0] : 'start');
  };
  // „?“ öffnet die Hilfe zur aktuellen Seite (nicht in Eingabefeldern, nicht im Terminal)
  document.addEventListener('keydown', (e) => {
    if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (typeof currentPage !== 'undefined' && currentPage === 'terminal') return;
    e.preventDefault();
    window.hilfeFuer(typeof currentPage !== 'undefined' ? currentPage : 'dashboard');
  });
})();
