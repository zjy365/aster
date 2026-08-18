---
name: Aster
description: Quiet native Kubernetes workbench for deliberate cluster work.
version: alpha
colors:
  window: "#f5f5f7"
  sidebar: "#efeff1"
  surface: "#ffffff"
  surface-muted: "#f6f6f7"
  surface-hover: "#ededf0"
  text: "#1d1d1f"
  text-secondary: "#66666b"
  faint: "#68686d"
  border: "rgb(60 60 67 / 18%)"
  border-strong: "rgb(60 60 67 / 28%)"
  aster-orange: "#c65f2d"
  aster-orange-soft: "rgb(198 95 45 / 10%)"
  aster-orange-text: "#88401f"
  primary: "#007aff"
  system-blue-soft: "rgb(0 122 255 / 11%)"
  system-blue-deep: "#0059b7"
  positive: "#18753a"
  caution: "#9a6700"
  destructive: "#d70015"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, sans-serif"
    fontSize: "22px"
    fontWeight: 650
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, sans-serif"
    fontSize: "18px"
    fontWeight: 650
    letterSpacing: "-0.018em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 620
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  compact:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "0px"
  mono:
    fontFamily: "SF Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  compact: "4px"
  small: "5px"
  control: "6px"
  row: "7px"
  container: "9px"
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
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "28px"
  button-outline:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "28px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "28px"
  toolbar-search-field:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.row}"
    padding: "0 9px"
    height: "30px"
  context-picker-search-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.row}"
    padding: "0 9px"
    height: "32px"
  source-list-item:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    typography: "{typography.compact}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "29px"
  source-list-item-active:
    backgroundColor: "{colors.system-blue-soft}"
    textColor: "{colors.system-blue-deep}"
    typography: "{typography.compact}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "29px"
  resource-table-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.compact}"
    rounded: "0"
    padding: "0 14px"
    height: "38px"
  resource-table-row-selected:
    backgroundColor: "{colors.system-blue-soft}"
    textColor: "{colors.text}"
    typography: "{typography.compact}"
    rounded: "0"
    padding: "0 14px"
    height: "38px"
  status-badge:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
    height: "20px"
  tabs-line:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    typography: "{typography.body}"
    rounded: "0"
    padding: "0 6px"
    height: "38px"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.popover}"
    padding: "16px"
---

# Design System: Aster

## Overview

**Creative North Star: "Quiet Native Workbench"**

Aster is a restrained, professional, high-density desktop workspace. It feels native to macOS through system typography, compact controls, desktop conventions, calm neutral materials, and clear focus behavior—not through decorative chrome.

**Brand promise:** Make cluster state easy to scan, preserve context while users investigate, and make every write understandable and explicitly confirmed.

Its defining topology is a persistent Source List beside one continuous workspace, with a unified scope toolbar, dense resource table, and full-width detail flow. Aptakube authorizes that topology only; Aster's visual skin remains its own restrained combination of neutral layers, system-blue interaction, sparse orange identity, and border-led structure.

**Key Characteristics:**

- Persistent Source List and one uninterrupted work area
- Compact 29–38px navigation, control, and table rhythms
- System blue for interaction, Aster orange for identity, semantic color for status
- Flat tonal layering with fine separators and shadow reserved for overlays
- Full-width resource detail that preserves navigation context

### Brand Principles

- **Calm Precision:** Operational content leads; navigation and chrome recede. Every status, scope, and action label is exact.
- **Native Clarity:** Respect macOS window, menu, keyboard, focus, theme, and motion expectations before adding custom visual treatment.
- **Operational Confidence:** Show context, namespace, resource, permissions, and mutation impact at the point of action. Never surprise the operator.
- **Context Continuity:** Preserve source, scope, selection, scroll position, and back navigation as users move between lists, details, and commands.

## Colors

The palette is a cool macOS-like neutral field with clearly separated jobs for interaction, identity, and status; light and dark themes retain the same semantic roles.

### Primary

- **System Interaction Blue:** Owns selection, focus, active navigation, links, and primary actions. Its soft and deep companions provide selected backgrounds and legible selected text.

### Secondary

