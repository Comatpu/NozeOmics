# Changelog

## Planned for 0.2.2 — applied locally

- Display the running application version beside the top-left logo/title. The label follows the actual version automatically; the current local build remains 0.2.1.

## 0.2.1 — 2026-10-09

- Preparation GSM tooltips follow the pointer, appear below-right by default, and move left when space is limited.
- Repeated GSEs are accepted and numbered (1), (2), etc., with independent sample assignments and AI reviews; verified source caches are reused.
- Significance tooltips explain genes excluded from testing due to low expression or no expression variation, separately from pending calculations. A dash marks these excluded genes instead of a question mark.
- Trend preserves numbered GSE names in its list and tooltips; significance dashes use the matching GSE color. Repeated GSE metadata is bound to its own reviewed entry.
- Preparation remains visible with a loading overlay while the reviewed batch is processed; Analysis opens after the batch completes successfully.

GitHub publication is performed only when explicitly requested. Default delivery updates the development app and Desktop EXE.

## 0.2.0 — 2026-10-08

- Published the Windows portable application with signed automatic updates and startup fallback.
- Added automatic first-launch Codex connection setup and the AI connection menu.
- Included Trend, MA, Heatmap and PCA interface improvements.
