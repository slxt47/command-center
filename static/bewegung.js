// Bewegung (seit 3.10.0, 19.11.2026): gemeinsame Animationen für das Command Center.
//   Bewegung.flip(behaelter, auswahl, schluesselAttr, aendern)  Elemente gleiten an ihren neuen Platz (FLIP), neue
//       wachsen auf, entfernte blenden aus. aendern() baut die Liste neu (innerHTML o. ä.).
//   Bewegung.staffeln(elemente)  gestaffeltes Einblenden (z. B. nach Ansichtswechsel)
//   Bewegung.neueZeilen(tbody, schluessel)  neu hinzugekommene Tabellenzeilen kurz aufleuchten lassen
// Nur transform/opacity (Web Animations API); bei „Bewegung reduzieren“ passiert nichts außer aendern().
(function () {
  'use strict';
  const ruhig = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FEDER = 'cubic-bezier(.32, 1.25, .45, 1)', RAUS = 'cubic-bezier(.16, 1, .3, 1)';

  function flip(behaelter, auswahl, attr, aendern) {
    if (!behaelter || ruhig() || !behaelter.animate) { aendern(); return; }
    const vorher = new Map();
    behaelter.querySelectorAll(auswahl).forEach((el) => {
      const k = el.getAttribute(attr);
      if (k != null) vorher.set(k, { r: el.getBoundingClientRect(), el });
    });
    const erstesMal = vorher.size === 0;
    aendern();
    const nachher = new Set();
    behaelter.querySelectorAll(auswahl).forEach((el, i) => {
      const k = el.getAttribute(attr); if (k == null) return;
      nachher.add(k);
      const alt = vorher.get(k);
      if (alt) {
        const r = el.getBoundingClientRect();
        const dx = alt.r.left - r.left, dy = alt.r.top - r.top;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 420, easing: FEDER });
        }
      } else if (!erstesMal) {
        el.animate([{ opacity: 0, transform: 'scale(.86) translateY(6px)' }, { opacity: 1, transform: 'none' }],
          { duration: 360, easing: FEDER, delay: Math.min(i, 6) * 20, fill: 'backwards' });
      }
    });
    // Entfernte: Geist an alter Stelle ausblenden
    for (const [k, { r, el }] of vorher) {
      if (nachher.has(k)) continue;
      const geist = el.cloneNode(true);
      geist.setAttribute('aria-hidden', 'true'); geist.removeAttribute(attr); geist.inert = true;
      Object.assign(geist.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px',
        margin: '0', pointerEvents: 'none', zIndex: 5 });
      document.body.appendChild(geist);
      geist.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.85)' }], { duration: 240, easing: RAUS })
        .finished.then(() => geist.remove(), () => geist.remove());
    }
  }

  function staffeln(elemente) {
    if (ruhig()) return;
    [...elemente].slice(0, 18).forEach((el, i) => {
      if (!el.animate) return;
      el.animate([{ opacity: 0, transform: 'translateY(12px) scale(.985)' }, { opacity: 1, transform: 'none' }],
        { duration: 480, easing: RAUS, delay: i * 32, fill: 'backwards' });
    });
  }

  const gesehen = new WeakMap();
  function neueZeilen(tbody, schluessel) {
    if (!tbody) return;
    const alt = gesehen.get(tbody), jetzt = new Set();
    tbody.querySelectorAll('tr').forEach((tr) => {
      const k = schluessel(tr); if (!k) return;
      jetzt.add(k);
      if (alt && !alt.has(k) && !ruhig() && tr.animate) {
        tr.animate([{ backgroundColor: 'var(--accent-ghost)', transform: 'translateX(-6px)', opacity: 0 },
          { backgroundColor: 'var(--accent-ghost)', transform: 'none', opacity: 1, offset: 0.35 },
          { backgroundColor: 'transparent' }], { duration: 1600, easing: RAUS });
      }
    });
    gesehen.set(tbody, jetzt);
  }

  // Dialoge (.bg-dialog) schließen mit kurzer Ausblende statt hartem Verschwinden
  const zu = HTMLDialogElement.prototype.close;
  HTMLDialogElement.prototype.close = function (wert) {
    if (!this.classList.contains('bg-dialog') || !this.open || ruhig() || this._schliesst || !this.animate) return zu.call(this, wert);
    this._schliesst = true;
    const a = this.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(8px) scale(.97)' }], { duration: 170, easing: RAUS });
    a.finished.then(() => { this._schliesst = false; zu.call(this, wert); }, () => { this._schliesst = false; zu.call(this, wert); });
  };
  document.addEventListener('cancel', (e) => {
    if (e.target instanceof HTMLDialogElement && e.target.classList.contains('bg-dialog') && !ruhig()) { e.preventDefault(); e.target.close(); }
  }, true);

  window.Bewegung = { flip, staffeln, neueZeilen, ruhig };
})();
