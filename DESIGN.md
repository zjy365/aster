---
name: Aster
description: Dense, achromatic, keyboard-first Kubernetes workbench.
version: beta
colors:
  window: "#0b0b0d"
  sidebar: "#131315"
  canvas: "#131315"
  raised: "#1b1b1e"
  overlay: "#222225"
  hover: "rgb(255 255 255 / 6%)"
  selected: "rgb(255 255 255 / 10%)"
  text: "#ececef"
  text-secondary: "#9b9ba2"
  faint: "#6d6d74"
  border: "rgb(255 255 255 / 8%)"
  border-strong: "rgb(255 255 255 / 14%)"
  accent: "#0a84ff"
  accent-soft: "rgb(10 132 255 / 18%)"
  aster-orange: "#e17b48"
  aster-orange-soft: "rgb(225 123 72 / 14%)"
  positive: "#30d158"
  caution: "#ffd60a"
  destructive: "#ff453a"
typography:
  display:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  compact:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.45
  mono:
    fontFamily: "JetBrains Mono, SF Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  compact: "4px"
  control: "6px"
  container: "8px"
  popover: "12px"
  pill: "999px"
spacing:
  tight: "4px"
  compact: "8px"
  control: "12px"
  gutter: "16px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "28px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "28px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "28px"
  toolbar-search-field:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 9px"
    height: "28px"
  source-list-item:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    typography: "{typography.compact}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "28px"
  source-list-item-active:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.text}"
    typography: "{typography.compact}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "28px"
  resource-table-row:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.compact}"
    rounded: "0"
    padding: "0 14px"
    height: "36px"
  resource-table-row-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.text}"
    typography: "{typography.compact}"
    rounded: "0"
    padding: "0 14px"
    height: "36px"
  status-badge:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
    height: "20px"
  tabs-pill:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    typography: "{typography.compact}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "28px"
  tabs-pill-active:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.text}"
    typography: "{typography.compact}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "28px"
  kbd-chip:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.faint}"
    typography: "{typography.mono}"
    rounded: "{rounded.compact}"
    padding: "2px 6px"
    height: "18px"
  dialog:
    backgroundColor: "{colors.overlay}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.popover}"
    padding: "16px"
---

# Design System: Aster

## Overview

**Creative North Star: "Dense Quiet Workbench"**

Aster is an achromatic, high-density, keyboard-first desktop workspace for Kubernetes. The interface is engineered, not decorated: near-monochrome surfaces stacked by tonal elevation, one interaction accent, status color confined to status marks, and every action reachable from the keyboard. The reference discipline comes from studying Linear's desktop app hands-on (see `specs/design-research/linear/PATTERNS.md`); the palette, type scale, and component specs below are Aster's own.

**Brand promise:** Make cluster state easy to scan, preserve context while users investigate, and make every write understandable and explicitly confirmed.

Its defining topology is a persistent Source List beside one continuous workspace, with a unified scope toolbar, dense resource table, and full-width detail flow.

**Key Characteristics:**

- Achromatic UI: neutrals carry hierarchy; color has exactly three jobs (interaction accent, brand identity, operational status)
- Tonal elevation ladder instead of shadows: canvas → raised → overlay
- Compact 28–36px rhythms; 36px virtualized table rows
- Inter for interface type, JetBrains Mono for data, weights 400–600 only
- Dark-first design: dark is the reference theme, light is derived role by role

### Brand Principles

- **Calm Precision:** Operational content leads; navigation and chrome recede. Every status, scope, and action label is exact.
- **Achromatic Discipline:** The resting interface contains no decorative color. Color appears only where it carries meaning.
- **Operational Confidence:** Show context, namespace, resource, permissions, and mutation impact at the point of action. Never surprise the operator.
- **Context Continuity:** Preserve source, scope, selection, scroll position, and back navigation as users move between lists, details, and commands.

## Colors

The palette is a neutral ladder with clearly separated jobs for interaction, identity, and status; dark is the reference theme and light retains the same semantic roles.

