# Form Builder — UI review (Claude-in-Chrome walkthrough)

Live review of the admin at localhost:5173 across Overview, Builder (Content +
field settings + Design), Preview, Config, Install, Submissions. Findings by
severity; feeds the combined improvement punch-list.

## Cross-screen / global
- **G1 (P2) Low-contrast secondary text.** Created dates (Overview), table
  column headers ("Submitted"/"Preview" on Submissions), and some helper text
  render as very light gray on white — borderline/below WCAG AA. Darken
  secondary text to >=4.5:1 (or use the theme muted token consistently).
- **G2 (P2) Sparse density.** Overview + Submissions rows are tall with large
  empty whitespace; tighten row height / vertical rhythm for a denser, more
  professional table.

## Builder (highest-value UI gaps)
- **B1 (P1) Fields palette is one long vertical scroll** of 18 types. Group into
  sections ("Input fields" vs "Layout blocks": heading/divider/paragraph/image)
  and/or a 2-column grid, ideally with a small icon per type, so it is scannable
  without heavy scrolling.
- **B2 (P1) No live preview while editing.** Design/content changes are only
  visible by switching to a separate full-screen Preview mode. Add a persistent
  live preview pane beside the controls (or a split view) so merchants see
  changes as they make them (matches Typeform/Tally/Fillout).
- **B3 (P2) Weak field-row affordance.** Canvas rows show only a delete icon;
  "click to edit" is not signposted and the drag handle is faint. Add an edit
  affordance + stronger drag handle / hover state.
- **B4 (P2) Preset swatches are tiny 3-dot previews.** A mini themed form
  thumbnail per preset would communicate each look far better.

## Design tab
- Accordion fix confirmed (one section open at a time) — good, no longer an
  overwhelming scroll.
- **D1 (P2)** Consider a "reset to default" and showing the current numeric
  values inline (some sliders already do; make consistent).

## Preview
- **PV1 (P2)** State tabs (Ready/Success/Error/Closed) are plain small text —
  render as a segmented control for clarity; mark the active state more strongly.

## Install
- **IN1 (P2)** The "2 steps per page" label top-right reads as a stray/odd
  string — verify the copy and fix or remove.

## Config
- Clean; well-labeled cards with helper text. No issues.

## Notes
- Field settings panel (select a field) is clean: Label, Key + hint, Required,
  Width, Validation. Good.
- The flower-everywhere look in the demo form is intentional TEST data
  (background=image + logo + cover + image block all set to a Cloudinary sample),
  not a default and not a bug.

## Additional bugs found during live testing (queued)
- **B5 (P1) "Input style" Segmented overflows in per-field "Advanced style".** The
  4-option Segmented (Inherit/Outlined/Filled/Underlined) is too wide for the
  narrow settings panel, so "Underlined" breaks out of the control. Rendered in
  builder.$formId.tsx (per-field override section). Fix: make the Segmented wrap
  / full-width / smaller, or use a Select when >3 options. MUST wait until the
  UI-improvements workflow finishes editing builder.$formId.tsx (collision).
- **B6 (P2) Validation Min/Max row misalignment** when the Max-length label wraps
  ("Max length (<= 10000)") — inputs sit at different heights. In
  fields/text|textarea/settings.tsx. (Being fixed by a dedicated subagent now.)
- **B7 (P1) Palette labels truncate with ellipsis.** The new grouped 2-column
  palette (B1) has cells too narrow for longer labels, so "Paragraph", "Dropdown",
  "Multi-select", "File upload", "Checkbox", "Text block" render as "Paragr…" etc.
  — unreadable. Fix: labels must show fully (wrap to 2 lines, smaller font, wider
  cells, or shorter display names). In the palette component (builder.$formId.tsx
  / FieldPalette). Fix with B5 in the builder pass after the UI workflow lands.
- **B8 (P1) Design-tab `Row` squeezes long labels to vertical / mid-word wrap.**
  The shared Row (label + control side-by-side) in DesignSettings.tsx gives the
  label a too-narrow column, so long labels render one-char-per-line ("Logo URL",
  "Cover image URL", "Input style") or break mid-word ("Button size", "Button
  alignment"). Fix: make Row STACK label above control (like fields/_shared
  SettingRow) so labels are never squeezed. Fixes the whole Design tab at once.
  In DesignSettings.tsx (Row helper). After the follow-up workflow releases it.
