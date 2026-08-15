# Offline analysis

This directory is a privileged, UI-independent post-game analysis boundary. It
must never be connected to active gameplay or invoked from an untrusted
Electron renderer with raw secrets.

- `backends.js` implements the common Claude and local Ollama adapters.
- `promptRegistry.js` loads independently versioned prompt files and computes
  their SHA-256 provenance hash.
- `structuredRunner.js` parses JSON, accepts fenced JSON, validates, and retries
  invalid output once with concrete feedback.
- `schemas.js` enforces the fixed taxonomy, severity/trend enums, exact evidence
  counts, and the eligible-puzzle allowlist.
- `service.js` builds trustworthy per-move inputs, persists classified or
  unclassified outcomes, and advances a completed game to analyzed only after
  every move has an outcome record.

Backend transport failures are recorded as unclassified outcomes. They never
modify the immutable game/move evidence and never produce a weakness tag.
