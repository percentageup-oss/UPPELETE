# Liquid Glass shapes, per-corner radii, grouped overlay templates

Goal: Apple "Liquid Glass" look for shapes (real backdrop blur, saturation, rim light, edge refraction),
independent radii for each of a box's four corners, and a library of grouped overlay templates (chat,
callouts, social/UI cards, labels) in the Overlays panel.

Decisions (made with the user, do not re-litigate): full Liquid Glass including refraction; templates
insert as a real **group**; all four template families.

Why glass is hard: the export host paints graphics on a TRANSPARENT layer that FFmpeg overlays on the
picture, so CSS `backdrop-filter` has nothing to blur in export. The shape-blend work already splits the
pipe into K = 2k+1 passes (`src/core/graphicsPasses.ts`, `workers/media/exportArguments.ts`
`compositeGraphicsPasses`). Glass adds a second kind of odd pass: FFmpeg blurs/saturates/displaces the
picture under the shape's silhouette (`gblur`, `colorchannelmixer`, `displace`), driven by a map the host
paints. Preview uses real `backdrop-filter` plus an SVG displacement filter. Both use one shared pure
map generator.

| Order | Brief | Outcome |
|---|---|---|
| 1 | `01-corner-radii.md` | Schema 20, per-corner radii, inspector + stage handles |
| 2 | `02-glass-spike.md` | Measurements only (Chromium + FFmpeg), no product code |
| 3 | `03-glass-model-and-preview.md` | Schema 21 `glass`, map generator, preview, inspector; export refuses |
| 4 | `04-glass-export-pass.md` | Glass export pass + glass docs; removes the refusal (old brief 05 folded in) |
| 6 | `06-groups-model.md` | Schema 22 groups + commands |
| 7 | `07-groups-ui.md` | Group selection, stage, timeline, Layers panel |
| 8 | `08-bubble-and-fit.md` | `bubble` geometry, fit-to-text, `template-insert` |
| 9 | `09-templates-chat-callouts.md` | Chat + callout templates, Templates UI |
| 10 | `10-templates-cards-labels.md` | Social/UI cards + labels, glass variants |

Dependencies: 1 -> 2 -> 3 -> 4 (glass track). 6 -> 7 -> 8 -> 9 -> 10 (templates track); 6 can start
after 1. Brief 10's glass variants need 4. Schema numbers assume the current schema is 19 and these run in
the order above; if another slice bumped the schema meanwhile, use the next free number.
Each brief is self-contained, one per fresh session. Data passes between briefs only via `docs/STATUS.md`.

## Rules every brief carries (from AGENTS.md)
- Renderer has no Node integration; spawn tools with argument arrays. Never block the UI thread.
- Preview and export share layout and animation logic; never ship a control only one of them honours, and never present a nonfunctional export control as done.
- New schema fields: bump `schemaVersion`, keep old strict schemas (see `shapeSchemaV18` in `src/core/edit.ts`), add a `migrateVNN.ts` like `src/core/migrateV18.ts`, never store defaults so untouched projects stay byte-identical.
- With no glass shapes and no blending shapes, FFmpeg arguments must stay byte-identical (K = 1).
- **No tests.** Write no new tests; run no test suites, parity stages or export smoke runs (user decision to limit token spend; this overrides the AGENTS.md testing rule for this plan). The only check is `npx tsc --noEmit -p .` clean.
- Do not delete or rewrite existing tests; if a schema/API change breaks the typecheck of an existing test file, make the minimal fix.
- STATUS entries say plainly "not tested, typecheck only"; claim nothing more. No macOS claim. No models, media or exports in git.
- Finish: add a short entry at the top of `docs/STATUS.md` (changes, verification, limitations, next), then commit ONLY that slice's files (the tree has unrelated uncommitted work; `git add <paths>`). Stop after the commit.
