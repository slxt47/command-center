// Sprachwahl auf der Anmeldeseite (3.14.0): Knöpfe je Sprache, Name in der eigenen Sprache
(function () {
  const nav = document.getElementById('sprache'), i = window.CC_I18N;
  if (!nav || !i) return;
  for (const [code, name] of Object.entries(i.sprachen)) {
    const b = document.createElement('button');
    b.type = 'button'; b.lang = code; b.textContent = name;
    b.setAttribute('aria-pressed', code === i.code ? 'true' : 'false');
    b.addEventListener('click', () => { if (code !== i.code) i.setzen(code); });
    nav.appendChild(b);
  }
})();
