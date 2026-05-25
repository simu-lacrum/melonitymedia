# MelonityMedia — Style Reference

**Theme:** dark

MelonityMedia employs a high-contrast, premium dark aesthetic inspired by elite gaming software and cutting-edge automation platforms. The UI is built on a foundation of deep, immersive dark tones (`#1c2026`), specifically designed to reduce eye strain during long sessions of traffic arbitrage and data monitoring. Typography relies entirely on the highly adaptable variable font **Roboto Flex**, utilizing extreme `font-stretch` and `font-variation-settings` for bold, ultra-wide headings that immediately command attention. Primary interactive elements are punctuated by a signature vibrant neon pink, accompanied by frosted glassmorphism headers and custom scrollbars.

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Night Base | `#1c2026` | `--color-night-base` | The absolute base background for the entire application (HTML, body, main containers). |
| Header Glass | `#1c202666` | `--color-header-glass` | Translucent background for sticky headers. Used with strong 35px blur. |
| Surface Dark | `#262a30` | `--color-surface-dark` | Base background for scrollbar tracks, large cards, and modal windows. |
| Melon Pink | `#ff1469` | `--color-melon-pink` | Primary brand accent. Used for main CTA buttons, active states, and highlights. |
| Pink Alpha | `#ff146940` | `--color-pink-alpha` | Used for scrollbar thumbs and soft glowing effects. |
| Success Green | `#00d287` | `--color-success-green` | Success states, active account statuses ("Alive"), and live proxies. |
| Alert Red | `#f43f5e` | `--color-alert-red` | Banned accounts, critical errors, or failed video uploads. |
| Warning Amber | `#f59e0b` | `--color-warning-amber` | "Auth Required" states, captcha warnings, and pending tasks. |
| Pure White | `#ffffff` | `--color-pure-white` | Primary text for headings, prominent metrics, and key data points. |
| Muted Gray | `#9ca3af` | `--color-muted-gray` | Secondary descriptions, table headers, placeholders, and subtle UI labels. |

## Tokens — Typography

### Roboto Flex — The single font family used across the entire application. It leverages variable font settings (`font-stretch`, `opsz`, `wdth`) to create distinct visual hierarchies without needing multiple font files. · `--font-roboto-flex`
- **Font Family:** `'Roboto Flex', sans-serif`
- **Optical Sizing:** `auto`

#### Display & Headings (H1)
For massive analytic numbers and page titles, the font is stretched to create a wide, aggressive cyber-aesthetic.
- **Size:** `64px` (4rem)
- **Weight:** `700`
- **Line height:** `1.10` (110%)
- **Font Stretch:** `150%`
- **Variation Settings:** `"GRAD" 128, "XOPQ" 111, "XTRA" 500, "YOPQ" 91, "YTAS" 750, "YTDE" -203, "YTFI" 738, "YTLC" 514, "YTUC" 740, "slnt" 0, "wdth" 130, "opsz" 14`

#### Functional UI & Body
For dense data tables, logs, and inputs.
- **Size:** `14px`, `16px`
- **Weight:** `400`, `500`
- **Line height:** `1.40`
- **Font Stretch:** `100%` (normal)

### Type Scale

| Role | Size | Line Height | Weight | Stretch | Token |
|------|------|-------------|--------|---------|-------|
| caption | 12px | 1.4 | 400 | 100% | `--text-caption` |
| body-sm | 14px | 1.5 | 400 | 100% | `--text-body-sm` |
| button-label | 16px | 1.2 | 600 | 100% | `--text-button-label` |
| heading-md | 32px | 1.2 | 700 | 120% | `--text-heading-md` |
| display (H1) | 64px | 1.1 | 700 | 150% | `--text-display` |

## Tokens — Spacing & Layout

**Base unit:** 4px
**Max Content Width:** `1408px` (used in headers and main grid constraints)

### Spacing Scale