### Primary

- **Interaction Accent (blue):** Owns primary-action fills, focus rings, links, and active toggles. It does not own selection — selection is neutral (see Named Rules). Its soft companion provides tinted backgrounds behind accent-bearing elements.

### Secondary

- **Aster Orange:** Reserved for small product-identity signals (the mark, empty-state accents). Generic interface icons remain neutral. Orange never communicates selection, mutation, warning, or danger.

### Tertiary

- **Positive Green, Caution Amber, and Destructive Red:** Communicate health, warning, and failure or dangerous action. Status always includes a geometric mark or text in addition to color — never color alone.

### Neutral

- **Window, Sidebar, Canvas:** The frame and persistent source region share one canvas color — the workspace reads as a single calm field, not a stack of panels. Selection and content hierarchy come from the raised surface and text steps, not from sidebar shading.
- **Raised and Overlay:** The main content card and the settings card sit one step above the canvas (a 12px-radius white/dark surface); transient menus and dialogs sit one more step above that. Elevation is brightness, not shadow.
- **Hover and Selected:** Translucent white (dark) or black (light) washes. Selection is always a neutral fill plus primary-color text — no accent wash, no side stripe.
- **Primary, Secondary, Faint Text:** A three-step emphasis ladder for dense information; secondary and faint pairings must be contrast-tested on their actual surfaces.
- **Hairline Borders:** One-pixel strokes at 8% (dark) / 8% (light) luminance divide toolbars, tables, sections, and inputs; 14% for emphasized edges.

### Named Rules

**The Achromatic Rule.** The resting workspace is monochrome. Accent blue appears only on primary actions, focus rings, links, and active toggles; status colors appear only inside status marks; Aster orange appears only as identity.

**Selection Is Neutral.** Selected rows, items, and tabs use a neutral translucent fill with primary text. Accent-tinted selection washes are forbidden — they leak color into the resting workspace.

**The Semantic Color Rule.** Green, amber, and red are reserved for operational meaning and never serve as decoration.

## Themes

Aster supports `system`, `light`, and `dark`. `system` is the default and follows macOS appearance changes. Dark is the reference theme: new surfaces are designed dark-first, then mapped to light role by role. Renderer tokens, the native window background, native menus, scrollbars, and launch surfaces must resolve to the same appearance so the window never flashes or splits into mismatched themes.

| Semantic role | Dark (reference) | Light |
| --- | --- | --- |
| Window | `#0b0b0d` | `#ececee` |
| Sidebar | `#131315` | `#ececee` |
| Canvas | `#131315` | `#ececee` |
| Raised | `#1b1b1e` | `#ffffff` |
| Overlay | `#222225` | `#ffffff` |
| Hover wash | `rgb(255 255 255 / 6%)` | `rgb(0 0 0 / 4%)` |
| Selected wash | `rgb(255 255 255 / 10%)` | `rgb(0 0 0 / 7%)` |
| Primary text | `#ececef` | `#17171a` |
| Secondary text | `#9b9ba2` | `#66666d` |
| Faint text | `#6d6d74` | `#9a9aa1` |
| Border | `rgb(255 255 255 / 8%)` | `rgb(0 0 0 / 8%)` |
| Strong border | `rgb(255 255 255 / 14%)` | `rgb(0 0 0 / 14%)` |
| Accent (interaction) | `#0a84ff` | `#007aff` |
| Accent soft | `rgb(10 132 255 / 18%)` | `rgb(0 122 255 / 11%)` |
| Aster orange | `#e17b48` | `#c65f2d` |
| Aster orange soft | `rgb(225 123 72 / 14%)` | `rgb(198 95 45 / 10%)` |
| Positive | `#30d158` | `#18753a` |
| Caution | `#ffd60a` | `#9a6700` |
| Destructive | `#ff453a` | `#d70015` |

