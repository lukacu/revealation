# Revealation presentation format

Portable presentations use the `.revealation` extension. A file is an ordinary
ZIP archive whose first entry is the uncompressed UTF-8 `mimetype` entry:

```text
application/vnd.revealation.deck+zip
```

The archive contains:

```text
mimetype
manifest.json
deck.json
assets/...
```

`manifest.json` is descriptive metadata. Its `format` is `revealation` and its
numeric `formatVersion` is currently `1`; `generatorVersion` is the installed
Revealation application version. `created` is retained from the project when
available and `modified` is set when the package is exported. Application
versioning and package format versioning are independent.

`deck.json` is the canonical serialized Revealation project. It retains slides,
subslides, layouts, notes, themes, backgrounds, settings, transitions and
interactive definitions without changing the working deck schema. Local asset
references are relative paths under `assets/`; binary data is never embedded as
base64 in `deck.json`. Remote URLs remain remote references.

Native package import/export is independent of the working-project backend.
IndexedDB, a selected directory, and the local server workspace continue to
autosave their normal `deck.json`/`deck.md` files; `.revealation` is the portable
exchange format and is not rewritten after every edit. Browser file inputs and
Blob downloads are sufficient, so directory access is not required.

Import validates the ZIP paths, required entries, MIME marker, manifest version,
deck model, and every declared asset before changing the active project. Future
format versions must be added as explicit migrations in the package importer;
unknown versions are rejected rather than guessed.
