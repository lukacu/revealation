/**
 * Revealation — slide model helpers
 * =================================
 *
 * Purpose
 * -------
 * Pure helpers for Revealation's ordered slide/subslide model.
 *
 * Data model note
 * ---------------
 * RV-COMPAT(subslide-vertical): REMOVE BEFORE PUBLIC RELEASE.
 * Historic Small Reveal projects store subslide membership in the boolean
 * field `slide.vertical`. Revealation keeps that field for file compatibility,
 * but the public terminology is **slide / subslide**. New code should call
 * `isSubslide()` instead of reasoning about "vertical slides" directly.
 *
 * Responsibilities
 * ----------------
 * - identify subslides;
 * - compute human-facing slide numbers (1, 2, 2.1, 2.2, 3 ...);
 * - find slide indices and reveal.js horizontal/vertical coordinates.
 *
 * Does NOT
 * --------
 * - mutate slides;
 * - render DOM;
 * - manage the active slide.
 *
 * Public API
 * ----------
 * `Revealation.core.slideModel`: `isSubslide`, `number`, `indexOf`, `position`.
 */
(function registerSlideModel(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  // RV-COMPAT(subslide-vertical): persisted field is still named `vertical`.
  function isSubslide(slide, index = 1) {
    return index > 0 && !!slide?.vertical;
  }

  function number(slides, index) {
    let slideNo = 0;
    let subslideNo = 0;
    for (let i = 0; i <= index && i < slides.length; i += 1) {
      if (i === 0 || !isSubslide(slides[i], i)) {
        slideNo += 1;
        subslideNo = 0;
      } else {
        subslideNo += 1;
      }
    }
    return subslideNo > 0 ? `${slideNo}.${subslideNo}` : String(slideNo);
  }

  function indexOf(slides, id) {
    return Array.isArray(slides) ? slides.findIndex((slide) => slide.id === id) : -1;
  }

  function position(slides, id) {
    const target = indexOf(slides, id);
    if (target < 0) return { h: 0, v: 0 };
    let h = -1;
    let v = 0;
    for (let i = 0; i <= target; i += 1) {
      if (i === 0 || !isSubslide(slides[i], i)) {
        h += 1;
        v = 0;
      } else {
        v += 1;
      }
    }
    return { h: Math.max(0, h), v };
  }

  app.core.slideModel = Object.freeze({ isSubslide, number, indexOf, position });
})(window);
