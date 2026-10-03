---
name: QueueUp
description: Tickets that never oversell, shown on a ballpark scoreboard that is live, counted, and never wrong.
colors:
  board: "#1f4a35"
  board-deep: "#12291d"
  board-rule: "#2e5d46"
  board-text: "#f2f3ec"
  board-muted: "#a9c2b3"
  plate: "#f2f3ec"
  plate-ink: "#0f1d15"
  bulb: "#ffb000"
  bulb-off: "#0b1811"
  out: "#e0442f"
  paper: "#e6eae2"
  card: "#f6f7f2"
  ink: "#0f1d15"
  muted: "#4b5c51"
  line: "#c3cdc2"
  ok: "#17713f"
  warn: "#9a6200"
  bad: "#b8301f"
typography:
  display:
    fontFamily: "Big Shoulders Stencil, Big Shoulders, sans-serif"
    fontSize: "clamp(3rem, 5.4vw, 4.75rem)"
    fontWeight: 800
    lineHeight: 0.9
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Big Shoulders Stencil, Big Shoulders, sans-serif"
    fontSize: "clamp(2.2rem, 4.6vw, 3.75rem)"
    fontWeight: 800
    lineHeight: 0.92
  title:
    fontFamily: "Big Shoulders, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.02em"
  numeral:
    fontFamily: "Big Shoulders, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 800
    lineHeight: 1
    fontFeature: "tnum"
  button:
    fontFamily: "Big Shoulders, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "0.06em"
  body:
    fontFamily: "Barlow, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "Big Shoulders, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.14em"
  code:
    fontFamily: "JetBrains Mono, monospace"
    fontSize: "11px"
    fontWeight: 400
rounded:
  chip: "2px"
  plate: "3px"
  panel: "4px"
  bulb: "9999px"
spacing:
  m-third: "8px"
  m-half: "12px"
  m-three-quarter: "18px"
  m: "24px"
  m-1-5: "36px"
  m-2: "48px"
  m-3: "72px"
  m-4: "96px"
components:
  button-plate:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.plate-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.plate}"
    padding: "14px 16px"
  button-plate-hover:
    backgroundColor: "#ffffff"
    textColor: "{colors.plate-ink}"
  button-board-outline:
    backgroundColor: "{colors.board}"
    textColor: "{colors.board-text}"
    rounded: "{rounded.plate}"
    padding: "6px 12px"
  button-primary:
    backgroundColor: "{colors.board}"
    textColor: "{colors.plate}"
    rounded: "{rounded.plate}"
    padding: "10px 16px"
  button-ghost:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.plate}"
    padding: "10px 16px"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.plate}"
    padding: "8px 12px"
  plate-numeral:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.plate-ink}"
    typography: "{typography.numeral}"
    rounded: "{rounded.plate}"
    padding: "4px 6px"
  chip-demo:
    backgroundColor: "{colors.board-deep}"
    textColor: "{colors.board-muted}"
    rounded: "{rounded.chip}"
    padding: "2px 6px"
  verdict-admitted:
    backgroundColor: "{colors.bulb}"
    textColor: "{colors.plate-ink}"
    rounded: "{rounded.plate}"
    padding: "8px 12px"
  verdict-already-in:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.plate-ink}"
    rounded: "{rounded.plate}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
  nav:
    backgroundColor: "{colors.board}"
    textColor: "{colors.board-muted}"
    height: "56px"
---

# Design System: QueueUp

## Overview

**Creative North Star: "The Ballpark Scoreboard"**

QueueUp is drawn as a ballpark scoreboard: a field of painted green steel with enamel numeral plates bolted to it and a grid of incandescent bulbs that light up as things happen. The board is live, it counts, and it is never wrong. That matches the product's one promise: exactly one buyer gets the last seat. The page doesn't claim this in a headline. It shows the count happening.

There are four paints and no others: scoreboard green, plate white, bulb amber and out red. Everything is flat paint, with no shadows and no gradients. Depth comes from paint layers (board on deep board, plate on board) and from bolted slot rules. State is shown as illumination. A lit bulb means something is live or committed. A dark socket means nothing has happened yet. A dashed red ring means a request lost. Type is stencil and condensed sign-painter caps from the Big Shoulders family, and running text is set in Barlow.

The landing board runs in Persuade mode: full-bleed green, stencil headlines, big plates. The app pages run in Operate mode. They inherit the world through tokens: a green nav bar, enamel-light paper by day and the board's deep green at night, the same 3px plate corners, the same Big Shoulders labels. The board itself does not change between light and dark mode, because it is painted steel.