Dark and light are designed role by role, never produced by inversion. The canvas (window, sidebar, background) is one color in each theme — dark `#131315`, light `#ececee` — and the main content card floats on it as a single raised surface with 12px radius and no resting shadow; there is no vertical divider between the sidebar and the card. Semantic status must remain distinguishable without color. Release acceptance requires real packaged-app review of core workbench states in both appearances, plus increased-contrast and reduced-transparency system settings; this remains a gate until the evidence exists.

## Typography

**Interface Font:** Inter (bundled; OFL), with system sans fallbacks
**Data/Mono Font:** JetBrains Mono (bundled; OFL), with SF Mono and ui-monospace fallbacks

**Character:** One family, three weights (400/500/600 — 700 is forbidden), hierarchy built from size, weight, color step, and density. Inter's tabular figures are used wherever numbers align in columns.

### Hierarchy

- **Display:** A 22px/600 role for page-level titles (context picker, settings, empty states).
- **Headline:** A 16px/600 role for detail-view identity titles and section leads.
- **Title:** A 13px/600 role for card and section headings inside detail surfaces.
- **Body:** A 13px/400 role for core interface copy.
- **Compact:** A 12px/400 role for Source List items, table rows, and menu rows.
- **Label:** An 11px/500 role for metadata, toolbar controls, section labels, and badges; 10px is reserved for dense table chrome.
- **Mono:** A 12px role at 1.55 line-height for YAML, diffs, logs, terminal output, object identifiers, and keyboard hints.

### Named Rules

**The Three-Weight Rule.** 400, 500, and 600 are the only weights. Emphasis beyond 600 comes from color step or size, never from heavier fonts.

**The Keyboard Hint Rule.** Keyboard shortcuts always render as mono kbd chips beside the action they trigger — in buttons, menus, command rows, and empty states. Hints teach the keyboard path everywhere the mouse path exists.

## Layout

The desktop shell is a two-column grid: a persistent Source List at 232px and a flexible workspace. At widths below 1120px the Source List narrows to 212px; the application maintains a 900px minimum width. The unified toolbar is 48px high and spans the workspace, keeping history, namespace, search, safety, refresh, and appearance controls in one line.

On macOS, the titlebar reserves at least 76px at the leading edge for native traffic lights and drag space. Product branding belongs in the Context Picker content or Source List, never beside the traffic lights. Interactive controls inside a draggable titlebar are explicitly non-draggable. The chosen appearance is synchronized with the native window theme.

Resource browsing uses a 48px pane heading, a 32px table header, 36px virtualized rows, and a 32px footer. Detail replaces the list in the same workspace rather than opening a side inspector. The whole workspace column is one content card: a 12px-radius raised surface floating on the canvas with 12px margins (flush against the Source List), a transparent toolbar inside its top edge, and no vertical divider from the sidebar. Inside the card, Detail and cluster Overview share one summary language: border-defined cards (one-pixel hairline, 8px radius, raised fill) spaced by 12px gaps — grouping comes from the card edge and whitespace, not from nested hairlines or shadows. The detail readable column keeps its 1040px ceiling; on workspaces wider than 920px Overview adds a 288px card rail beside that column, for a combined ceiling of 1328px. Metadata grids run four columns, collapsing to three and then two as their own column narrows — measured with container queries against the main column. Short viewports below 720px reduce vertical ceremony without changing the information model.

Spacing follows a compact 4/8/12/16/24px rhythm. One-pixel gaps and hairlines are structural separators, not decorative texture. Long Kubernetes identifiers truncate in navigation and headers but wrap where the full value is the content. Line-oriented source surfaces such as YAML, manifests, and code preserve source whitespace and real line boundaries; they do not soft-wrap by default, and horizontal overflow stays inside the surface rather than expanding the workspace.

### Named Rules

**The Master-Detail Rule.** Lists are dense single-line rows; the selected object's full content replaces the list in the workspace. Narrow inspector sidebars are forbidden — a half-width detail serves neither the list nor the object.

## Elevation & Depth

