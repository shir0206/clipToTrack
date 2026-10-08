# CSS Refactor Plan: class naming and cleanup

Source: `css-class-name-map.md` (generated 2026-10-06, 7 CSS files, 52 source files, 652 mapped rules).
Goal: better CSS, **same visual result**. No styling change, only structure, naming and selector quality.

## Completion status

- [x] Phase 0: Safety net and tooling
- [x] Phase 1: Zero-risk cleanup
- [x] Phase 2: Shared primitives
- [x] Phase 3: Settings dialog
- [x] Phase 4: Playback help
- [x] Phase 5: Gauges
- [x] Phase 6: Projects UI
- [x] Phase 7: Clip-to-track
- [x] Phase 8: Global styles
- [x] Phase 9: Enforcement and final verification

Verification recorded 2026-10-06:

- [x] `node scripts/css-audit.mjs`
- [x] `node scripts/collision-check.mjs`
- [x] `yarn build`
- [x] `yarn predeploy`

---

## 0. How to read this plan

- Every phase is self-contained and ends with a checklist, so we can implement phase by phase.
- Names marked **(verify)** are my best guess from the CSS properties and the truncated JSX snippet in the map. The map does not show full TSX files, so before renaming each component I must open its `.tsx` and confirm the role of the element.
- "Old → New" tables are the single source of truth for the rename script (Phase 0).
- Third-party classes (`maplibregl-*`) are never renamed. They are the only allowed exception to the naming rules, and only as selectors inside our own scoped rules.

---

## 1. The rules (what "good" means)

| #   | Rule                                                                                                                                                                                                                                               | How we check it                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | The class name describes the rule/role it carries (what it _is_), not where it sits or what element it is.                                                                                                                                         | Review against the mapping tables |
| 2   | **Max two words**: `word-word`. Never `word-word-word`.                                                                                                                                                                                            | Name-pattern check                |
| 3   | **No initials/abbreviations**: no `ctt`, `tb`, `dd`, `psel`, `pd`, `ph`, `gt`, `ico`, `lbl`, `tx`, `chev`, `asl`, `rn`, `md`, `sm`, `hi`, `maj`, `min`, `v`, `w`... Full words only.                                                               | Name-pattern check                |
| 4   | **No `!important`**. If one appears, the clustering/specificity is wrong; we fix the structure.                                                                                                                                                    | grep + audit                      |
| 5   | **No HTML tags in selectors** (`h2`, `p`, `span`, `strong`, `em`, `b`, `i`, `small`, `li`, `ul`, `svg`, `rect`, `button`, `input`, `summary`, `section`, `header`, `footer`, `code`, `label`...). If the element has no class, add one in the TSX. | audit "missing class name"        |
| 6   | **No IDs** in CSS.                                                                                                                                                                                                                                 | grep `#`                          |
| 7   | **No BEM**: no `__`, no `--` modifiers.                                                                                                                                                                                                            | Name-pattern check                |
| 8   | **Inline styles only when truly runtime-dynamic**, and then only as a CSS custom property (`style={{ '--c': color }}`); the actual rule lives in CSS. Static values move to CSS.                                                                   | grep `style=`                     |
| 9   | State/variant modifiers are always `is-` + one full word (`is-selected`, `is-small`), always **chained** to a base class (`.clip-card.is-selected`), never standalone.                                                                             | Name-pattern check                |
| 10  | No `ctt-` prefix. It is an initialism (clip-to-track). Uniqueness comes from descriptive two-word names plus a collision check.                                                                                                                    | Collision script                  |

Allowed non-class selectors (explicit, documented exceptions, see Decision D1): `:root` (design tokens), the minimal global reset block, and `maplibregl-*` third-party hooks.

---

## 2. What the audit found (numbers)

| Finding                                | Count                                     | Where                                                                                                                                     |
| -------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Unique class names                     | 302 (227 start with `ctt-`)               | all                                                                                                                                       |
| Rows flagged "initial/abbreviation"    | 559 of 652                                | everywhere (prefix `ctt-` + short stems)                                                                                                  |
| Names with 3+ words                    | 18 rows                                   | `ctt-tab-split-x`, `ctt-prof-pane-head`, `ctt-gt-pill-cap`, `ctt-phead-sub-container`, ...                                                |
| `!important`                           | **3 rules**                               | `styles.css` (`*`), `ClipToTrack.css` (`.ctt-tab-split-x`), `SettingsDialog.css` (`.ctt-set-warn`)                                        |
| ID selectors                           | **3**                                     | `#set-view`, `#set-layout`, `#set-data` (SettingsDialog.css)                                                                              |
| Selectors using HTML tags              | ~120                                      | all files, heaviest in ClipToTrack, ProjectsUI, gauges                                                                                    |
| Selectors with no class at all         | 16 rows                                   | `styles.css`: `:root`, `*`, `body`, `button`, `input`, `main`, `h1`, `footer`, `button:focus-visible`, `a:focus-visible`, `*` (important) |
| Inline `style=` on matched elements    | 42 rows (~31 distinct sites)              | gauges, `ClipCard`, `ElevationProfile`, `ProjectsUI`, `VideoModal`, `pointPopup.ts`, `ClipToTrack.tsx`                                    |
| Same class defined in 2+ CSS files     | 12                                        | `ctt-btn`, `ctt-link`, `ctt-icon`, `ctt-confirm`, `ctt-list`, `is-on`, `is-over`, `is-dragging`, `ctt-gt-fill/lbl/needle/bar`             |
| `styles.css` rows with no source match | **82 of 82**                              | probably dead legacy landing-page CSS (see Phase 1)                                                                                       |
| Unmatched elsewhere                    | 16                                        | `.ctt-mark`, `.ctt-chips`, `.ctt-popup*` (likely built in JS), keyframes                                                                  |
| Largest file                           | `ClipToTrack.css`: 287 rules, 131 classes | needs splitting                                                                                                                           |

Important observations that shape the plan:

1. **All three `!important` are symptoms of a tag selector beating a class**, not real needs:
   - `.ctt-tab-split button { padding: 4px 9px }` (specificity 0,1,1) is fought by `.ctt-tab-split-x { padding: ... !important }` (0,1,0).
   - `.ctt-set-row small { display:block; opacity:.65; margin-top:1px }` (0,1,1) is fought by `.ctt-set-warn { display:flex !important; margin-top:6px !important; opacity:1 !important }`.
   - `*{ scroll-behavior:auto !important; transition:none !important }` is a global reduced-motion hammer, while every component file **already has its own** `@media (prefers-reduced-motion: reduce)` block (28 rules in total).
     Removing the tag selectors (Rule 5) removes the reason for `!important`.
2. `AltitudeCluster.css` borrows `ctt-gt-*` classes from `SpeedCluster.css` (`ctt-gt-needle`, `-fill`, `-lbl`, `-bar`) and overrides them. This is cross-file coupling and needs a shared gauge file.
3. `ctt-link`, `ctt-btn`, `ctt-confirm`, `ctt-icon` are shared UI primitives defined in two or three files and then patched per context with descendant selectors (`.ctt-measure .ctt-link`, `.ctt-toast-body .ctt-link`, `.ctt-pd .ctt-link:disabled`...). They should live once, with chained modifiers for the contexts.
4. Duplicates inside the same file: `.ctt-btn` (twice), `.ctt-link` (twice), `.ctt-gt::before/::after` (twice), `.ctt-tb-btn[data-tip]::before/::after` (twice). Merge them (carefully, later value wins).
5. Both files `ClipToTrack.css` and `ProjectsUI.css` target elements by `li.is-on`, `p.ctt-place` (tag + class qualifiers). Tag qualifiers go.

