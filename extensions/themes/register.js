/** Explicit installed-theme catalog for Revealation's no-build static runtime. */
(() => {
  const app = window.Revealation;
  const themes = app?.theme;
  if (!themes) throw new Error('Theme registry must load before installed themes.');
  themes.registerManifest(app.urls.app('themes/clean/theme.json'));
  themes.registerManifest(app.urls.app('themes/dark/theme.json'));
  themes.registerManifest(app.urls.app('themes/classic/theme.json'));
  themes.registerManifest(app.urls.app('themes/kinetic/theme.json'));

  // RV-COMPAT(theme-reveal-aliases): REMOVE BEFORE PUBLIC RELEASE.
  // Old decks stored raw reveal.js theme ids. Map the useful light/dark family
  // to curated Revealation themes during the internal migration period.
  ['white', 'simple', 'beige', 'sky', 'solarized', 'serif'].forEach(id => themes.registerAlias(id, 'clean'));
  ['black', 'league', 'night', 'blood', 'moon'].forEach(id => themes.registerAlias(id, 'dark'));
})();