| Name | Value | Token | Notes |
|------|-------|-------|-------|
| 4 | 4px | `--spacing-4` | |
| 6 | 6px | `--spacing-6` | 0.375rem (Scrollbar sizing) |
| 8 | 8px | `--spacing-8` | Default body margin |
| 16 | 16px | `--spacing-16` | |
| 18 | 18px | `--spacing-18` | 1.125rem (Header vertical padding) |
| 24 | 24px | `--spacing-24` | |
| 32 | 32px | `--spacing-32` | 2rem (Header horizontal padding) |
| 168 | 168px | `--spacing-168` | 10.5rem (Container bottom padding) |

### Border Radius

| Element | Value |
|---------|-------|
| scrollbar-thumb | 999rem (pill) |
| buttonsPrimary | 12px to 16px |
| cards | 16px |

## Components

### Glassmorphic Header
**Role:** Main sticky navigation
Background `#1c202666`, padding `1.125rem 2rem`, `backdrop-filter: blur(35px)`. Fixed to the top with `z-index: 2` and a `.3s ease` transition. The inner container has a `width: 100%; max-width: 1408px; margin: 0 auto;`.

### Custom Scrollbar
**Role:** Thematic scrolling experience
Width and height `.375rem` (6px). Track background `#262a30`. Thumb background `#ff146940` with a fully rounded border radius (`999rem`).

### Neon Primary Action Button
**Role:** Main call to action (e.g., "Run Script", "Upload Accounts")
Background `#ff1469`, text `#ffffff` (Roboto Flex, 600). Outer glow using a variant of the pink alpha. 

### Dashboard Analytics Card
**Role:** Displaying key metrics
Background `#262a30`. Text utilizes the stretched Roboto Flex styling for large prominent numbers (e.g., 64px, 150% stretch, with custom variation settings).

### Main Container Wrapper
**Role:** The main wrapper for all application views
Background `#1c2026`, min-height `100vh`, padding `0 0 10.5rem`, overflow `hidden auto`.

## Do's and Don'ts

### Do
- **Exclusively use `Roboto Flex`** for all typography. Control hierarchy strictly through `font-size`, `font-weight`, and specifically `font-stretch` (up to 150% for main titles).
- Apply `backdrop-filter: blur(35px)` with the `#1c202666` background for sticky panels and headers.
- Set the main background of the `body`, `html`, and `.container` to `#1c2026`.
- Follow the max-width layout structure of `1408px` to ensure the interface doesn't infinitely stretch on ultrawide monitors.
- Use the custom scrollbar styling (`#ff146940` thumb, `#262a30` track) to keep the dark aesthetic unbroken by default browser UI.

### Don't
- Do not introduce secondary fonts like Montserrat or Inter. The visual identity relies heavily on the variable capabilities of Roboto Flex.
- Do not use solid colors for the header if it overlaps scrolling content; always utilize the blur effect to match the exact Melonity reference.
- Avoid tight, compressed typography for headings. Ensure `font-stretch: 150%` and `font-variation-settings` are applied to give the text its signature wide, gaming-software stance.

## Elevation

- **Base Canvas:** `Night Base` (`#1c2026`)
- **Cards/Overlays:** `Surface Dark` (`#262a30`)
- **Floating/Sticky Headers:** `Header Glass` (`#1c202666`) + `blur(35px)`

## Agent Prompt Guide

Quick Color Reference: 
background: `#1c2026`
surface: `#262a30`
header (glass): `#1c202666`
accent pink: `#ff1469`
pink alpha: `#ff146940`
text: `#ffffff`

Example Component Prompts:
1. **Create the Header:** "Build a sticky header. Background `#1c202666`, `backdrop-filter: blur(35px)`. Padding 1.125rem 2rem. Inner container width 100%, max-width `1408px`, margin auto. Ensure it has `z-index: 2` and transition ease 0.3s."
2. **Create a Page Title (H1):** "Add an H1 heading. Text color `#ffffff`. Font: Roboto Flex, font-size 4rem, line-height 110%, font-weight 700, font-stretch 150%. Apply variable font settings: `"GRAD" 128, "XOPQ" 111, "XTRA" 500, "YOPQ" 91, "YTAS" 750, "YTDE" -203, "YTFI" 738, "YTLC" 514, "YTUC" 740, "slnt" 0, "wdth" 130, "opsz" 14`."
3. **Apply Custom Scrollbar CSS:** "Set `::-webkit-scrollbar` width and height to `.375rem`, track background to `#262a30`, and thumb background to `#ff146940` with `border-radius: 999rem`."
4. **Create the Main Container:** "Main content wrapper must have `background: #1c2026; min-height: 100vh; padding: 0 0 10.5rem; overflow: hidden auto;`."

