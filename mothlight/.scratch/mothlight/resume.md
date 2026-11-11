# Resume capsule — MOTHLIGHT (2026-11-10)

## Authorization envelope
- Goal: build a cyberpunk city exploration game; deliver source + REPORT.md; no questions; review
  screenshots and fix obvious visual problems before wrapping up. Later user notes: Blender may be used if
  needed; Claude in Chrome became available; "still a bit rough" (led to the polish pass).
- Allowed scope: new folder `mothlight/` only. Nothing outside it modified.
- git commit / push / publish / outbound send: all NO (not mentioned; folder is not a git repo).
- Data leaving the machine: one Codex read-only consult attempted (prompt text only, failed before any
  model call succeeded). No other outbound data.
- Budget: defaults (12 attempts, 3 cross-model consults, greenfield exemption for `mothlight/`).

## Decisions
- Built in `mothlight/` because the parent folder holds unrelated earlier projects.
- three.js + hand-written shaders, single-file esbuild output; Blender not used (all geometry procedural).
- Browser checks: Chrome DevTools bridge while the Claude in Chrome extension was offline, then Claude in
  Chrome for everything after.
- Independent review: Codex unavailable (model rejected by account) -> Opus `ecc:code-reviewer` subagent.

## Assumptions
- Missing deliverables 1-2 in the request = the playable game and screenshots (medium confidence).
- "Rough" meant visual flatness at close range (medium confidence; user did not specify).

## State
- Done: game, 12 passing tests, polish pass, 9 screenshots, REPORT.md.
- Open: independent review result pending at time of writing; apply any confirmed findings, rebuild,
  re-test, update the note at the end of REPORT.md.
- Verify with: `npm test`, `npm run build`, `npm run serve` then http://127.0.0.1:5179/.