---

## 3. Decisions I need from you (defaults in bold, so I can proceed if you do not answer)

| ID  | Question                                                                                                                                                                                                                                                                                                                                                     | Default                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Global reset. `*{box-sizing}`, `button{font:inherit;cursor:pointer}`, `input{font:inherit}`, `button/a:focus-visible` are tag selectors by nature. Giving every button/input/link in 52 files a class (and the third-party maplibre buttons cannot have one) is very invasive. Keep a **minimal documented reset block** as the only tag-selector exception? | **Yes, keep one clearly labelled `/* Reset */` block (6 rules) in `base.css`; everything else gets a class.**                                    |
| D2  | `aria-pressed='true'`, `[open]`, `:disabled`, `[data-tip]`: native state/attribute hooks. Keep them instead of duplicating state in an extra class?                                                                                                                                                                                                          | **Keep (single source of truth, accessibility-correct). Add the class only where no native hook exists.**                                        |
| D3  | Drop the `ctt-` prefix everywhere?                                                                                                                                                                                                                                                                                                                           | **Yes** (it is an initialism and the audit flags it 559 times).                                                                                  |
| D4  | `id={`ctt-${clip.id}`}` on `ClipCard` and the three `set-*` ids in the Settings dialog: they are used in TSX, not only CSS. Remove the ids?                                                                                                                                                                                                                  | **Keep them if used for `aria-labelledby`, `aria-activedescendant`, `getElementById`/`scrollIntoView`; remove CSS use only.** I will grep first. |
| D5  | Reduced motion strategy to replace `*{...!important}`: (A) per-component blocks that already exist, completed so every `transition`/`animation` is covered; (B) motion duration tokens at `:root`.                                                                                                                                                           | **A** (zero risk of changing normal-mode timings).                                                                                               |
| D6  | Split `ClipToTrack.css` (131 classes) into per-component files?                                                                                                                                                                                                                                                                                              | **Yes** (Phase 6), keeping the import order so the cascade is unchanged.                                                                         |

---

## 4. Naming conventions for the new names

- Format: `thing-role` (two words), e.g. `clip-card`, `card-title`, `toolbar-button`, `search-input`.
- The first word is the **component/area noun** (`clip`, `card`, `toolbar`, `settings`, `project`, `gauge`, `altitude`, `profile`, `popup`, `help`), the second is the **part** (`title`, `header`, `body`, `list`, `item`, `button`, `icon`, `label`, `value`, `hint`).
- Never a bare one-word global class (`list`, `item`, `title`) except `is-*` modifiers (always chained).
- Elements that were selected by tag get a part-name class: `h2` → `*-title`, `p` → `*-text`, `small` → `*-hint`/`*-note`, `strong`/`b` → `*-name`/`*-value`/`*-label` depending on role, `em` → `*-count`/`*-label`, `i` (presentational) → `*-fill`/`*-cell`/`*-swatch`, `li` → `*-item`/`*-option`/`*-row`, `ul` → `*-list`, `svg` → `*-graphic`, `span` → by role.
- `data-` attributes and `aria-` attributes stay as they are.
- Keyframes are renamed to the same style and updated where referenced: `ctt-pulse → marker-pulse`, `ctt-bob → icon-bob`, `ctt-slide → panel-slide`, `ctt-eq → equalizer-bounce`, `ctt-glow → card-glow`, `ctt-badge → badge-pop`, `ctt-toast-in → toast-enter`, `ctt-alt-pulse → altitude-pulse` **(verify each in the CSS `animation:` references)**.

---

## 5. Phase 0: Safety net and tooling (no code change)

Purpose: we can prove "no styling change" and rename safely.

1. **Branch/commit** the current state: `git checkout -b css-refactor` (or a tag `before-css-refactor`).
2. **Full inventory** (read-only):
   - Read the 7 CSS files and every `.tsx`/`.ts` listed in the map: `ClipToTrack.tsx`, `ClipCard.tsx`, `UploadZone.tsx`, `VideoModal.tsx`, `Logo.tsx`, `SvgIcon.tsx`, `AltitudeCluster.tsx`, `SpeedCluster.tsx`, `ElevationProfile.tsx`, `MapPanel.tsx`, `TrackMap.tsx`, `PlaybackHelp.tsx`, `ProjectsUI.tsx`, `SettingsDialog.tsx`, `lib/pointPopup.ts`, plus `index.html` and `src/main.tsx` (for import order and the `<body>` element).
   - Find **every place a class name is written as a string**, not only `className="..."`: template literals (`` `ctt-card${selected ? ' is-selected' : ''}` ``), computed names (`is-${size}`, `ctt-gt-dial ${className}`), `classList.add/toggle`, `querySelector('.ctt-…')`, `class="…"` inside HTML strings (`pointPopup.ts`), maplibre options (`className`, `closeButton`, marker elements created with `document.createElement`), and tests/e2e selectors.
   - Record the CSS import order (which file loads before which); this decides cascade ties.
3. **Baseline snapshot** (so we can compare after each phase). Playwright script `scripts/style-snapshot.mjs` that opens the app and, for each state below, dumps `getComputedStyle` of every element (keyed by DOM path + tag + position, **not** class name, because class names change) plus a screenshot:
   - empty app, clips list, selected card, playing card, hidden card, card with thumbnail, confirm bar open, "more" details open, upload zone idle/over/busy;
   - map column with each `hides-*` variant, popup normal/pinned, measure bar, legend, chips;
   - elevation profile: tabs, split tab, drop target, dragging/resizing, popout pane;
   - toolbar: tooltip hover/focus, dropdown open, search with results;
   - projects: bar, select open, tray, detail, rename, toast, new/add, drag states;
   - settings dialog (all three sections, warning, disabled rows), playback help;
   - speed and altitude gauges at several values (including `idle`, `down`), at container widths 600/560/480 and heights 340/190, viewport 620/640;
   - `prefers-reduced-motion: reduce` on and off.
     After each phase we re-run and diff: **the computed-style diff must be empty** (apart from custom-property names/classes, which are not in computed style).
4. **Rename script** `scripts/rename-classes.mjs` (Node, no new dependency): reads a `rename-map.json` (built from the tables below) and rewrites class tokens in `*.css`, `*.tsx`, `*.ts`, `index.html` using whole-token matching (so `.ctt-card` never clobbers `.ctt-card-body`); it also logs any old name still present afterwards. Longest names first.
5. **Gate = re-run the same audit that produced `css-class-name-map.md`.** Target at the end: 0 `!important`, 0 IDs, 0 "missing class name" (except the documented reset block), 0 "initial/abbreviation", 0 "long class name", 0 inline-style warnings (except custom-property ones).
6. **Collision check** script: all new class names are unique across all CSS files (except chained `is-*` modifiers), and none equals a `maplibregl-*` name.

**Phase 0 checklist:** branch · inventory notes · snapshot baseline committed · rename script · collision script · answers to D1-D6.

---

## 6. Phase 1: Zero-risk cleanup (before any rename)