Aster is flat by default. Elevation is expressed through the tonal ladder (canvas → raised → overlay), not through shadows; table rows, source items, and buttons carry no resting shadow. Transient surfaces — menus, select popovers, the command palette — may use one compact ambient shadow plus a fine ring to separate from the workspace beneath. Modal dialogs rely on a dimmed backdrop (`black / 50%`), a fine ring, and the overlay surface.

### Shadow Vocabulary

- **Popover Ambient:** A compact medium shadow for select and menu popovers only.
- **Dialog:** Backdrop dim plus ring; no large drop shadow.

### Named Rules

**The Flat-by-Default Rule.** Resting workspace surfaces remain shadowless; brightness steps and hairlines carry all hierarchy.

## Shapes

Corners are compact: 6px for controls and inputs, 8px for nested summary cards and containers, 12px for the main content card, settings card, transient dialogs, and the command palette, 4px for code blocks and kbd chips. Pills are reserved for statuses, badges, tabs, and kbd groups; table rows and full-width sections remain square so adjacent data reads as one continuous plane.

Borders are predominantly one-pixel neutral hairlines. Selection changes fill and text color rather than adding side stripes, thick outlines, or decorative framing.

## Components

### Implementation Foundation

shadcn's CLI and Base UI primitives provide accessible behavior, composition, and locally owned source code; they are not Aster's visual identity. Generated Button, Dialog, Select, Tabs, Tooltip, Dropdown Menu, and related primitives must be restyled through Aster's semantic tokens and interaction rules. Product-defining surfaces — Source List, unified toolbar, virtual resource table, resource detail, mutation review, and the command system — remain Aster components rather than imported visual templates.

### Buttons

- **Shape:** Compact 28px default height with 6px corners; 20–32px size variants serve tiny, standard, and icon actions.
- **Primary:** Accent-blue fill with white text for the single leading action in a local flow. The final fill/text pair must pass contrast review at the rendered label size.
- **Secondary / Outline:** One-pixel hairline border with primary text for ordinary operations and safe alternatives.
- **Ghost:** Transparent at rest; neutral hover fill and stronger text reveal affordance without adding chrome.
- **Hover / Focus / Active:** Color transitions run 100–150ms; focus uses a visible accent ring; press feedback changes color or brightness only — controls never scale, translate, or otherwise change geometry on press; disabled controls retain structure at reduced opacity.
- **Keyboard hints:** When a button has a shortcut, the hint renders as an inline kbd chip at the button's trailing edge.

### Chips and Kbd

- **Status chips:** 20px-high pills use neutral raised fills with a status mark; text or an icon always accompanies semantic color.
- **Kbd chips:** 18px-high, mono 11px, faint text on raised fill, 4px corners. Chord sequences render as separate chips joined by a quiet "then".

### Cards / Containers

- **Corner Style:** 8px for context groups and bounded containers; workspace tables and detail sections remain edge-to-edge and square.
- **Background:** Raised fill over the canvas; overlays (menus, palette, dialogs) use the overlay token.
- **Shadow Strategy:** None at rest.
- **Border:** One-pixel neutral hairline.
- **Internal Padding:** 8–16px for compact containers and 24px for detail sections.

### Inputs / Fields

- **Style:** Borderless by default on a raised fill — the toolbar search is 28px high with 6px corners and 9px horizontal inset. Placeholder text carries the prompt; no resting border.
- **Focus:** A compound field has exactly one focus indicator: the container's fill brightens one step and a 2px accent ring appears via `focus-within`; the inner input removes its own outline. Never a nested rectangle.
- **Error / Disabled:** Destructive ring for errors; disabled fields and actions preserve layout with reduced opacity.

### Navigation

The Source List is persistent, scrollable, and grouped with quiet 11px section labels. Items are 28px high with 16px leading icons in secondary text; hover uses the hover wash, while active navigation uses the selected wash with primary text — neutral, never accent-tinted. Navigation stays at no more than two visible hierarchy levels. Deep resource structure belongs in the workspace, not a tree nested inside the Source List. The Source List footer remains pinned so local-core state stays visible, but critical actions and errors do not live only at the bottom.