- **Aster Orange:** Is reserved for small product-identity signals. Generic interface icons remain neutral. Orange never communicates selection, mutation, warning, or danger. The Dock icon and in-app Gauge are currently different symbols; until one canonical mark is explicitly approved, neither is treated as the brand standard and no third symbol is introduced.

### Tertiary

- **Positive Green, Caution Amber, and Destructive Red:** Communicate health, warning, and failure or dangerous action. Status always includes text, iconography, or structure in addition to color.

### Neutral

- **Window and Sidebar Neutrals:** Separate the desktop frame and persistent source region through tonal contrast.
- **Surface, Muted Surface, and Hover Surface:** Build the workspace hierarchy through tonal layering and border-defined cards, never resting shadows.
- **Primary, Secondary, and Faint Text:** Support dense information with a deliberate three-step emphasis ladder; secondary and microcopy pairings must be contrast-tested on their actual light and dark surfaces.
- **Hairline Borders:** Divide toolbars, tables, sections, and inputs with low-contrast system-like strokes.

### Named Rules

**The Two Accents, Two Jobs Rule.** System blue owns interaction; Aster orange owns identity. Do not swap their roles or let either dominate the neutral workspace.

**The Semantic Color Rule.** Green, amber, and red are reserved for operational meaning and never serve as decoration.

## Themes

Aster supports `system`, `light`, and `dark`. `system` is the default and follows macOS appearance changes. Renderer tokens, Electron window background, native menus, scrollbars, and launch surfaces must resolve to the same appearance so the window never flashes or splits into mismatched themes.

| Semantic role | Light | Dark |
| --- | --- | --- |
| Window | `#f5f5f7` | `#1c1c1e` |
| Sidebar | `#efeff1` | `#232326` |
| Surface | `#ffffff` | `#1c1c1e` |
| Muted surface | `#f6f6f7` | `#252528` |
| Hover surface | `#ededf0` | `#303034` |
| Primary text | `#1d1d1f` | `#f5f5f7` |
| Secondary text | `#66666b` | `#aeaeb2` |
| Faint text | `#68686d` | `#8e8e93` |
| Border | `rgb(60 60 67 / 18%)` | `rgb(84 84 88 / 55%)` |
| Strong border | `rgb(60 60 67 / 28%)` | `rgb(99 99 102 / 75%)` |
| Aster orange | `#c65f2d` | `#e17b48` |
| Aster orange soft | `rgb(198 95 45 / 10%)` | `rgb(225 123 72 / 14%)` |
| Aster orange text | `#88401f` | `#ffab7d` |
| System blue | `#007aff` | `#0a84ff` |
| System blue soft | `rgb(0 122 255 / 11%)` | `rgb(10 132 255 / 18%)` |
| Source-list active text | `#0059b7` | `#d9ecff` |
| Positive | `#18753a` | `#30d158` |
| Caution | `#9a6700` | `#ffd60a` |
| Destructive | `#d70015` | `#ff453a` |

Dark mode is designed role by role, not produced by inverting light mode. Semantic status must remain distinguishable without color. Release acceptance requires real Electron review of core workbench states in both appearances, plus increased-contrast and reduced-transparency system settings; this remains a gate until the evidence exists.

## Typography

**Display Font:** macOS system sans with Segoe UI fallback  
**Body Font:** macOS system sans with Segoe UI fallback  
**Label/Mono Font:** SF Mono with UI monospace fallback

**Character:** The type system is compact, familiar, and information-first. Weight and subtle negative tracking create hierarchy while the family remains consistently native.

### Hierarchy

- **Display:** A 22px semibold role for the context picker title and largest entry headings.
- **Headline:** An 18px semibold role for resource-list and resource-detail titles.
- **Title:** A 14px semibold role for detail section headings.
- **Body:** A 13px regular role for core interface copy and context descriptions.
- **Compact:** A 12px regular role for Source List items and resource-table rows.
- **Label:** An 11px medium-to-semibold role for metadata, toolbar controls, secondary copy, and compact UI labels; 10px is reserved for dense table chrome and badges.
- **Mono:** An 11px role at 1.55 line-height for YAML, diffs, logs, terminal output, object identifiers, and operation history.

### Named Rules