Everything here must leave the snapshot diff empty.

### 1.1 `styles.css`: dead legacy CSS

All 82 rules (32 classes: `drop-zone`, `drop-icon`, `clip-grid`, `clip-card`, `export-panel`, `warnings`, `file-list`, `privacy-pill`, `topbar`, `intro`, ...) report **"not found"** in the 52 source files. Steps:

1. grep these class names in `src/`, `index.html`, `public/`, tests, and the git history of the TSX (to see if an old page used them).
2. If unused: **delete them**. Keep only `:root`, the reset block, `body`, and anything actually used.
3. If something is used (for example by `index.html`), rename it using the table in Phase 7 and add the class.

### 1.2 Merge duplicate rules inside one file

- `ClipToTrack.css`: `.ctt-btn` (two blocks), `.ctt-link` (two blocks), `.ctt-tb-btn[data-tip]::before` and `::after` (two blocks each).
- `SpeedCluster.css`: `.ctt-gt::before` / `::after` (two blocks each: shared box + per-side offset). Combine into one grouped selector `.gauge-cluster::before, .gauge-cluster::after` for the shared part and keep a small per-side rule.
  Rule: merge only when no other rule with an overlapping selector sits between them; where both set the same property, the later value wins.

### 1.3 Unused/odd rules

Check and delete (or fix) what the audit could not match: `.ctt-mark`, `.ctt-chips`, `.ctt-hint-pad`, `.ctt-btn-spacer`, `.ctt-card-head-container`, `.ctt-phead-sub-container`, `.ctt-phead-sub-header`. If a class is built in JS (`.ctt-popup`, `.ctt-popup-pinned`, `.ctt-pop-head/-tag`), it is _used_; keep it.

### 1.4 Property-level hygiene (no value changes)

- Replace hard-coded values that are **identical** to an existing token with the token (e.g. a hex equal to `--border`), only when equal.
- Keep declaration order consistent: layout (position/display/grid/flex) → box (size/margin/padding) → typography → color/background/border → effects → transitions.

**Phase 1 checklist:** snapshot diff empty · `styles.css` reduced to what is used.

---

## 7. Phase 2: Shared primitives (one place, no cross-file duplicates)

New file: `src/components/common/Controls.css`, imported by every component that uses these classes. It is imported **before** the component files so component rules can still refine them with a chained modifier (never with `!important`).

Before moving, compare the declarations of each duplicate in `ClipToTrack.css` vs `ProjectsUI.css` (and `SettingsDialog.css` for the link). Per property, the file loaded later currently wins; the merged rule must keep that final value. If the two contexts truly differ, the difference becomes a chained modifier.

