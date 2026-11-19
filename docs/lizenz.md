# Lizenz

Das Command Center braucht beim Installieren und bei Updates einen **Lizenzschlüssel** (`CC-XXXXX-XXXXX-XXXXX-XXXXX`).

- **Anfragen:** [lizenz.slxt.dev](https://lizenz.slxt.dev) – Name, E-Mail, wofür, wie viele Server. Der Schlüssel kommt per E-Mail.
- **Eintragen:** beim Installieren (der Installer fragt, oder `--lizenz CC-…`), später unter **Einstellungen → Lizenz**
  oder `sudo command-center lizenz CC-…`.
- **Prüfung:** beim Installieren, bei jedem Update und einmal täglich. Übertragen werden nur der Schlüssel, eine anonyme
  Server-Kennung (Prüfsumme der `machine-id`) und die Version. Ist der Lizenzserver nicht erreichbar, gilt das letzte gute
  Ergebnis 14 Tage weiter.
- **Laufzeit:** je nach Schlüssel (z. B. 1 Jahr oder unbegrenzt) und für eine bestimmte Zahl von Servern.
  30 Tage vor Ablauf erscheint im Command Center ein Hinweis.
- **Nach Ablauf:** das Command Center läuft weiter, aber Updates und Neuinstallationen sind gesperrt, bis ein gültiger
  Schlüssel eingetragen ist. Verlängern: wieder über [lizenz.slxt.dev](https://lizenz.slxt.dev).

Status: `sudo command-center lizenz` oder `sudo command-center status`.