**Key Characteristics:**
- Four paints only. Green steel, enamel plate, amber bulb, out red.
- Flat paint. Zero shadows and zero gradients, except the radial dots of the bolted slot rule.
- State is illumination: off, lit, won, out.
- One module (24px slot pitch) drives every gutter, column and section on the board.
- Condensed uppercase Big Shoulders for every label, button and numeral. Barlow only for running text.
- Numbers sit on white enamel plates and use tabular figures.

## Colors

A scoreboard palette. One saturated green carries the field, white enamel carries the numbers, and amber and red are kept for state.

### Primary
- **Scoreboard Green** (board): the painted steel field. Used for the landing background, the nav bar, the app's primary button in light mode, and the step-number blocks. It is also the theme color.
- **Deep Board** (board-deep): the recessed panel the bulb matrix sits in and the "On sale now" band. It is a second coat of paint, not a shadow.
- **Bolt Rule Green** (board-rule): hairlines, table rules, outline-button borders and the dots of the slot rule on the board.

### Secondary
- **Bulb Amber** (bulb): incandescent light. Means lit, live or committed: a winning bulb, the "In" plate label, the active nav underline, the lit word in a headline, the focus ring, text selection, the caret, and the Admitted verdict.
- **Out Red** (out): a request that lost. Always drawn as a dashed outline (out bulbs, Sold out tags, the Rejected verdict), never as a fill.

### Neutral
- **Enamel Plate** (plate): numeral plates, plate buttons, the light band behind "How a ticket moves", and board text.
- **Plate Ink** (plate-ink): numerals and text on plates. The same value is `ink` on app surfaces.
- **Muted Board Text** (board-muted): table headers, captions, plate labels and quiet notes on the board.
- **Dark Socket** (bulb-off): an unlit bulb.
- **Daylight Paper** (paper): the app's light-mode ground, a green-tinted enamel. At night it becomes #0c1711, the board's deepest green.
- **Card Enamel** (card): app cards and inputs. At night it becomes #13241a.
- **Muted Ink** (muted) and **Hairline** (line): secondary text and borders on app surfaces. At night they become #93a99b and #26402f.
- **Status Trio** (ok, warn, bad): app status pills, the error banner and the scanner's full-screen verdict. At night they brighten to #3ccf7a, #ffb000 and #ff6a55.

At night the app's `accent` swaps from Scoreboard Green to Enamel Plate (with plate-ink text), so primary buttons turn into plates on a dark field.

### Named Rules
**The Amber Is Light Rule.** Amber means lit, live or committed. It never marks the preferred path. Host an event and Find an event use the identical plate-white button. No CTA is ever amber because it is the one you want people to click.

**The Out Is Outline Rule.** A loss is drawn as a dashed out-red ring at the same scale as the lit bulb it lost to. It is never a red fill and never a smaller mark.

**The Board Never Changes Rule.** Board tokens (board, board-deep, board-rule, board-text, board-muted, plate, plate-ink, bulb, bulb-off, out) are the same in light and dark mode. Only the app surface tokens switch.

## Typography

**Display Font:** Big Shoulders Stencil (falls back to Big Shoulders, then sans-serif)
**Label/Numeral Font:** Big Shoulders (sans-serif fallback)
**Body Font:** Barlow (weights 400 to 700)
**Code Font:** JetBrains Mono

**Character:** Sign-painter caps. The condensed stencil face reads like letters cut for a scoreboard, and Barlow is a plain, sturdy grotesk for anything longer than a phrase.

### Hierarchy
- **Display** (Stencil 800, clamp(3rem, 5.4vw, 4.75rem), line-height 0.9, uppercase): the landing h1 only. One line can be lit amber.
- **Headline** (Stencil 800, clamp(2.2rem, 4.6vw, 3.75rem), line-height 0.92, uppercase, balanced wrap): landing section heads. The closing head goes up to clamp(2.6rem, 6vw, 5rem).
- **Title** (Big Shoulders 800, 1.5rem to 1.875rem, tracking 0.02em, uppercase): table row heads, audience names, event titles on the board.
- **Numeral** (Big Shoulders 800, tabular figures, line-height 1): plate numbers. 1.875rem to 2.25rem in the race board, 1.5rem in event rows, and up to 9rem to 10rem for the Oversold 0 and the step blocks.
- **Button** (Big Shoulders 800, 1.125rem, tracking 0.06em, uppercase): plate buttons. App buttons use 700 at 1rem.
- **Body** (Barlow 400, 1rem, line-height 1.625): running text. The landing lede is 1.125rem with a 34rem max width. Section paragraphs cap at 36rem to 42rem.
- **Label** (Big Shoulders 700, 0.75rem, tracking 0.12em to 0.14em, uppercase): table headers, plate captions, "seats left", chips. Form labels are 0.875rem at 0.08em.
- **Code** (JetBrains Mono, 11px): test names and token codes inline.