### Toolbar

The unified 48px toolbar uses stable semantic zones: navigation and scope at the leading edge, view context and search in the flexible center, and workspace-wide actions at the trailing edge. The trailing zone carries only actions that mean the same thing on every screen — refresh, appearance, settings — so the toolbar does not reshuffle as the user moves between list and detail. Object-scoped actions belong to the surface that names their target, not to the toolbar. Frequent actions remain visible; lower-frequency actions move into one More menu as the window narrows. Toolbar icons use labels or tooltips when meaning is not universal, and every command is also discoverable from the native menu or contextual command surface.

### Resource Table

The resource table is a dense, virtualized work surface rather than a collection of cards. Headers are 32px high in 11px label type with secondary text; rows are 36px high, and one-pixel dividers preserve scanning. Hover uses the hover wash; selection uses the selected wash with primary text — neutral, no accent, no side stripe. Numbers and ages right-align in tabular figures; names truncate with ellipsis; every row action is also on the keyboard.

**Status marks** are 8px geometric glyphs paired with readable status text — geometry carries the meaning so color is redundant: solid circle for Ready/Running, half circle for Progressing/Pending, hollow circle for Waiting/Unknown, crossed circle for Failed/Error, square for Stopped/Succeeded. The glyph uses the semantic color; the text uses the row's default color.

### Full Resource Detail

Resource detail occupies the full workspace and keeps the Source List and unified toolbar intact. A 64px identity header leads into pill tabs and border-separated sections. Metadata uses responsive definition grids; YAML, diffs, logs, terminal output, and operation history switch to the mono role. Mutation flows culminate in an explicit dry-run review dialog before apply.

**Object-scoped actions live in the identity header's trailing edge**, beside the name and namespace they operate on, and they never scroll away or disappear when the user changes tabs. Safe operations use the outline treatment; a single hairline divider separates them from the destructive action, which uses a tonal destructive fill with destructive text rather than a saturated red button — solid destructive fill is reserved for the confirm control inside the dry-run review dialog, where the commitment actually happens. Below the narrow breakpoint the safe operations collapse into one More menu while the destructive action stays visible; a menu is never the only route to a destructive action, and a destructive action is never the only visible one. Write feedback — dry-run state, failures, and permission reasons — renders in a live status line directly beneath the header so cause and effect stay adjacent.

Overview answers "is this healthy and what is it connected to" without tab-hopping. Kinds that expose replica counters lead with a stat-card row — one card per fact, a large tabular value over a quiet label; the status card carries a status mark, and the Desired card is itself the scale affordance when writes are allowed, reacting as a whole on hover; kinds without counters omit the row rather than render placeholder dashes. Workload overviews lead the main column with Conditions and a compact pod preview drawn from a selector-scoped, server-paginated pod list that also backs the dedicated Pods tab; selectors built on matchExpressions degrade to an explicit note instead of a wrong list. Container images render as name + mono reference rows with a copy affordance and the update-image action on the section. Where the workspace is wide enough, Overview splits into a main column of cards and a card rail for recent events (tinted circular type icons), kind-grouped related objects, labels, annotations, and session write history, each previewing a few entries and deferring to its dedicated tab. Section and rail counts render as quiet pills. Detail layout breakpoints are measured against the workspace container, not the window, because the Source List occupies a fixed leading column.

**Empty values are verbs.** An unset property renders as a muted action phrase in the property's position — not as a dash. Empty states follow one pattern everywhere: a quiet glyph or line illustration, one sentence naming the active scope and likely cause (permissions, filter), and a primary CTA with an inline kbd hint.

### Commands and Context Menus