**The Native Type Rule.** Build hierarchy with size, weight, and density inside the system stack; do not introduce a decorative display face into the workbench.

## Layout

The desktop shell is a two-column grid: a persistent Source List at 236px and a flexible workspace. At widths below 1120px the Source List narrows to 216px; below 960px labels compress selectively while the desktop application maintains a 900px minimum width. The top toolbar is 52px high and spans the workspace, keeping history, namespace, search, safety, refresh, and appearance controls in one line.

On macOS, the titlebar is 52px high and reserves at least 76px at the leading edge for native traffic lights and drag space. Product branding belongs in the Context Picker content or Source List, never beside the traffic lights. Interactive controls inside a draggable titlebar are explicitly non-draggable. The chosen appearance is synchronized with Electron's native window theme.

Resource browsing uses a 64px pane heading, a 34px table header, 38px virtualized rows, and a 34px footer. Detail replaces the list in the same workspace rather than opening a side inspector. Detail and cluster Overview share one summary language: border-defined cards (one-pixel hairline, 10px radius, surface fill) spaced by 12px gaps on a 16px page margin — grouping comes from the card edge and whitespace, not from nested hairlines or shadows. The detail readable column keeps its 1040px ceiling; on workspaces wider than 920px Overview adds a 288px card rail beside that column, for a combined ceiling of 1328px, so common window widths already gain the two-column density instead of stacking into one long column. Metadata grids run four columns, collapsing to three and then two as their own column narrows — measured with container queries against the main column, since the main column is narrower than the workspace whenever the aside is present. Short viewports below 720px reduce vertical ceremony without changing the information model.

Spacing follows a compact 4/8/12/16/24px rhythm. One-pixel gaps and hairlines are structural separators, not decorative texture. Long Kubernetes identifiers truncate in navigation and headers but wrap where the full value is the content.

## Elevation & Depth

Aster is flat by default. Window, sidebar, workspace, muted controls, hover states, and selected states separate through tonal layering and hairline borders; table rows, source items, context rows, and buttons carry no resting shadow. Popovers may use one compact ambient shadow, while modal dialogs rely primarily on a dark backdrop, a fine ring, and a raised surface.

### Shadow Vocabulary

- **Popover Ambient:** A compact medium shadow for select and menu popovers only; it distinguishes a transient floating plane from the workbench beneath it.

### Named Rules

**The Flat-by-Default Rule.** Resting workspace surfaces remain shadowless; elevation is reserved for modal and popover layers.

## Shapes

Corners are gently compact rather than pillowy. Dense controls and source items use 6–7px radii, bordered containers use 9px, and transient dialogs use 12px. Code blocks and tiny action surfaces tighten to 4–5px. Pills are reserved for statuses and compact badges; table rows and full-width sections remain square so adjacent data reads as one continuous plane.

Borders are predominantly one-pixel neutral hairlines. Selection changes fill and text color rather than adding side stripes, thick outlines, or decorative framing.

## Components

### Implementation Foundation

shadcn's CLI and Base UI primitives provide accessible behavior, composition, and locally owned source code; they are not Aster's visual identity. Generated Button, Dialog, Select, Tabs, Tooltip, Dropdown Menu, and related primitives must be restyled through Aster's semantic tokens and interaction rules. Product-defining surfaces—Source List, unified toolbar, virtual resource table, resource detail, mutation review, and the command system—remain Aster components rather than imported visual templates.

### Buttons

- **Shape:** Compact 28px default height with gently curved 6px corners; 20–32px size variants serve tiny, standard, and icon actions.
- **Primary:** System-blue fill with white text for the single leading action in a local flow. The final fill/text pair must pass contrast review at the rendered label size rather than being assumed safe from the color role.
- **Secondary / Outline:** Muted neutral fill or hairline border for ordinary operations and safe alternatives.
- **Ghost:** Transparent at rest; neutral hover fill and stronger text reveal affordance without adding chrome.
- **Hover / Focus / Active:** Color transitions run 100–150ms; focus uses a visible system-blue ring; press feedback changes color or brightness only—controls never scale, translate, or otherwise change geometry on press; disabled controls retain structure at reduced opacity.

### Chips

