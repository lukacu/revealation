/**
 * Revealation — local layout extensions
 * =====================================
 *
 * This file is loaded automatically after the built-in layouts. Add local
 * project/application layout registrations here, or replace this file with
 * registrations maintained alongside your Revealation installation.
 *
 * Slot order maps positional Markdown `::: block` children to semantic slot ids.
 * Slot ids are also transfer keys when the user changes layouts. Exactly one slot
 * is the `master`, which receives content from source fields without a name match.
 * `initialBlock` controls the empty WYSIWYG scaffold (`p`, `h1` ... `h6`).
 *
 * Example (disabled):
 *
 * Revealation.layout.register({
 *   id: 'title-wide-media',
 *   label: 'Title + wide media',
 *   description: 'Compact title above a large media/content region.',
 *   slots: [
 *     { id: 'title', label: 'Title', initialBlock: 'h1' },
 *     { id: 'media', label: 'Media', master: true, initialBlock: 'p' },
 *   ],
 *   grid: {
 *     areas: '"title" "media"',
 *     columns: 'minmax(0, 1fr)',
 *     rows: 'auto minmax(0, 1fr)',
 *     gap: '0.7em',
 *   },
 *   css: `
 *     .reveal .sr-layout-title-wide-media [data-slot="media"] {
 *       align-self: center;
 *     }
 *   `,
 * });
 */
