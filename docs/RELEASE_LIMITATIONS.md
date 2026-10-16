# Release-critical limitations

These limitations are part of the alpha release contract and should be
communicated to users before they choose a deployment or export workflow.

## Local-directory PWA access

Chromium-family browsers are the preferred choice for hosted/PWA use when a
presentation should be opened from a local directory. Revealation uses the
File System Access API, including `showDirectoryPicker()`, and browser support
for that API is not consistent elsewhere. If directory access is unavailable
or declined, Revealation falls back to browser-backed storage rather than
opening the local workspace directly. See [PWA deployment](PWA_DEPLOYMENT.md).

## Standalone HTML and interactive apps

Standalone HTML export is suitable for ordinary decks and simple interactive
content, but it cannot reliably bundle every complex interactive application.
Apps that depend on relative ES modules, dynamic imports, runtime `fetch()`
calls, workers, server endpoints, or other external runtime state may require
their original workspace directory or a dedicated bundle step. Use the ZIP
export when the complete interactive application must travel with the
presentation. See [interactive embeds](INTERACTIVE.md).

## PDF export

PDF export is browser-driven rather than a server-side PDF renderer. Revealation
opens reveal.js print mode and depends on the browser's native **Print → Save
as PDF** dialog to create the final file. Rendering readiness is improved by
waiting for reveal.js and iframe load/paint boundaries, but browser print
settings, browser differences, cross-origin content, and applications that
render substantially after `load` can still affect the result. See [PDF
export](PDF_EXPORT.md).