- **Style:** 20px-high pills use neutral, positive, or destructive tonal fills and compact 10px labels.
- **State:** Text or an icon always accompanies semantic color. Badges annotate state; they do not become primary navigation.

### Cards / Containers

- **Corner Style:** Context groups and bounded lists use 9px corners; workspace tables and detail sections remain edge-to-edge and square.
- **Background:** White or theme-equivalent surface over a slightly contrasting window/sidebar layer.
- **Shadow Strategy:** None at rest; rely on hairlines and tonal fill.
- **Border:** One-pixel neutral hairline.
- **Internal Padding:** 8–16px for compact containers and 24px for detail sections.

### Inputs / Fields

- **Style:** The toolbar search is 30px high on the muted surface; the Context Picker search is 32px high on the main surface. Both use a one-pixel input border, 7px corners, and 9px horizontal inset.
- **Focus:** A compound field has exactly one focus ring, drawn by its outer container with `focus-within`; the inner input removes its own border, outline, and ring. The result is one continuous 2px system-blue focus indicator, never the nested rectangle seen in web-form defaults.
- **Error / Disabled:** Destructive border/ring for errors; disabled fields and actions preserve layout with reduced opacity.

### Navigation

The Source List is persistent, scrollable, and grouped with quiet 10px labels. Items are 29px high with compact leading icons; hover uses a translucent surface, while active navigation uses a system-blue tonal fill and deep-blue text. Navigation stays at no more than two visible hierarchy levels. Deep resource structure belongs in the workspace, not a tree nested inside the Source List. The Source List footer remains pinned so local-core state stays visible, but critical actions and errors do not live only at the bottom.

### Toolbar

The unified 52px toolbar uses stable semantic zones: navigation and scope at the leading edge, view context and search in the flexible center, and workspace-wide actions at the trailing edge. The trailing zone carries only actions that mean the same thing on every screen — refresh, appearance, settings — so the toolbar does not reshuffle as the user moves between list and detail. Object-scoped actions belong to the surface that names their target, not to the toolbar; see Full Resource Detail. Frequent actions remain visible; lower-frequency actions move into one More menu as the window narrows. Toolbar icons use labels or tooltips when meaning is not universal, and every command is also discoverable from the native menu or contextual command surface.

### Resource Table

The resource table is a dense, virtualized work surface rather than a collection of cards. Headers are 34px high, rows are 38px high, and one-pixel dividers preserve scanning. Hover uses the neutral hover surface; selection uses a low-chroma system-blue wash with no side stripe. Status dots are always paired with readable status text.

### Full Resource Detail

Resource detail occupies the full workspace and keeps the Source List and unified toolbar intact. A 72px identity header leads into line-style tabs and border-separated sections. Metadata uses responsive definition grids; YAML, diffs, logs, terminal output, and operation history switch to the mono role. Mutation flows culminate in an explicit dry-run review dialog before apply.

**Object-scoped actions live in the identity header's trailing edge**, beside the name and namespace they operate on, and they never scroll away or disappear when the user changes tabs. Safe operations use the outline treatment; a single hairline divider separates them from the destructive action, which uses a tonal destructive fill with destructive text rather than a saturated red button — solid destructive fill is reserved for the confirm control inside the dry-run review dialog, where the commitment actually happens. Below the narrow breakpoint the safe operations collapse into one More menu while the destructive action stays visible; a menu is never the only route to a destructive action, and a destructive action is never the only visible one. Write feedback — dry-run state, failures, and permission reasons — renders in a live status line directly beneath the header so cause and effect stay adjacent.

Overview answers "is this healthy and what is it connected to" without tab-hopping. Kinds that expose replica counters lead with a stat-card row — one card per fact, a large tabular value over a quiet label, echoing the cluster Overview's cards; the status card carries a semantic dot, and the Desired card is itself the scale affordance when writes are allowed, reacting as a whole on hover; kinds without counters omit the row rather than render placeholder dashes. Workload overviews lead the main column with Conditions and a compact pod preview drawn from a selector-scoped, server-paginated pod list that also backs the dedicated Pods tab; selectors built on matchExpressions degrade to an explicit note instead of a wrong list. Container images render as name + mono reference rows with a copy affordance and the update-image action on the section. Where the workspace is wide enough, Overview splits into a main column of cards for conditions, pods, identity, and configuration and a card rail for recent events (tinted circular type icons, as on the cluster Overview), kind-grouped related objects, labels, annotations, and session write history, each previewing a few entries and deferring to its dedicated tab. Section and rail counts render as quiet pills. Detail layout breakpoints are measured against the workspace container, not the window, because the Source List occupies a fixed leading column.