## Quick Start

### CSS Core Reset & Setup

```css
@font-face {
    font-family: 'Roboto Flex';
    font-style: oblique 0deg 10deg;
    font-weight: 100 1000;
    font-stretch: 25% 151%;
    font-display: swap;
    src: url([https://fonts.gstatic.com/s/robotoflex/v30/NaPccZLOBv5T3oB7Cb4i0zu3RMH-CQ.woff2](https://fonts.gstatic.com/s/robotoflex/v30/NaPccZLOBv5T3oB7Cb4i0zu3RMH-CQ.woff2)) format('woff2');
    unicode-range: U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F;
}

:root {
  /* Colors */
  --color-night-base: #1c2026;
  --color-header-glass: #1c202666;
  --color-surface-dark: #262a30;
  --color-melon-pink: #ff1469;
  --color-pink-alpha: #ff146940;
  --color-pure-white: #ffffff;
  --color-success-green: #00d287;
  --color-alert-red: #f43f5e;
  --color-warning-amber: #f59e0b;

  /* Typography */
  --font-roboto-flex: 'Roboto Flex', sans-serif;
}

* {
    margin: 0;
    padding: 0;
    min-width: 0;
    min-height: 0;
    box-sizing: border-box;
    font-family: var(--font-roboto-flex);
    scroll-behavior: smooth;
    font-optical-sizing: auto;
}

body, html {
    background-color: var(--color-night-base);
}

/* Custom Scrollbar */
::-webkit-scrollbar {
    height: 0.375rem;
    width: 0.375rem;
    background: var(--color-surface-dark);
}

::-webkit-scrollbar-thumb {
    background: var(--color-pink-alpha);
    border-radius: 999rem;
}

/* Heading Defaults */
h1 {
    font-weight: 700;
    font-stretch: 150%;
    font-size: 4rem;
    line-height: 110%;
    color: var(--color-pure-white);
    font-variation-settings: "GRAD" 128, "XOPQ" 111, "XTRA" 500, "YOPQ" 91, "YTAS" 750, "YTDE" -203, "YTFI" 738, "YTLC" 514, "YTUC" 740, "slnt" 0, "wdth" 130, "opsz" 14;
}

/* Layout Classes */
.container {
    padding: 0 0 10.5rem;
    background: var(--color-night-base);
    min-height: 100vh;
    overflow: hidden auto;
}

.header-blur {
    z-index: 2;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    padding: 1.125rem 2rem;
    user-select: none;
    transition: .3s ease;
    will-change: backdrop-filter;
    max-height: 100dvh;
    background: var(--color-header-glass);
    -webkit-backdrop-filter: blur(35px);
    backdrop-filter: blur(35px);
}

.max-w-wrapper {
    width: 100%;
    max-width: 1408px;
    margin: 0 auto;
}
Tailwind v4 Setup Configuration
CSS
@theme {
  /* Colors */
  --color-night-base: #1c2026;
  --color-header-glass: #1c202666;
  --color-surface-dark: #262a30;
  --color-melon-pink: #ff1469;
  --color-pink-alpha: #ff146940;
  
  /* Typography */
  --font-roboto-flex: 'Roboto Flex', sans-serif;

  /* Layout */
  --container-max-w: 1408px;
}

@layer utilities {
  .text-display-wide {
    font-weight: 700;
    font-stretch: 150%;
    line-height: 110%;
    font-variation-settings: "GRAD" 128, "XOPQ" 111, "XTRA" 500, "YOPQ" 91, "YTAS" 750, "YTDE" -203, "YTFI" 738, "YTLC" 514, "YTUC" 740, "slnt" 0, "wdth" 130, "opsz" 14;
  }
}