| Old                               | New                                                 | Notes                                                                                       |
| --------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ctt-btn`                         | `icon-button`                                       | 34px round control. Merge both definitions.                                                 |
| `ctt-btn-primary`                 | `icon-button` + `is-primary`                        | modifier, chained                                                                           |
| `ctt-btn-spacer`                  | `button-spacer`                                     | **(verify)** may be unused (Phase 1.3)                                                      |
| `ctt-link`                        | `link-button`                                       | button that looks like a link                                                               |
| `ctt-icon`                        | `inline-icon`                                       | merge ClipToTrack + ProjectsUI                                                              |
| `ctt-confirm`                     | `confirm-bar`                                       | merge both files                                                                            |
| `ctt-confirm span`                | `confirm-message`                                   | add class to the `<span>`                                                                   |
| `ctt-confirm button`              | grouped selector `.confirm-accept, .confirm-cancel` | shared font/padding/radius; no tag selector, no extra class needed                          |
| `ctt-confirm-yes`                 | `confirm-accept`                                    |                                                                                             |
| `ctt-confirm-no`                  | `confirm-cancel`                                    |                                                                                             |
| `ctt-switch`                      | `toggle-switch`                                     | currently in Settings; also move its `:checked::after`, `:focus-visible`                    |
| `ctt-set-danger`                  | `danger-button`                                     | destructive action; same colors as `confirm-accept`, so share the `--danger` rules          |
| `ctt-list`                        | `plain-list`                                        | **(verify)** declarations are identical in both files; if not, `clip-list` / `project-list` |
| `is-on`, `is-over`, `is-dragging` | unchanged                                           | stay modifiers, always chained; each file only uses them chained                            |

### 2.1 Context overrides → modifiers

The base currently has `margin-right: 10px`, and each context cancels it through a descendant selector. Replace with a chained modifier added in the TSX:

| Old selector                                                                                                                                         | New                                                                                                                                                   | Declarations                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.ctt-measure .ctt-link`                                                                                                                             | `.link-button.is-flush`                                                                                                                               | `margin: 0`                                                                                                                                                                                                                                |
| `.ctt-phead-title .ctt-link`                                                                                                                         | `.link-button.is-flush`                                                                                                                               | `flex: none; margin: 0` (put `flex:none` on the project title's own class if needed)                                                                                                                                                       |
| `.ctt-toast-body .ctt-link`                                                                                                                          | `.link-button.is-stacked`                                                                                                                             | `margin: 6px 0 0`                                                                                                                                                                                                                          |
| `.ctt-measure .ctt-link:disabled`, `.ctt-pd .ctt-link:disabled`, `.ctt-set .ctt-link:disabled`, `.ctt-set .ctt-switch:disabled`, `.ctt-btn:disabled` | one shared rule                                                                                                                                       | `.icon-button:disabled, .link-button:disabled, .toggle-switch:disabled { opacity: .4; cursor: not-allowed }` (note `.measure` variant has `cursor: default; text-decoration: none`, keep as `.link-button.is-flush:disabled` **(verify)**) |
| `.ctt-set-row.is-disabled`                                                                                                                           | `.settings-row.is-disabled`                                                                                                                           | unchanged declarations (label cannot use `:disabled`)                                                                                                                                                                                      |
| `.ctt-stat > .ctt-icon`, `.ctt-meta > .ctt-icon`, `.ctt-pchip > .ctt-icon`                                                                           | `.stat-icon`, `.meta-icon`, `.chip-icon` classes **(verify)**, or keep `.inline-icon` unchanged and move the contextual spacing to the parent's `gap` | removes the `>` combinator                                                                                                                                                                                                                 |

**Phase 2 checklist:** `Controls.css` created · duplicates deleted from the 3 old files · every consumer imports it · snapshot diff empty.

---

## 8. Phase 3: Settings dialog (`SettingsDialog.css/.tsx`, 29 rules)

This phase removes **one `!important` group and three IDs**.

### 3.1 Names

| Old                   | New                 | Notes                                                      |
| --------------------- | ------------------- | ---------------------------------------------------------- |
| `ctt-set-backdrop`    | `settings-backdrop` |                                                            |
| `ctt-set`             | `settings-dialog`   | root; keeps `role="dialog"`                                |
| `ctt-set-head`        | `settings-header`   |                                                            |
| `.ctt-set-head h2`    | `settings-heading`  | add class to `<h2>`                                        |
| `.ctt-set section`    | `settings-section`  | add class to each `<section>`                              |
| `.ctt-set h3`         | `settings-title`    | add class to `<h3>`                                        |
| `ctt-set-row`         | `settings-row`      |                                                            |
| `.ctt-set-row b`      | `settings-label`    | add class                                                  |
| `.ctt-set-row small`  | `settings-hint`     | add class (this is the _source_ of the `!important` fight) |
| `.ctt-set-row button` | `settings-button`   | add class (`flex: none`)                                   |
| `ctt-switch`          | `toggle-switch`     | moved in Phase 2                                           |
| `ctt-set-foot`        | `settings-footer`   |                                                            |
| `ctt-set-warn`        | `settings-warning`  |                                                            |
| `ctt-set-actions`     | `settings-actions`  |                                                            |
| `ctt-set-danger`      | `danger-button`     | Phase 2                                                    |
| `is-disabled`         | unchanged           |                                                            |

### 3.2 Remove `!important` on `.ctt-set-warn`

Current: `.ctt-set-warn { display:flex !important; align-items:center; gap:6px; margin-top:6px !important; color: var(--danger); opacity:1 !important }` because `.ctt-set-row small` (0,1,1) forces `display:block; opacity:.65; margin-top:1px`.
Fix: the description `<small>` gets `settings-hint` (carrying `display:block; opacity:.65; font-size:12px; margin-top:1px`) and the warning `<small role="note">` gets **only** `settings-warning`. The two no longer share a selector, so `settings-warning` becomes `display:flex; align-items:center; gap:6px; margin-top:6px; color: var(--danger)`. `opacity: 1` is the default, so it is dropped. **(verify)** that the warning's font-size still comes from the same place (add `font-size: 12px` to `settings-warning` if it was inherited from `.ctt-set-row small`).

### 3.3 Remove IDs

`#set-view`, `#set-layout`, `#set-data` all carry the same three declarations (`margin-top:16px; padding-top:12px; border-top:1px dashed var(--border)`), on top of `.ctt-set section { margin-top:16px }`.

- `settings-section` → `margin-top: 16px`
- `settings-section.has-divider` → `padding-top: 12px; border-top: 1px dashed var(--border)`
- In the TSX, add `has-divider` to the sections that currently own an id **(verify which sections have/lack ids; the first section may intentionally have no divider)**.
- The `id` attributes stay if used by `aria-labelledby`/anchors (D4); only the CSS stops using them.

### 3.4 Reduced motion

`.ctt-switch` and `.ctt-switch::after` (`transition: none`) already live in a reduced-motion block. Keep the block, renamed to `.toggle-switch`.

**Phase 3 checklist:** 0 `!important` · 0 IDs in CSS · 0 tag selectors · snapshot (dialog, warning, disabled row) diff empty.

---

## 9. Phase 4: Playback help (`PlaybackHelp.css/.tsx`, 15 rules)

| Old                    | New              | Notes                                    |
| ---------------------- | ---------------- | ---------------------------------------- |
| `ctt-ph-backdrop`      | `help-backdrop`  |                                          |
| `ctt-ph`               | `help-dialog`    |                                          |
| `.ctt-ph header`       | `help-header`    | add class                                |
| `.ctt-ph h2`           | `help-title`     | add class                                |
| `.ctt-ph p`            | `help-text`      | add class                                |
| `.ctt-ph code`         | `help-code`      | add class                                |
| `ctt-ph-steps`         | `help-steps`     |                                          |
| `ctt-ph-copy`          | `help-step`      | **(verify)** holds a step's text         |
| `.ctt-ph-copy span`    | `help-label`     | add class                                |
| `ctt-ph-alt`           | `help-alternate` | "alt" is an abbreviation                 |
| `ctt-ph-ok`            | `help-confirm`   | the OK button                            |
| `.ctt-ph footer`       | `help-footer`    | add class                                |
| `.ctt-ph footer label` | `help-option`    | add class (the "don't show again" label) |

**Phase 4 checklist:** 0 tag selectors · snapshot (dialog open) diff empty.

---

## 10. Phase 5: Gauges (`SpeedCluster.css` + `AltitudeCluster.css`, 110 rules)

### 5.1 Extract shared gauge styles

New file `src/components/instruments/Gauge.css` imported by both clusters. It contains everything that is used by both: `ctt-gt`, `-fill`, `-lbl`, `-needle`, `-bar`, and any rule in `AltitudeCluster.css` whose declarations are **byte-identical** to the speed version (`-seg`, `-tiles`, `-tile`, `-ico`, `-tx`, `-readout`, `-label`, `-mid`, `-dial`). Method: for each `ctt-alt-X` / `ctt-gt-X` pair, diff the declaration sets.

- identical → one shared `gauge-*` rule (and delete the `altitude-*` twin);
- different → shared base `gauge-*` plus a small, chained or descendant-from-root override in the altitude file (e.g. `.altitude-cluster .gauge-needle`), **never `!important`**.

### 5.2 Shared names

| Old                                       | New                                          | Notes                                                                                                                                                                       |
| ----------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ctt-gt`                                  | `gauge-cluster`                              | root; the `> *` child rule (`position:relative; z-index:1`) is kept via `.gauge-cluster > *` **or** a `gauge-part` class on children (**verify**: prefer the class, no `*`) |
| `ctt-gt-tach`                             | `gauge-tachometer`                           |                                                                                                                                                                             |
| `ctt-gt-dial`                             | `gauge-dial`                                 | `style={{'--f': f}}` is dynamic → **keep** as custom property                                                                                                               |
| `ctt-gt-bezel`                            | `gauge-bezel`                                |                                                                                                                                                                             |
| `ctt-gt-face`                             | `gauge-face`                                 |                                                                                                                                                                             |
| `ctt-gt-track`                            | `gauge-track`                                |                                                                                                                                                                             |
| `ctt-gt-fill`                             | `gauge-fill`                                 | shared                                                                                                                                                                      |
| `ctt-gt-red`                              | `gauge-redline`                              |                                                                                                                                                                             |
| `line.maj` / `line.min` / `line.red`      | `major-tick` / `minor-tick` / `redline-tick` | removes the `line.` qualifier and the one-letter-ish names `maj`, `min`, `red`                                                                                              |
| `ctt-gt-lbl`                              | `dial-label`                                 | svg text labels                                                                                                                                                             |
| `ctt-gt-label`                            | `gauge-label`                                | readout label (the old code has both `lbl` and `label`; keep them apart)                                                                                                    |
| `ctt-gt-cap`                              | `gauge-caption`                              |                                                                                                                                                                             |
| `ctt-gt-unit`                             | `gauge-unit`                                 |                                                                                                                                                                             |
| `ctt-gt-pill` / `-pill-cap` / `-pill-val` | `gauge-pill` / `pill-caption` / `pill-value` |                                                                                                                                                                             |
| `.ctt-gt-pill rect`                       | `pill-shape`                                 | add class to the svg `<rect>`                                                                                                                                               |
| `ctt-gt-badge` / `.ctt-gt-badge rect`     | `gauge-badge` / `badge-shape`                |                                                                                                                                                                             |
| `ctt-gt-needle`                           | `gauge-needle`                               | shared                                                                                                                                                                      |
| `ctt-gt-hub` / `-hub-dot`                 | `gauge-hub` / `hub-dot`                      |                                                                                                                                                                             |
| `ctt-gt-mid`                              | `gauge-middle`                               |                                                                                                                                                                             |
| `ctt-gt-seg` / `.ctt-gt-seg i`            | `gauge-segment` / `segment-cell`             | `<i>` becomes `<span className="segment-cell">` or keeps `<i>` with the class                                                                                               |
| `ctt-gt-readout`                          | `gauge-readout`                              |                                                                                                                                                                             |
| `ctt-gt-read`                             | `gauge-reading`                              | **(verify)** differs from `readout`                                                                                                                                         |
| `.ctt-gt-read b` / `span`                 | `reading-value` / `reading-unit`             | add classes                                                                                                                                                                 |
| `ctt-gt-tiles` / `-tile`                  | `gauge-tiles` / `gauge-tile`                 |                                                                                                                                                                             |
| `ctt-gt-ico`                              | `tile-icon`                                  |                                                                                                                                                                             |
| `ctt-gt-tx`                               | `tile-text`                                  |                                                                                                                                                                             |
| `.ctt-gt-tx em` / `b`                     | `tile-label` / `tile-value`                  | add classes                                                                                                                                                                 |
| `ctt-gt-bar` / `.ctt-gt-bar i`            | `gauge-bar` / `bar-fill`                     | shared (Altitude overrides `.ctt-alt .ctt-gt-bar i`)                                                                                                                        |
| `ctt-gt-hint`                             | `gauge-hint`                                 |                                                                                                                                                                             |

### 5.3 Altitude-specific names

| Old                                                    | New                                                                        | Notes                                                                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ctt-alt`                                              | `altitude-cluster`                                                         | used together with `gauge-cluster`                                                                                          |
| `ctt-alt-dial` / `-mid`                                | `altitude-dial` / `altitude-middle`                                        | unify with gauge if identical                                                                                               |
| `ctt-alt-seg` / `i`                                    | `gauge-segment` / `segment-cell`                                           | unify if identical                                                                                                          |
| `ctt-alt-readout` / `-label`                           | `gauge-readout` / `gauge-label`                                            | unify if identical                                                                                                          |
| `ctt-alt-big`                                          | `altitude-value`                                                           | the big number                                                                                                              |
| `ctt-alt-digits`                                       | `digit-row`                                                                |                                                                                                                             |
| `ctt-alt-col`                                          | `digit-column`                                                             | inline `opacity: hide ? 0 : 1` → class `is-hidden` (`.digit-column.is-hidden { opacity: 0 }`)                               |
| `ctt-alt-strip`                                        | `digit-strip`                                                              | inline `translateY(${-d}em)`: dynamic → `style={{'--digit': d}}` and CSS `transform: translateY(calc(var(--digit) * -1em))` |
| `.ctt-alt-strip span`                                  | `digit-glyph`                                                              | add class                                                                                                                   |
| `idle`                                                 | `is-idle`                                                                  | chained                                                                                                                     |
| `down`                                                 | `is-down`                                                                  | chained                                                                                                                     |
| `ctt-alt-unit`                                         | `altitude-unit`                                                            |                                                                                                                             |
| `ctt-alt-trend`                                        | `trend-indicator`                                                          |                                                                                                                             |
| `arrow`, `v`, `w`                                      | `trend-arrow`, and two modifiers **(verify in TSX what `v` and `w` mean)** | single letters are not allowed; likely `is-vertical`/`is-wide` or `is-rising`/`is-falling`                                  |
| `ctt-alt-asl`                                          | `sea-level-label`                                                          | "asl" = above sea level                                                                                                     |
| `ctt-alt-graph` / `-plot`                              | `altitude-graph` / `graph-plot`                                            |                                                                                                                             |
| `.ctt-alt-plot svg`                                    | `plot-graphic`                                                             | add class                                                                                                                   |
| `ctt-alt-grid` / `-tick` / `-ghost` / `-line` / `-dot` | `graph-grid` / `graph-tick` / `graph-ghost` / `graph-line` / `graph-dot`   |                                                                                                                             |
| `ctt-alt-pulse` (class and keyframes)                  | `graph-pulse` / `altitude-pulse`                                           |                                                                                                                             |
| `ctt-alt-start`                                        | `graph-start`                                                              |                                                                                                                             |
| `ctt-alt-tiles` / `-tile`                              | `gauge-tiles` / `gauge-tile`                                               | unify if identical                                                                                                          |
| `ctt-alt-ico` / `.ctt-alt-ico svg`                     | `tile-icon` / `icon-graphic`                                               | add class                                                                                                                   |
| `ctt-alt-tx` / `em` / `b` / `b small`                  | `tile-text` / `tile-label` / `tile-value` / `value-unit`                   | add classes                                                                                                                 |

### 5.4 Other

- `@container (max-width: 600/560/480px)` and `(max-height: 340/190px)` keep their conditions; only the selectors inside are renamed.
- The three reduced-motion blocks in Speed and five in Altitude stay in each file, with new names.
- `style={{'--f': f}}` (SpeedCluster.tsx:135) is justified: runtime value. No other inline styles in the gauges.
- The `ctt-alt` / `ctt-gt` class pair is applied in `AltitudeCluster.tsx:481` and `SpeedCluster.tsx` (both write `ctt-gt`): after the change a cluster has two root classes (`gauge-cluster altitude-cluster`).

**Phase 5 checklist:** shared file created · 0 tag selectors · 0 cross-file duplicates · snapshot at several gauge values and container sizes diff empty.

---

## 11. Phase 6: Projects UI (`ProjectsUI.css/.tsx`, 129 rules)

Every `p` in the old names means "project", which is why these are unreadable. All become `project-*`/descriptive words.

| Old                                              | New                                                                          | Notes                                                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ctt-pbar` / `-row`                              | `project-bar` / `project-row`                                                |                                                                                                |
| `ctt-pbar-new`                                   | `project-create`                                                             | "new project" button                                                                           |
| `ctt-ptray` / `-chips`                           | `project-tray` / `tray-chips`                                                |                                                                                                |
| `.ctt-ptray small`                               | `tray-hint`                                                                  | add class                                                                                      |
| `ctt-chip-drop`                                  | `drop-chip`                                                                  | modifiers `is-current`, `is-over`                                                              |
| `ctt-pgroup` + `is-plain`                        | `project-group` + `is-plain`                                                 |                                                                                                |
| `.ctt-pgroup > .ctt-list`                        | `plain-list` on the list itself                                              | removes `>`                                                                                    |
| `ctt-pempty` / `p`                               | `project-empty` / `empty-hint`                                               | add class                                                                                      |
| `ctt-psel`                                       | `project-select`                                                             |                                                                                                |
| `ctt-psel-btn` / `em`                            | `select-button` / `select-count`                                             | `is-open`                                                                                      |
| `ctt-psel-label`                                 | `select-label`                                                               |                                                                                                |
| `ctt-psel-list` / `li` / `li > span` / `em`      | `select-list` / `select-option` / `option-name` / `option-count`             | add classes; `is-all`, `is-hi`→`is-highlighted`, `is-on`                                       |
| `ctt-psel-chev` / `-ico`                         | `select-chevron` / `select-icon`                                             |                                                                                                |
| `ctt-phead`                                      | `project-header`                                                             |                                                                                                |
| `ctt-phead-title`                                | `project-title`                                                              |                                                                                                |
| `.ctt-phead-title h2` / `h3`                     | `title-main` / `title-sub`                                                   | add classes **(verify roles)**                                                                 |
| `ctt-phead-ico`                                  | `header-icon`                                                                |                                                                                                |
| `ctt-phead-sub` / `-container` / `-header`       | `project-subtitle`; the two wrappers likely collapse (**verify**; Phase 1.3) |                                                                                                |
| `ctt-phead-act`                                  | `project-actions`                                                            |                                                                                                |
| `ctt-pchips` / `ctt-pchip`                       | `project-chips` / `project-chip`                                             |                                                                                                |
| `ctt-pdetail`                                    | `project-detail`                                                             |                                                                                                |
| `ctt-pd`                                         | `detail-panel`                                                               |                                                                                                |
| `ctt-pd-head` / `h2`                             | `detail-header` / `detail-title`                                             | add class on `h2`                                                                              |
| `ctt-pd-info` / `-sub`                           | `detail-info` / `detail-subtitle`                                            |                                                                                                |
| `ctt-pd-empty` / `-none`                         | `detail-empty` / `detail-placeholder`                                        | **(verify)**                                                                                   |
| `ctt-pd-body` / `-act` / `-legend`               | `detail-body` / `detail-actions` / `detail-legend`                           |                                                                                                |
| `ctt-rn` / `input` / `ctt-rn-ok`                 | `rename-form` / `rename-input` / `rename-confirm`                            |                                                                                                |
| `ctt-toast`                                      | `toast-message`                                                              |                                                                                                |
| `ctt-toast-ico` / `-body`                        | `toast-icon` / `toast-body`                                                  |                                                                                                |
| `.ctt-toast-body strong` / `p` / `p b` / `small` | `toast-title` / `toast-text` / `toast-emphasis` / `toast-note`               | add classes                                                                                    |
| `.ctt-toast > .ctt-btn`                          | `toast-close`                                                                | add class                                                                                      |
| `ctt-toast-in` (keyframes)                       | `toast-enter`                                                                |                                                                                                |
| `ctt-pill` + `is-new`                            | `status-pill` + `is-new`                                                     |                                                                                                |
| `ctt-plist` / `ctt-pitem`                        | `project-list` / `project-item`                                              |                                                                                                |
| `.ctt-pitem em`                                  | `item-count`                                                                 | add class                                                                                      |
| `ctt-pitem-tx` / `b` / `small`                   | `item-text` / `item-title` / `item-note`                                     |                                                                                                |
| `ctt-pnew`                                       | `project-new`                                                                |                                                                                                |
| `ctt-pstack`                                     | `thumbnail-stack`                                                            | keeps `.project-thumbnail + .project-thumbnail`                                                |
| `ctt-pthumb` + `is-md`, `is-sm`, `is-empty`      | `project-thumbnail` + `is-medium`, `is-small`, `is-empty`                    | the TSX builds `is-${size}`; change `size` values from `md/sm` to `medium/small` (or map them) |
| `ctt-pnum`                                       | `project-number`                                                             |                                                                                                |
| `ctt-pbtn` + `is-primary`                        | `project-button` + `is-primary`                                              | keeps `[aria-pressed='true']` (D2)                                                             |
| `ctt-padd` / `small` / `ul` / `li`               | `add-panel` / `add-hint` / `add-list` / `add-item`                           | add classes                                                                                    |
| `ctt-pclips` / `li` / `li.is-drag`               | `clip-picker` / `clip-row` / `clip-row.is-dragging`                          | **(verify)**                                                                                   |
| `ctt-pupload`                                    | `project-upload`                                                             |                                                                                                |

### 6.1 Inline styles

`ProjectsUI.tsx:547` sets `--c` (clip color) and `backgroundImage: url(thumbnail)`:

- `--c` is dynamic: **keep** as custom property.
- `backgroundImage` → `style={{'--thumbnail': `url(${clip.thumbnail})`}}` and in CSS `background-image: var(--thumbnail)` (the rule lives in CSS, the data is the only inline part). Same for `ClipCard.tsx:159`.
- Everything else in this file is static and stays in CSS.

### 6.2 Reduced motion

5 reduced-motion rules and one `@media (max-width: 640px)` rule stay; rename inside.

**Phase 6 checklist:** 0 tag selectors · shared primitives imported from `Controls.css` · snapshot of tray/select/detail/toast/drag diff empty.

---

## 12. Phase 7: Clip-to-track (`ClipToTrack.css/.tsx`, 287 rules, the big one)

### 7.1 Split into focused files (D6)

Keep the cascade order by importing the new files in the order their rules appeared in `ClipToTrack.css`.

| New file               | Contents                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `AppShell.css`         | `app-shell`, `app-header`, `app-brand`, `brand-mark`, `brand-name`, `logo-*`, `app-layout`, `header-actions`, `side-panel` |
| `ClipCard.css`         | `clip-card`, `card-*`, `clip-thumbnail`, `track-badge`, `playing-indicator`, `equalizer*`                                  |
| `VideoModal.css`       | `video-modal`, `modal-*`                                                                                                   |
| `UploadZone.css`       | `upload-*`                                                                                                                 |
| `TrackMap.css`         | `map-*`, `measure-bar`, popups, `hides-*`                                                                                  |
| `MapToolbar.css`       | `map-toolbar`, `toolbar-*`, `dropdown-*`, `search-*`, `sort-*`, `progress-bar`                                             |
| `ElevationProfile.css` | `profile-*`, `split-*`, `pane-*`                                                                                           |

### 7.2 Names

**App shell**

| Old                                     | New                                          | Notes                                                                                                        |
| --------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `ctt-app`                               | `app-shell`                                  | also used on the popout (`ctt-app ctt-pop`)                                                                  |
| `ctt-header` / `-brand` / `-brand-text` | `app-header` / `app-brand` / `brand-name`    |                                                                                                              |
| `ctt-mark`                              | `brand-mark`                                 | **(verify)** may be unused                                                                                   |
| `ctt-logo` / `ctt-logo-accent`          | `logo-text` / `logo-accent`                  |                                                                                                              |
| `.ctt-logo b` / `i`                     | `logo-strong` / `logo-slant`                 | add classes in `Logo.tsx` **(verify which is accent)**                                                       |
| `ctt-tagline`                           | `brand-tagline`                              |                                                                                                              |
| `ctt-header-actions` / `button`         | `header-actions` / `header-button`           | add class to buttons                                                                                         |
| `ctt-layout`                            | `app-layout`                                 |                                                                                                              |
| `ctt-panel` / `-title` / `span`         | `side-panel` / `panel-title` / `panel-count` | `style={{ width: panelW }}`: runtime resize → `style={{'--panel-width': ...}}` + `width: var(--panel-width)` |
| `ctt-list`                              | `clip-list`                                  |                                                                                                              |

**Clip card** (`ClipCard.tsx`)

| Old                                                   | New                                                                  | Notes                                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `ctt-card` + `is-selected`, `is-playing`, `is-hidden` | `clip-card` + same                                                   |                                                                                         |
| `ctt-thumb` + `is-playable` / `ctt-thumb-hint`        | `clip-thumbnail` + `is-playable` / `thumbnail-hint`                  |                                                                                         |
| `ctt-card-body` / `-head` / `-head-container`         | `card-body` / `card-header` / `header-group`                         | container likely redundant (Phase 1.3)                                                  |
| `.ctt-card-head h3` / `p` / `p.ctt-place`             | `card-title` / `card-subtitle` / `card-place`                        | `ctt-place` and `p.` qualifier merge into `card-place`                                  |
| `ctt-quality` / `ctt-badge`                           | `quality-label` / `track-badge`                                      |                                                                                         |
| `ctt-controls` / `-stats` / `-stat` / `-meta`         | `card-controls` / `card-stats` / `stat-item` / `card-meta`           |                                                                                         |
| `ctt-playing`                                         | `playing-indicator`                                                  |                                                                                         |
| `ctt-eq` / `i` / `i:nth-child(2)`, `(3)`              | `equalizer` / `equalizer-bar` / `.equalizer-bar:nth-child(2)`, `(3)` | `nth-child` stays anchored on the class (D2-style exception, only for animation delays) |
| `ctt-eq` (keyframes)                                  | `equalizer-bounce`                                                   |                                                                                         |
| `ctt-more` / `> summary` / `[open]`                   | `more-menu` / `more-toggle` / `.more-menu[open]`                     | add class on `<summary>`; also `::-webkit-details-marker` hangs off `.more-toggle`      |
| `ctt-chev`                                            | `chevron-icon`                                                       |                                                                                         |
| `ctt-more-group` / `h4`                               | `more-group` / `group-title`                                         | add class                                                                               |
| `ctt-title-row`                                       | `title-row`                                                          |                                                                                         |

Inline style on `ClipCard.tsx:137` is only the `id` (D4); `style=` at `:159` handled in Phase 6.1.

**Video modal**

| Old                                                        | New                                                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `ctt-modal`                                                | `video-modal`                                                                          |
| `ctt-modal-box`                                            | `modal-box` (inline `--c` is dynamic: keep)                                            |
| `ctt-modal-head` / `small`                                 | `modal-header` / `modal-subtitle`                                                      |
| `ctt-modal-video`                                          | `modal-video`                                                                          |
| `ctt-video` / `-video-error` / `ctt-hint` / `ctt-hint-pad` | `video-frame` / `video-error` / `video-hint` / `video-hint` + `is-padded` **(verify)** |
| `is-hidden`                                                | unchanged                                                                              |

**Upload zone**

| Old                                    | New                                                            |
| -------------------------------------- | -------------------------------------------------------------- |
| `ctt-upload` + `is-over`, `is-busy`    | `upload-zone` + same                                           |
| `ctt-upload-ico`                       | `upload-icon`                                                  |
| `.ctt-upload-ico svg` (busy spinner)   | `icon-graphic` (add class)                                     |
| `.ctt-upload span` / `strong`          | `upload-hint` / `upload-title`                                 |
| `ctt-upload-file`                      | `upload-file`                                                  |
| `ctt-error` / `ctt-empty` / `h2` / `p` | `error-message` / `empty-state` / `empty-title` / `empty-text` |

**Map**

| Old                                                                                                 | New                                                                                           | Notes                                                                                                                 |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `ctt-mapcol`                                                                                        | `map-column`                                                                                  | `hide-zoom/gps/terrain/scale` → `hides-zoom`, `hides-location`, `hides-terrain`, `hides-scale` (GPS is an initialism) |
| `ctt-mapstage` / `ctt-map-wrap` / `ctt-map`                                                         | `map-stage` / `map-frame` / `map-canvas`                                                      |                                                                                                                       |
| `ctt-popup` / `ctt-popup-pinned`                                                                    | `map-popup` + `is-pinned`                                                                     | stays inside its own scope; maplibre inner selectors unchanged                                                        |
| `.ctt-popup .maplibregl-popup-content`, `.ctt-popup-pinned .maplibregl-popup-close-button` (+hover) | `.map-popup .maplibregl-popup-content`, `.map-popup.is-pinned .maplibregl-popup-close-button` | **third-party class names are the only allowed exception**; add `/* maplibre hook */`                                 |
| `.ctt-mapcol.hide-zoom .maplibregl-ctrl-group:has(.maplibregl-ctrl-zoom-in)`                        | `.map-column.hides-zoom .maplibregl-ctrl-group:has(.maplibregl-ctrl-zoom-in)`                 | same for gps/terrain/scale                                                                                            |
| `ctt-pop` / `-pop-head` / `-pop-num` / `-pop-tag` / `-pop-time` / `-pop-grid`                       | `point-popup` / `popup-header` / `popup-number` / `popup-tag` / `popup-time` / `popup-grid`   | `pointPopup.ts` uses `class="…"` inside an HTML string and `style="--c:…"` (dynamic, justified)                       |
| `.ctt-popup .ctt-pop-head strong`                                                                   | `popup-title`                                                                                 | add class in `pointPopup.ts`                                                                                          |
| `ctt-chips` / `ctt-chip` + `is-on`                                                                  | `chip-row` / `map-chip` + `is-on`                                                             | **(verify)**                                                                                                          |
| `ctt-coords` / `ctt-legend` / `.ctt-legend i`                                                       | `map-coordinates` / `map-legend` / `legend-swatch`                                            |                                                                                                                       |
| `ctt-measure`                                                                                       | `measure-bar`                                                                                 |                                                                                                                       |
| `ctt-resizer` + `is-dragging`, `is-resizing`                                                        | `panel-resizer` + same                                                                        |                                                                                                                       |

**Elevation profile** (`ElevationProfile.tsx`)

| Old                                            | New                                                                 | Notes                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ctt-prof`                                     | `profile-panel`                                                     | `--c` inline is dynamic                                                                             |
| `ctt-prof-grip` / `-head` / `-tabs` / `-view`  | `profile-grip` / `profile-header` / `profile-tabs` / `profile-view` |                                                                                                     |
| `.ctt-prof-view + .ctt-btn`                    | `profile-view` followed by a `profile-action` class on that button  | removes `+` dependency on the shared class                                                          |
| `ctt-tab` + `is-drop`                          | `profile-tab` + `is-target`                                         |                                                                                                     |
| `ctt-tab-split` / `button`                     | `split-tab` / grouped `.split-main, .split-close`                   | `all: unset; cursor: pointer; padding: 4px 9px`                                                     |
| `ctt-tab-split-main`                           | `split-main`                                                        |                                                                                                     |
| `ctt-tab-split-x`                              | `split-close`                                                       | **removes `!important`**, see 7.3                                                                   |
| `ctt-prof-body` / `-pane` / `-pane-head` / `b` | `profile-body` / `profile-pane` / `pane-header` / `pane-title`      | `.profile-pane + .profile-pane` stays                                                               |
| `ctt-prof-read` / `-plot` / `svg`              | `profile-readout` / `profile-plot` / `plot-graphic`                 |                                                                                                     |
| `ctt-prof-cross` / `-dot`                      | `profile-crosshair` / `profile-dot`                                 | inline `left`/`top` % are dynamic → `--x`, `--y` custom properties: `left: var(--x); top: var(--y)` |
| `ctt-prof-drop` / `-drop-half` / `span`        | `profile-dropzone` / `drop-half` / `drop-label`                     |                                                                                                     |
| `ctt-pane-pop`, `is-dial`                      | `pane-popover`, `is-dial`                                           | **(verify)**                                                                                        |

**Toolbar, dropdown, search, sort**

| Old                                                                | New                                                                                               | Notes                                                                                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `ctt-tb` / `> *` / `ctt-tb-group`                                  | `map-toolbar` / `toolbar-group`                                                                   | direct-child `*` rule: give children `toolbar-item`                                                                                            |
| `ctt-tb-btn` + `[data-tip]`                                        | `toolbar-button` + `has-tooltip`                                                                  | the tooltip text still reads `attr(data-tip)`; the selector moves from `[data-tip]` to `.has-tooltip` (D2 allows keeping `[data-tip]` instead) |
| `ctt-tb-menu` / `span`                                             | `toolbar-menu` / `menu-label`                                                                     |                                                                                                                                                |
| `ctt-dd-wrap` / `ctt-dd` / `> button` / `ctt-dd-note`              | `dropdown-anchor` / `dropdown-menu` / `dropdown-option` + `is-active` / `dropdown-note`           |                                                                                                                                                |
| `ctt-search` / `input` / `-ico` / `-clear`                         | `search-box` / `search-input` / `search-icon` / `search-clear`                                    |                                                                                                                                                |
| `ctt-search-dd` / `ul` / `li` / `li.is-active` / `strong` / `span` | `search-results` / `results-list` / `result-item` + `is-active` / `result-name` / `result-detail` |                                                                                                                                                |
| `ctt-bar` / `> i` / `is-indeterminate`                             | `progress-bar` / `progress-fill` / `is-indeterminate`                                             |                                                                                                                                                |
| `ctt-sort` / `-label` / `-chips` / `-chip` / `-dir`                | `sort-bar` / `sort-label` / `sort-chips` / `sort-chip` / `sort-direction`                         |                                                                                                                                                |

Keyframes: `ctt-pulse → marker-pulse`, `ctt-bob → icon-bob`, `ctt-slide → panel-slide`, `ctt-glow → card-glow`, `ctt-badge → badge-pop`.

### 7.3 Remove `!important` on `.ctt-tab-split-x`

Current: `.ctt-tab-split button { all: unset; cursor: pointer; padding: 4px 9px }` (0,1,1) beats `.ctt-tab-split-x { padding: 4px 7px 4px 5px }` (0,1,0), hence `!important`.
New (all single-class, source order decides):

```css
.split-main,
.split-close {
  all: unset;
  cursor: pointer;
  padding: 4px 9px;
}
.split-main {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.split-close {
  display: inline-flex;
  align-items: center;
  padding: 4px 7px 4px 5px;
  opacity: 0.6;
}
.split-close:hover,
.split-close:focus-visible {
  opacity: 1;
}
```

`.split-close` comes after the grouped rule, same specificity → its padding wins with no `!important`. Keep the existing `:focus-visible` outline rule for both (`outline: 2px solid var(--focus); outline-offset: -2px`). **(verify)** the order against the real file.

### 7.4 Other inline styles in this area

- `ClipToTrack.tsx:366` `width: panelW` → `--panel-width` (above).
- `ElevationProfile.tsx:171/175` `left`/`top` → `--x`/`--y`.
- `VideoModal.tsx:58`, `ElevationProfile.tsx:291`, `pointPopup.ts:65` `--c` → keep.
- `ClipCard.tsx:159` thumbnail → `--thumbnail`.

### 7.5 Reduced motion

Eleven reduced-motion rules already exist in this file. After the split each file keeps the block for its own animated classes.

**Phase 7 checklist:** 0 tag selectors · 0 `!important` · 7 smaller files · snapshot diff empty.

---

## 13. Phase 8: Global styles (`styles.css`) and the last `!important`

### 8.1 What stays

| Rule                                                                                                                                | Decision                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `:root` (tokens, `font-family`, `color`, `background`)                                                                              | stays unchanged (do not move `background` to `body`: it would alter canvas painting) |
| `*{box-sizing:border-box}`, `button{font:inherit;cursor:pointer}`, `input{font:inherit}`, `button:focus-visible`, `a:focus-visible` | one labelled `/* Reset */` block in `base.css` (D1)                                  |

### 8.2 What gets a class

| Old                                                      | New           | Where to add the class                    |
| -------------------------------------------------------- | ------------- | ----------------------------------------- |
| `body`                                                   | `app-page`    | `<body class="app-page">` in `index.html` |
| `main`                                                   | `home-main`   | home component                            |
| `h1`                                                     | `home-title`  | home component                            |
| `footer` (two rules, one in `@media (max-width: 620px)`) | `home-footer` | home component                            |

(Only if these rules survive Phase 1.1; if the home page is the dead legacy CSS, they are deleted.)

### 8.3 Replace `*{scroll-behavior:auto !important; transition:none !important}`

1. Grep every `transition`, `animation` and `scroll-behavior` in all CSS files.
2. Make sure each animated class has a counterpart in its **own** `@media (prefers-reduced-motion: reduce)` block (28 exist today). Add the missing ones (`transition: none; animation: none`).
3. `scroll-behavior`: if nothing sets `smooth`, the rule is a no-op and is deleted; if something does, put `scroll-behavior: smooth` inside `@media (prefers-reduced-motion: no-preference)` on the same selector.
4. Delete the `*` rule.
5. Check with the snapshot in reduced-motion mode that every animated element reports `transition-duration: 0s` / `animation-name: none`.

---

## 14. Phase 9: Enforcement and final verification

1. Re-run the audit that generated the map: expect 0 `!important`, 0 IDs, 0 missing-class selectors (except the Reset block and `:root`), 0 initial/long-name warnings, 0 inline-style warnings except custom properties.
2. Run `scripts/collision-check`: new names unique; none start with `ctt-`; none contain `__` or `--`.
3. grep the whole repo for every old class: must find 0 hits, including tests, markdown docs and e2e selectors.
4. Snapshot diff against the Phase 0 baseline: empty (normal and reduced-motion).
5. Build size check: CSS bytes should go **down** (dead styles + merged duplicates).
6. Optional (needs your OK to add a dev dependency): `stylelint` rules `declaration-no-important`, `selector-max-id: 0`, `selector-max-type: 0` (with the Reset block disabled by comment), `selector-class-pattern: ^(is|has|hides)-[a-z]+$|^[a-z]+-[a-z]+$` (plus the maplibre exception), `selector-max-compound-selectors: 3`. Otherwise the audit script is the gate.

---

## 15. Implementation order and effort

| Phase | Scope                                 | Risk                  |
| ----- | ------------------------------------- | --------------------- |
| 0     | tooling, baseline                     | none                  |
| 1     | dead CSS, duplicates                  | very low              |
| 2     | shared primitives                     | medium (cascade ties) |
| 3     | Settings (+ `!important`, IDs)        | low                   |
| 4     | Playback help                         | low                   |
| 5     | Gauges (+ shared file)                | medium                |
| 6     | Projects                              | medium                |
| 7     | Clip-to-track (+ `!important`, split) | highest               |
| 8     | Global styles (+ `!important`)        | low                   |
| 9     | Enforcement                           | none                  |

Each phase = one commit, with the snapshot diff attached.

## 16. Risks to watch

- **Class strings built at runtime** (`is-${size}`, template literals, maplibre options, HTML strings): the rename script alone will not catch them; Phase 0 inventory lists them.
- **Cascade ties between files** when moving rules: preserve import order, and prefer chained modifiers over relying on source order.
- **Tag → class changes touch the TSX**: purely additive (a new `className`), no markup or behavior changes.
- **Unknown roles** marked _(verify)_: I will read the TSX before renaming each one, and keep my guess only if it matches.
- Only the CSS map was provided; the CSS and TSX files themselves are needed for implementation.