### Commands and Context Menus

Aster must converge on one typed command registry in the shared application layer, outside individual views. Electron main consumes its allowlisted command IDs to build native menus and dispatches them through the narrow preload bridge; renderer surfaces consume the same definitions for enablement, toolbar and More actions, row context menus, and the future `Command-K` palette. Privileged data and execution remain in main or the authenticated Core, never in the registry payload. A command declares its scope, availability, shortcut, permission requirement, danger level, and reversibility contract. `Enter` performs the primary local action, `Escape` closes or steps back, and standard macOS shortcuts are never repurposed. Right-click menus expose relevant row actions and make their keyboard shortcuts discoverable; they do not contain a separate capability set. Until the shared registry exists, do not describe the current hard-coded native menu and toolbar paths as unified.

### Feedback, Errors, and Mutation Safety

Recoverable errors appear where they occur with the affected object, reason, and next step. Connection failures use an inline banner or state inside the relevant source; table-load failures stay in the table region; empty states identify the active scope and likely permission or filter cause. Modal interruption is reserved for rare, consequential decisions.

Every write action exposes `cluster / namespace / resource` before execution. Undo is offered only when the operation has an explicit inverse and a resource-version guard that prevents overwriting newer cluster state. Irreversible or cluster-impacting actions require an explicit review that names the target and impact; destructive actions are never the default `Enter` choice. Dry-run output and the exact Diff remain visible before Apply.

### Motion

Motion explains causality rather than decorating routine work, and the default answer is stillness. Buttons, tags, chips, and list rows never scale, translate, or bounce on press; state changes are communicated through color, fill, and text alone. Menus, selects, popovers, and tooltips appear with an opacity-only fade of 100ms or less—no zoom, no slide, no transform—and close immediately or with the same short fade. Dialogs and their backdrops follow the same opacity-only rule. High-frequency keyboard paths feel immediate. Loading indicators do not become ambient animation, and `prefers-reduced-motion` removes remaining motion while preserving state feedback.

## Do's and Don'ts

### Do:

- **Do** preserve the persistent Source List, unified toolbar, dense resource table, and full-workspace detail topology.
- **Do** use system blue for focus, selection, navigation, and primary actions; keep Aster orange rare and brand-specific.
- **Do** express hierarchy with neutral tonal layers, one-pixel separators, compact spacing, and clear type weight.
- **Do** keep primary workflows keyboard-operable, visibly focused, and compatible with reduced motion.
- **Do** pair every status color with text, an icon, or another non-color cue.
- **Do** keep renderer, native window, native menus, and launch background synchronized across `system`, light, and dark appearance.
- **Do** give compound controls one container-owned focus ring and verify every core screen at keyboard focus.
- **Do** route toolbar, context-menu, and shortcut actions through one command definition.
- **Do** test list, detail, split, empty, loading, error, long-name, narrow-window, light, and dark states before accepting a visual decision.

### Don't:

- **Don't** turn resource lists into cards; lists stay dense virtualized tables. Summary surfaces (cluster Overview, detail Overview) use the shared border-defined card language — hairline edge, no shadows, no nested card-in-card.
- **Don't** add decorative chrome, ornamental borders, side stripes, or resting shadows to the core workspace.
- **Don't** borrow Aptakube's visual skin; only its approved workbench topology is part of Aster's system.
- **Don't** use Aster orange as the general interaction color or system blue as decorative branding.
- **Don't** hide mutation safety: dry-run state, exact Diff, and the final Apply action must remain explicit.
- **Don't** place the product mark or name beside macOS traffic lights, fake native window controls, or consume the titlebar drag region with controls.
- **Don't** draw a second focus outline on the input inside a bordered search or select container.
- **Don't** create separate command behavior for the toolbar, right-click menu, and keyboard path.