### Named Rules
**The Caps Are Paint Rule.** Every label, button, nav item, numeral and heading on the board is uppercase Big Shoulders. Barlow never appears in caps. Big Shoulders never sets a paragraph.

**The Tabular Plate Rule.** Any number that counts goes on a plate, or at least uses tabular figures, so digits don't shift when they tick.

## Layout

The landing page is a set of full-bleed bands (board, plate, board-deep) holding a centered column with a 72rem max width. Side gutters are 18px on mobile and 24px from `sm` up. Everything is set on one module, `--m` = 24px, the slot pitch. Section padding is 3m (72px), rising to 4m (96px) at 1024px. Grid gaps are 2m. Table column widths are 8m, 11m and 12m. The step blocks are 6m square, rising to 8m. The date stub is 3m wide. Smaller gaps use the module's fractions: m/3 (the bulb matrix pitch), m/2, 3/4 m and 1.5m. Padding inside components (buttons, chips, plates) uses the 4px utility scale.

The landing's first viewport splits 1.25fr to 1fr at `lg`: the stencil headline on the left, the copy and the two equal plate buttons on the right. Below it, full width, sits the Totals Board. Below `lg` everything stacks. The CTA pair splits into two columns from 440px.

The About page (`/about`) uses the same bands and module. It holds the Race Board with a "how to read it" key beside it, and the line-score table, which collapses into stacked rows at `md` and below.

App pages use a plain 72rem container with 16px gutters, 32px top padding and 96px bottom padding. They follow the standard Tailwind spacing scale, not the module.

### Named Rules
**The One Module Rule.** Every gutter, column width and section gap on the board is a multiple or simple fraction (1/3, 1/2, 3/4) of 24px. If a new value can't be written as `calc(var(--m) * n)`, it doesn't belong on the board.

## Elevation & Depth

The system is flat. There is no box-shadow and no gradient used as a surface. Depth is paint layering: deep board is recessed under board, enamel plates sit on top of board, and app cards sit on paper with a 1px hairline. Sections are divided by the bolted slot rule, a 10px strip of 2px dots repeated every 24px. That is the only radial gradient in the system, and it is drawn as hardware, not as light. The one motion with dimension is the plate flip: when a numeral changes, the plate rotates down from -75deg over 320ms (cubic-bezier(0.16, 1, 0.3, 1)). Bulbs change color in 120ms. Both turn off under reduced motion.

### Named Rules
**The Flat Paint Rule.** No shadows and no gradients. To lift something, put it on a different paint, or on a plate.

**The State Is Illumination Rule.** State changes are shown by lighting up: socket to amber, amber to ring, outline to dashed red. Never by elevation, scale or glow.

## Shapes

The corners are those of a stamped sign. Plates, buttons and inputs use 3px. Panels (the matrix tray, step blocks, app cards) use 4px. The Demo chip uses 2px. Bulbs and the wordmark dot are the only circles. Borders are 1px hairlines in board-rule or line. The dashed outline is reserved for "out": 1.5px in the matrix and on tags, 2px on the line-score legend. Icons are drawn on a 24px grid with a 2.5 stroke, square caps and miter joins, the weight of hand-painted scoreboard glyphs.

## Components

### Buttons
Enamel plates bolted to the board: square, stenciled, flat.
- **Shape:** stamped corners (3px).
- **Plate button (board):** plate background, plate-ink text, Big Shoulders 800 uppercase at 0.06em tracking, 14px by 16px padding, trailing arrow. On hover the plate brightens to pure white and the arrow moves 2px to the right. Both landing CTAs use this one button.
- **Board outline button:** transparent, 1px board-rule border, board-text. On hover the border and text light up amber (Run it again) or turn board-text (Log out).
- **App primary:** `accent` background (board by day, plate at night), 10px by 16px padding, brightness 1.25 on hover and 0.95 on press. 45% opacity when disabled.
- **App ghost:** card background, 1px line border. On hover the border turns ink.
- **Focus:** every focusable element gets a 2px amber outline at 2px offset.

### Chips
- **Demo event:** 2px corners, 1px board-rule border, board-muted label type at 11px and 0.12em tracking. Required on any event where the API's `is_demo` is true.
- **Sold out:** label type in board-text inside a 1.5px dashed out-red outline.
- **Scanner verdicts:** icon + word + color, always together. Admitted is an amber plate with a check. Already in is a white plate with a bang mark. Rejected is a dashed red outline with a red cross.
- **App status pill:** tinted status color at 15% opacity behind the status word.

