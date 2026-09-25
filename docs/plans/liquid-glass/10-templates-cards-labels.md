# 10: Overlay templates: social/UI cards, labels and lower thirds, glass variants

## Goal
Complete the template library with the Social / UI cards and Labels & lower thirds families, and add Liquid
Glass variants (Control Centre tile, notification, search pill, slider) if the glass export shipped.

Project rules: `README.md` "Rules every brief carries". Read STATUS.md briefs 03-05 (glass; note what
any limitations) and 09 (the builder API, thumbnails, Templates panel tabs).

## Templates
Social / UI cards:
1. Post card (rounded rect, avatar circle, name + handle titles, body text, like/reply glyph shapes)
2. iOS notification banner (glass variant: blur 14, tint low)
3. Subscribe pill (red rounded pill, white text, bell glyph path) and Like button (heart path)
4. Search bar (glass pill, magnifier glyph, placeholder text)
5. Toggle switch (pill + knob circle; knob slides on enter using `slide`)
6. Progress bar (track pill + fill that `grow`s left to right over the item duration)
7. Control Centre tile (glass rounded square, icon circle) and Volume/brightness slider (tall glass pill, white fill sweep from bottom) like the reference image
Labels & lower thirds:
8. Lower third (accent bar + name + role, slide in from left, exit fade)
9. Pill tag / badge
10. Price tag (rounded rect + notch path + text)
11. Step number circle (filled circle + number title)
12. Chapter title bar (full-width bar, title, thin progress line)
13. Timer/countdown chip (pill + monospaced text; static text only, do NOT fake a live countdown: label it a static chip)

## Steps
1. Add the builders to `src/core/overlayTemplates.ts`, register them under new categories (Cards, Labels), thumbnails via the same generator, tabs in `OverlaysPanel.tsx`.
2. Glass variants: templates whose design is glass set `glass` only when the project can export it (brief 04 done); if glass export is not available (check STATUS), ship them as opaque/translucent fallbacks and say so in the entry. The panel Glass toggle from brief 09 turns glass on for any template that has a glass variant; add a "Liquid Glass" tag to those tiles.
3. Icon glyphs (magnifier, bell, heart, ticks, bell): build them as closed `path` geometries (schema `path` kind, `points` with in/out handles) in `src/core/templateGlyphs.ts`. Avoid third-party icon assets (licence inventory) and avoid emoji (font-dependent).
4. `docs/EDITING.md`: full template list; ROADMAP if it lists templates.

## Out of scope
User-saved templates, animated typing/counting, more families.


## Done when
- [ ] `npx tsc --noEmit -p .` clean
- [ ] STATUS.md entry (say plainly: not tested, typecheck only; next = none, plan complete)
- [ ] Commit only this slice's files. Stop.