Aster must converge on one typed command registry in the shared application layer, outside individual views. The Tauri Rust shell consumes its allowlisted command IDs to build native menus and dispatches them through the narrow typed bridge; renderer surfaces consume the same definitions for enablement, toolbar and More actions, row context menus, and the `Command-K` palette. Privileged data and execution remain in the Rust shell or the authenticated Core, never in the registry payload. A command declares its scope, availability, shortcut, permission requirement, danger level, and reversibility contract. `Enter` performs the primary local action, `Escape` closes or steps back, and standard macOS shortcuts are never repurposed. Right-click menus expose relevant row actions and make their keyboard shortcuts discoverable; they do not contain a separate capability set. Until the shared registry exists, do not describe the current hard-coded native menu and toolbar paths as unified.

**The command palette has two modes.** Global mode lists navigation, creation, and workspace commands grouped under quiet section labels. Contextual mode opens against the selected object: a context chip (kind + name) sits above the input, the command list is scoped to that object, and its commands prefer single-letter shortcuts. Switching objects while the palette is open swaps the context chip and rescopes the list.

### Feedback, Errors, and Mutation Safety

Recoverable errors appear where they occur with the affected object, reason, and next step. Connection failures use an inline banner or state inside the relevant source; table-load failures stay in the table region; empty states identify the active scope and likely permission or filter cause. Modal interruption is reserved for rare, consequential decisions.

Every write action exposes `cluster / namespace / resource` before execution. Undo is offered only when the operation has an explicit inverse and a resource-version guard that prevents overwriting newer cluster state. Irreversible or cluster-impacting actions require an explicit review that names the target and impact; destructive actions are never the default `Enter` choice. Dry-run output and the exact Diff remain visible before Apply.

### Motion

Motion explains causality rather than decorating routine work, and the default answer is stillness. Buttons, tags, chips, and list rows never scale, translate, or bounce on press; state changes are communicated through color, fill, and text alone. Menus, selects, popovers, and tooltips appear with an opacity-only fade of 100ms or less — no zoom, no slide, no transform — and close immediately or with the same short fade. Dialogs and their backdrops follow the same opacity-only rule. High-frequency keyboard paths feel immediate. Loading indicators do not become ambient animation, and `prefers-reduced-motion` removes remaining motion while preserving state feedback.

## Do's and Don'ts

### Do:

- **Do** preserve the persistent Source List, unified toolbar, dense resource table, and full-workspace detail topology.
- **Do** keep the resting workspace achromatic: neutrals for hierarchy, accent blue only on primary actions, focus rings, links, and active toggles.
- **Do** make selection a neutral fill with primary text — on rows, source items, tabs, and menu rows alike.
- **Do** express hierarchy with the tonal ladder (canvas → raised → overlay), one-pixel hairlines, compact spacing, and the three-step text ladder.
- **Do** render every keyboard shortcut as a kbd chip beside its action.
- **Do** pair every status color with a geometric status mark or text.
- **Do** render unset properties as muted verb phrases that perform the set action.
- **Do** keep renderer, native window, native menus, and launch background synchronized across `system`, light, and dark appearance.
- **Do** give compound controls one container-owned focus ring and verify every core screen at keyboard focus.
- **Do** route toolbar, context-menu, and shortcut actions through one command definition.
- **Do** design dark-first, then map roles to light; verify list, detail, split, empty, loading, error, long-name, narrow-window, light, and dark states before accepting a visual decision.

### Don't:

- **Don't** turn resource lists into cards; lists stay dense virtualized tables. Summary surfaces use the shared raised-card language — hairline edge, no shadows, no nested card-in-card.
- **Don't** add decorative chrome, ornamental borders, side stripes, accent-tinted selection, or resting shadows to the core workspace.
- **Don't** use Aster orange as the general interaction color or the accent blue as decorative branding.
- **Don't** introduce font weights beyond 400/500/600 or a second interface family.
- **Don't** copy Linear's implementation, assets, or brand color; the study informs patterns, not code.
- **Don't** hide mutation safety: dry-run state, exact Diff, and the final Apply action must remain explicit.
- **Don't** place the product mark or name beside macOS traffic lights, fake native window controls, or consume the titlebar drag region with controls.
- **Don't** draw a second focus outline on the input inside a compound search or select container.
- **Don't** create separate command behavior for the toolbar, right-click menu, and keyboard path.