### Cards / Containers
- **Corner Style:** 4px.
- **Background:** card enamel on paper. On the board, rows are separated by board-rule hairlines rather than boxed.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1px line. On hover it turns ink.
- **Internal Padding:** 16px.

### Inputs / Fields
- **Style:** card background, 1px line border, 3px corners, 8px by 12px padding, 0.875rem Barlow.
- **Focus:** the border turns ink, and the global amber focus ring applies.
- **Labels:** Big Shoulders 700, 0.875rem, uppercase, 0.08em tracking, muted.

### Navigation
A sticky 56px board-green bar on every page. The wordmark is Stencil 800 uppercase with an amber bulb dot. Links are Big Shoulders 700, 15px, uppercase, 0.08em tracking, board-muted, and turn board-text on hover. The active link gets a 2px amber underline that runs the full bar height. Sign up is a small plate. Log out is a board outline button.

### Totals Board (landing signature)
Three equal-width numeral plates in a deep-board tray, labeled Tickets sold, Checked in (amber label: the live, lit count) and Events on sale, from the public `GET /stats` totals. Each plate fills its column with the numeral centered, so the row reads as one scoreboard rather than three sizes. Numerals are 5rem on phones and up to 9rem on desktop. On phones each total becomes a row, label left and plate right. The plates flip into place on load, staggered 90ms left to right, and any plate whose value changes flips again. A bulb in the corner reads Live while the 10-second poll succeeds and Connecting when it doesn't. The caption says when the totals include demo events.

### Race Board (About page)
A 10x10 grid of bulbs in a deep-board tray, spaced at m/3, under a row of four labeled plates: Seats left, Requests, an arrow, then In (amber label) and Out (dashed-red key). Bulb states:
- **off:** dark socket with a faint amber hairline at 16% opacity.
- **lit:** solid amber.
- **won:** solid amber plus a 2px plate-white ring at 2px offset.
- **out:** transparent with a dashed out-red ring.
The board replays once when it scrolls into view. The caption narrates the race politely to screen readers. Run it again stays disabled until the race finishes.

### Door Scanner Verdicts
The full-bleed verdict that covers the viewfinder after each scan, in the board's own grammar. It always pairs a drawn icon with a stencil word and a colour, never colour alone.
- **Admitted:** solid bulb amber with plate-ink text and a check. Dark text on amber stays readable in a dark room.
- **Already in:** white enamel with plate-ink text and an alert mark, plus who scanned the ticket first and when.
- **Rejected:** board-deep with a thick dashed out-red frame inset from the edge, a red cross and plain-language reasons ("This ticket is for a different event.").

The viewfinder's aim guide is four drawn corner brackets in bulb amber. No shadows or scrims. Below it, a Last scans strip keeps the four most recent verdicts, as the same three marks at bullet size, because each big verdict clears after 2.5 seconds.

### Waitlist Panel
On a sold-out tier, the event page's action area becomes "Join the waitlist" with a 1 to 4 seat picker. Once you've joined, your place in line shows as a numeral plate ("You're #3 in line"). When a seat is held for you, it becomes an ok-green "A seat is held for you" with the pay-by time and Finish checkout. The same three states appear in the Waitlist section of My tickets. Sold-out tiers stay selectable and show how many people are waiting.

### Numeral Plate
White enamel, plate-ink numerals in Big Shoulders 800 with tabular figures, 3px corners, line-height 1. The plate flips when its value changes. Used for counts, HTTP codes in the line score, seats left, and the Oversold 0.

## Do's and Don'ts

### Do:
- **Do** use amber only for something lit, live or committed: a won bulb, a live count, the active nav item, focus, or the one lit line of a headline.
- **Do** give competing paths the identical plate button.
- **Do** draw a loss as a dashed out-red ring at the same scale as the win it lost to.
- **Do** write every board spacing as a multiple or simple fraction of `--m` (24px).
- **Do** label demo data with the "Demo event" chip whenever the API marks an event `is_demo`.
- **Do** show every verdict as icon + word + color. Never color alone.
- **Do** put counted numbers on enamel plates with tabular figures, and flip the plate when the value changes.
- **Do** use daylight paper (#e6eae2) for light app surfaces and the board's deep green for dark ones. Leave the board itself the same in both modes.

### Don't:
- **Don't** add box-shadows, glows or gradient fills. Depth is paint layering and bolted slot rules.
- **Don't** make a call to action amber to favor it.
- **Don't** fill a "lost" or "sold out" state with red. Out is an outline.
- **Don't** set paragraphs in Big Shoulders, or labels and buttons in Barlow.
- **Don't** round corners past 4px on plates, buttons, inputs or panels. Only bulbs are circles.
- **Don't** introduce a fifth paint on the board.
