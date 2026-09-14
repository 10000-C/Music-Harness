---
name: MUSE Workstation
description: Calm Apple-grade material restraint with the warmth and creative directness of a modern AI music product
colors:
  primary-violet: 'oklch(60% 0.25 350)'
  primary-cyan: 'oklch(65% 0.2 230)'
  neutral-bg: 'oklch(14% 0.01 230)'
  surface-glass: 'rgba(255, 255, 255, 0.04)'
  surface-glass-hover: 'rgba(255, 255, 255, 0.08)'
  track-1: '#8B9A94'
  track-2: '#B5A898'
  track-3: '#9892A6'
  track-4: '#8B7D81'
  track-5: '#A6B0A6'
  track-6: '#919BA6'
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontWeight: 400
rounded:
  sm: '8px'
  md: '12px'
  lg: '24px'
  full: '9999px'
spacing:
  sm: '8px'
  md: '16px'
  lg: '24px'
components:
  master-transport:
    backgroundColor: '{colors.surface-glass}'
    rounded: '{rounded.lg}'
    padding: '8px 16px'
  transport-button:
    rounded: '{rounded.md}'
    padding: '8px'
---

# Design System: MUSE Workstation

## Overview

**Creative North Star: "Apple Liquid Glass Studio"**

The interface feels like a high-end native macOS/iOS application ported to a wide desktop canvas. It rejects predictable, noisy "AI slop" gradients and nested card borders in favor of deep, dark, breathable space. Elements float softly on an ambient mesh background, using `backdrop-filter` glassmorphism to refract the colors behind them. The creative energy is focused entirely on the Master Transport Island and the music tracks themselves.

**Key Characteristics:**

- Deep, dark, immersive workspace with subtle ambient background glow.
- Liquid glassmorphism (`backdrop-filter: blur`) over harsh solid backgrounds.
- Tactile, micro-animated interactions (e.g., active scaling, glowing pulse).
- Muted, sophisticated Morandi color palette for the tracks to avoid visual fatigue.
- Centralized control via a floating "Dynamic Island" Master Transport.

## Colors

The palette relies on a near-black void punctuated by diffuse AI glows and elegant, desaturated track colors.

### Primary

- **Luminous Violet** (oklch(60% 0.25 350)): The creative spark. Used for the primary Play button and AI interaction accents.
- **Ambient Cyan** (oklch(65% 0.2 230)): The secondary glow used in the background mesh to refract through the glass panels.

### Neutral

- **Deep Void** (oklch(14% 0.01 230)): The base application background.
- **Liquid Glass** (rgba(255, 255, 255, 0.04)): The background for panels, sidebars, and the transport island. It must always be paired with a backdrop blur.

### Tracks

- **Morandi Scale** (#8B9A94, #B5A898, etc.): The six logical tracks use a muted, earthy, low-saturation palette. This ensures the workspace feels like a calm studio rather than a toy, preventing sensory overload during long sessions.

### Named Rules

**The No-Line Rule.** Do not use hard 1px solid borders to separate sections. Use whitespace, subtle differences in `rgba` background lightness, and backdrop blurs to define hierarchy. If a border is absolutely necessary for contrast, it must be `rgba(255, 255, 255, 0.05)`.

## Typography

**System Font:** -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif

**Character:** Crisp, native, and unobtrusive. The typography gets out of the way of the music.

### Named Rules

**The Muted Metadata Rule.** Secondary information (like BPM, Meter, Time) must be rendered in thin, low-opacity white (e.g., `rgba(255, 255, 255, 0.5)`) and tight letter-spacing to avoid competing with the primary play controls and track names.

## Layout

The layout is a wide, distraction-free horizontal canvas. The top header is reserved exclusively for the Master Transport Island, centered and floating above the tracks. The timeline occupies the vast majority of the screen real estate. The agent panel is a floating glass pane on the right, not a rigidly docked sidebar.

## Elevation & Depth

The system uses a hybrid of tonal layering via opacity and glassmorphism. It explicitly rejects heavy drop shadows (`box-shadow`) for structural layout.

### Named Rules

**The Glass Refraction Rule.** Elevation is achieved by increasing the background opacity of white (`rgba(255, 255, 255, X)`) and applying `backdrop-filter: blur(24px)`. Higher elevation means slightly higher opacity, catching more of the ambient background mesh.

## Shapes

Forms are organic and pill-like, avoiding harsh 90-degree angles.

- **Micro-elements (buttons):** `12px` radius.
- **Macro-elements (panels, islands):** `24px` radius or fully rounded pills.

## Components

### Master Transport Island

- **Shape:** Fully rounded pill (`24px` radius).
- **Background:** Liquid Glass with a 1px ultra-thin translucent border.
- **Placement:** Floating top-center. Unifies Play, Stop, Prev, Next, Loop, Time, BPM, and Meter into a single physical unit.

### Primary Play Button (Luminous Orb)

- **Shape:** Perfect circle.
- **Background:** Luminous Violet gradient.
- **Hover / Focus:** Gently pulses; glows brighter.
- **Active / Click:** Tactile physical depression `transform: scale(0.92)`.

### Track Headers

- **Background:** Semi-transparent, inheriting the Morandi color of the track.
- **Typography:** Bold but muted, aligned with the track content.

## Do's and Don'ts

### Do:

- **Do** use `backdrop-filter: blur` to separate floating panels from the timeline.
- **Do** consolidate redundant controls (like multiple play buttons) into single, authoritative hubs.
- **Do** use muted, low-saturation colors for large data areas like tracks.
- **Do** ensure interactive elements have a tactile `scale` transform on `:active`.

### Don't:

- **Don't** use nested cards with solid gray backgrounds.
- **Don't** use harsh `#000000` or `#FFFFFF` for backgrounds; use translucent `rgba` or deep `oklch`.
- **Don't** clutter the top level with developer-centric tools or MIDI grids; keep it focused on the high-level arrangement.
