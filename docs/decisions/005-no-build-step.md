# ADR 005 — No mandatory front-end build step

## Status
Accepted.

## Context
Revealation is intended to be easy to inspect, modify and run locally for course preparation. A Node/bundler toolchain would add maintenance and installation overhead.

## Decision
Source files are browser-ready and loaded directly from `index.html`. They register documented APIs under `window.Revealation`.

## Consequences
- file load order is explicit and important;
- source boundaries must have small stable global contracts;
- no tree-shaking/transpilation is assumed;
- modern browser JavaScript is acceptable because Revealation targets current desktop browsers.
