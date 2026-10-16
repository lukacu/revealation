# Content types

Content files define stable semantics that must survive WYSIWYG ↔ Markdown ↔ Present/export round trips.

Current extracted type:

- `interactive.js` — iframe-backed `::: interactive` content.

A content type is a good extraction candidate when it can clearly define its canonical Markdown/DOM representation, validation rules and serialization behavior in one place.
