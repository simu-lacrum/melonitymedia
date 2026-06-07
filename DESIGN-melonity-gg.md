---
name: Melonity
url: https://melonity.gg
colors:
  primary: '#ff1469'
  primary-hover: '#e00e5e'
  accent-green: '#15c188'
  background: '#20242a'
  surface: '#282d35'
  surface-darker: '#22272d'
  text-primary: '#ffffff'
  text-muted: '#8d97a6'
  text-secondary: '#b9c0cb'
  text-disabled: '#586271'
  border: '#586271'
  border-light: '#ffffff'
  focus-ring: 'rgba(255, 20, 105, 0.2)'
  checkbox-checked-bg: 'rgba(255, 20, 105, 0.25)'
  checkbox-checked-bg-light: 'rgba(255, 255, 255, 0.25)'
  burger-hover-bg: '#23272d'
  game-card-hover-bg: '#222224'
  user-card-hover-bg: '#171b21'
  nav-link-hover-bg: '#282d35'
  nav-link-hover-text: '#ffffff'
typography:
  display:
    family: 'Roboto Flex'
    size: 64px
    weight: 700
    line-height: 1.2
  h1:
    family: 'Roboto Flex'
    size: 40px
    weight: 700
    line-height: 1.2
  h2:
    family: 'Roboto Flex'
    size: 28px
    weight: 700
    line-height: 1.2
  h3:
    family: 'Roboto Flex'
    size: 20px
    weight: 400
    line-height: 1.5
  body:
    family: 'Roboto Flex'
    size: 16px
    weight: 400
    line-height: 1.5
  caption:
    family: 'Roboto Flex'
    size: 13px
    weight: 400
    line-height: 1.5
spacing:
  base: 4px
  scale: [0, 4, 8, 12, 16, 20, 24, 32, 40]
radius:
  sm: 8px
  md: 12px
  lg: 16px
  full: 9999px
elevation:
  card: 'rgba(27, 27, 27, 0.1) 0px -2px 16px 0px'
  focus-ring: '0px 0px 0px 4px rgba(255, 20, 105, 0.2)'
  hero-glow: '0px 0px 65px 17px rgba(255, 20, 105, 0.4)'
components:
  button-primary:
    bg: '{colors.primary}'
    text: '{colors.text-primary}'
    radius: '{radius.md}'
    padding: '12px 24px'
    font-weight: 500
    font-size: 16px
  button-secondary:
    bg: '{colors.surface}'
    text: '{colors.text-primary}'
    radius: '{radius.md}'
    padding: '12px 24px'
    font-weight: 500
    font-size: 16px
  button-ghost:
    bg: '{colors.surface-darker}'
    text: '{colors.text-disabled}'
    radius: '{radius.md}'
    padding: '12px 24px'
    font-weight: 500
    font-size: 16px
  card:
    bg: '{colors.surface}'
    radius: '{radius.lg}'
    shadow: '{elevation.card}'
  input:
    bg: '{colors.surface}'
    text: '{colors.text-primary}'
    border: '1px solid {colors.border}'
    radius: '{radius.md}'
    padding: '12px 16px'
motion:
  duration-fast: '0.15s'
  duration-base: '0.3s'
  easing-standard: 'cubic-bezier(0.25, 0.1, 0.25, 1)' # (inferred from common defaults)
---

# Design System Inspired by Melonity

## 1. Visual Theme & Atmosphere
Melonity employs a dark, high-contrast interface, predominantly using a deep charcoal background (`#20242a`) paired with crisp white text (`#ffffff`). The brand's identity is powerfully conveyed through vibrant accent colors: a striking hot pink (`#ff1469`) for primary calls-to-action and key highlights, complemented by a sharp emerald green (`#15c188`) for secondary interactive elements. The layout features ample negative space, allowing content to breathe and drawing attention to interactive elements, while subtle CSS transitions (`0.15s` and `0.3s`) provide smooth feedback without distracting animations.

The visual atmosphere is further defined by its use of game-related 3D rendered illustrations and a consistent application of rounded corners, primarily `12px` and `16px`, which soften the otherwise bold and technical aesthetic. Interactive cards and sections often feature a slightly lighter dark surface (`#282d35`) to create visual separation. The overall impression is one of a modern, performance-oriented platform, leveraging strong color contrasts and clear typography to guide users through complex gaming-related content.

Key Characteristics:
- Dark UI with background `#20242a` and surface `#282d35`.
- High contrast text (`#ffffff`) on dark backgrounds.
- Primary accent color `#ff1469` for CTAs and highlights.
- Secondary accent color `#15c188` for alternative actions.
- `Roboto Flex` typography with strong weights for headings.
- Consistent `12px` and `16px` border radii on interactive elements.
- Subtle `0.15s` and `0.3s` CSS transitions for interaction feedback.

## 2. Color Palette & Roles
Melonity's color palette is built around a dark theme with strategic use of vibrant accents to highlight interactivity and key information.

-   **Primary**:
    -   `primary: #ff1469` — The core brand accent, used for primary calls-to-action, active states, and prominent highlights.
    -   `primary-hover: #e00e5e` (inferred from screenshot) — A slightly darker shade of pink used for hover states on primary interactive elements.
    -   `accent-green: #15c188` — A secondary accent color used for alternative calls-to-action and success indicators.
-   **Neutral Scale**:
    -   `background: #20242a` — The main background color for the entire application.
    -   `surface: #282d35` — Used for cards, interactive containers, and secondary button backgrounds, providing visual separation from the main background.
    -   `surface-darker: #22272d` — A darker variant of the surface color, used for ghost buttons and specific interactive states.
    -   `text-primary: #ffffff` — The primary text color, providing high contrast on dark backgrounds.
    -   `text-muted: #8d97a6` — Used for secondary information, descriptions, and less prominent text.
    -   `text-secondary: #b9c0cb` — A slightly lighter muted text color, used for hints or less critical information.
    -   `text-disabled: #586271` — Used for text in disabled states or very subtle, non-interactive elements.
-   **Interactive**:
    -   `border: #586271` — A subtle border color used for inputs and some interactive elements.
    -   `border-light: #ffffff` — A white border used for secondary buttons.
    -   `focus-ring: rgba(255, 20, 105, 0.2)` — The transparent pink overlay used for focus states, creating a vibrant glow.
    -   `checkbox-checked-bg: rgba(255, 20, 105, 0.25)` — Background for checked checkboxes, using a transparent primary accent.
    -   `checkbox-checked-bg-light: rgba(255, 255, 255, 0.25)` — Background for checked checkboxes on light surfaces, using a transparent white.
    -   `burger-hover-bg: #23272d` — Background color for the burger menu icon on hover.
    -   `game-card-hover-bg: #222224` — Background color for game cards on hover.
    -   `user-card-hover-bg: #171b21` — Background color for user profile cards on hover.
    -   `nav-link-hover-bg: #282d35` — Background color for navigation links on hover.
    -   `nav-link-hover-text: #ffffff` — Text color for navigation links on hover.

## 3. Typography Rules
-   **Font Family**:
    -   Primary: `'Roboto Flex', sans-serif`
    -   Monospace: `'Roboto Mono', monospace` (inferred)
-   **Hierarchy**:
    -   **Display**: `Roboto Flex` `64px` `700` · line-height `1.2` · tracking `none` · Used for hero section headlines, commanding immediate attention.
    -   **H1**: `Roboto Flex` `40px` `700` · line-height `1.2` · tracking `none` · Main section titles, establishing primary content hierarchy.
    -   **H2**: `Roboto Flex` `28px` `700` · line-height `1.2` · tracking `none` · Sub-section titles, breaking down content into digestible chunks.
    -   **H3**: `Roboto Flex` `20px` `400` · line-height `1.5` · tracking `none` · Card titles and prominent feature descriptions.
    -   **Body**: `Roboto Flex` `16px` `400` · line-height `1.5` · tracking `none` · Standard paragraph text for readability.
    -   **Caption**: `Roboto Flex` `13px` `400` · line-height `1.5` · tracking `none` · Small print, meta-information, and secondary details.
    -   **Code/Mono**: `Roboto Mono` `15px` `400` · line-height `1.4` · tracking `none` · For code snippets and technical text (inferred).
-   **Principles**:
    -   Prioritize `Roboto Flex` with `700` weight for all major headings to establish a strong, clear hierarchy against the dark background.
    -   Maintain ample line-heights (1.2 for headings, 1.5 for body text) to ensure readability and prevent text from feeling cramped.
    -   Use `text-primary: #ffffff` for all core content on dark backgrounds, reserving `text-muted: #8d97a6` for supportive or less critical information.
    -   Ensure consistent font sizing and weights across similar content types to provide a predictable reading experience.

## 4. Component Stylings

### Buttons

#### Primary Button
A prominent call-to-action button with a vibrant pink background and white text, used for key actions like "Create account" or "Checkout". Features a subtle background color shift on hover.

```css
.button-primary {
  background-color: var(--color-primary, #ff1469);
  color: var(--color-text-primary, #ffffff);
  font-family: 'Roboto Flex', sans-serif;
  font-size: 16px;
  font-weight: 500;
  padding: 12px 24px;
  border: none;
  border-radius: var(--radius-md, 12px);
  cursor: pointer;
  transition: background-color var(--motion-duration-fast, 0.15s) var(--motion-easing-standard, cubic-bezier(0.25, 0.1, 0.25, 1));
}

.button-primary:hover {
  background-color: var(--color-primary-hover, #e00e5e); /* inferred from screenshot */
}

.button-primary:active {
  background-color: var(--color-primary, #ff1469);
  transform: translateY(1px); /* inferred from screenshot */
}

.button-primary:disabled {
  background-color: var(--color-surface, #282d35);
  color: var(--color-text-disabled, #586271);
  cursor: default;
}
```

#### Secondary Button
A supporting action button with a dark surface background and white text, often used for "Sign in" or "Learn more" actions. Features a white border.

```css
.button-secondary {
  background-color: var(--color-surface, #282d35);
  color: var(--color-text-primary, #ffffff);
  font-family: 'Roboto Flex', sans-serif;
  font-size: 16px;
  font-weight: 500;
  padding: 12px 24px;
  border: 1px solid var(--color-border-light, #ffffff);
  border-radius: var(--radius-md, 12px);
  cursor: pointer;
  transition: background-color var(--motion-duration-fast, 0.15s) var(--motion-easing-standard, cubic-bezier(0.25, 0.1, 0.25, 1)),
              border-color var(--motion-duration-fast, 0.15s) var(--motion-easing-standard, cubic-bezier(0.25, 0.1, 0.25, 1));
}

.button-secondary:hover {
  background-color: var(--color-background, #20242a); /* inferred from screenshot */
  border-color: var(--color-text-muted, #8d97a6); /* inferred from screenshot */
}

.button-secondary:active {
  background-color: var(--color-surface, #282d35);
  transform: translateY(1px); /* inferred from screenshot */
}

.button-secondary:disabled {
  background-color: var(--color-surface-darker, #22272d);
  color: var(--color-text-disabled, #586271);
  border-color: var(--color-text-disabled, #586271);
  cursor: default;
}
```

#### Ghost Button
A less prominent action button, typically with a darker surface background and muted text, used for actions like "Login to the system" within a card.

```css
.button-ghost {
  background-color: var(--color-surface-darker, #22272d);
  color: var(--color-text-disabled, #586271);
  font-family: 'Roboto Flex', sans-serif;
  font-size: 16px;
  font-weight: 500;
  padding: 12px 24px;
  border: 1px solid var(--color-text-disabled, #586271);
  border-radius: var(--radius-md, 12px);
  cursor: pointer;
  transition: background-color var(--motion-duration-fast, 0.15s) var(--motion-easing-standard, cubic-bezier(0.25, 0.1, 0.25, 1)),
              color var(--motion-duration-fast, 0.15s) var(--motion-easing-standard, cubic-bezier(0.25, 0.1, 0.25, 1));
}

.button-ghost:hover {
  background-color: var(--color-surface, #282d35); /* inferred from screenshot */
  color: var(--color-text-primary, #ffffff); /* inferred from screenshot */
  border-color: var(--color-text-primary, #ffffff); /* inferred from screenshot */
}

.button-ghost:active {
  background-color: var(--color-surface-darker, #22272d);
  transform: translateY(1px); /* inferred from screenshot */
}

.button-ghost:disabled {
  background-color: var(--color-background, #20242a);
  color: var(--color-text-disabled, #586271);
  border-color: var(--color-text-disabled, #586271);
  cursor: default;
  opacity: 0.6; /* inferred from screenshot */
}
```

### Cards & Containers

#### Standard Card
A rectangular container used for features, subscriptions, or information blocks. It features a dark surface background, large rounded corners, and a subtle shadow. On hover, the background subtly darkens.

```css
.card {
  background-color: var(--color-surface, #282d35);
  color: var(--color-text-primary, #ffffff);
  border-radius: var(--radius-lg, 16px);
  padding: 32px; /* inferred from screenshot */
  box-shadow: var(--elevation-card, rgba(27, 27, 27, 0.1) 0px -2px 16px 0px);
  transition: background-color var(--motion-duration-fast, 0.15s) var(--motion-easing-standard, cubic-bezier(0.25, 0.1, 0.25, 1));
}

.card:hover {
  background-color: var(--color-game-card-hover-bg, #222224); /* from pseudoStates */
}

.card-highlighted { /* Example of a highlighted card variant */
  background-color: var(--color-primary, #ff1469);
  color: var(--color-text-primary, #ffffff);
  border-radius: var(--radius-lg, 16px);
  padding: 32px; /* inferred from screenshot */
  box-shadow: var(--elevation-hero-glow, rgba(255, 20, 105, 0.4) 0px 0px 65px 17px);
  transition: background-color var(--motion-duration-fast, 0.15s) var(--motion-easing-standard, cubic-bezier(0.25, 0.1, 0.25, 1));
}
```

### Inputs & Forms

#### Text Input
A standard text input field with a dark surface background, muted border, and white text. It provides a clear focus ring on interaction.

```css
.input-text {
  background-color: var(--color-surface, #282d35);
  color: var(--color-text-primary, #ffffff);
  font-family: 'Roboto Flex', sans-serif;
  font-size: 16px;
  font-weight: 400;
  padding: 12px 16px;
  border: 1px solid var(--color-border, #586271);
  border-radius: var(--radius-md, 12px);
  transition: border-color var(--motion-duration-fast, 0.15s) var(--motion-easing-standard, cubic-bezier(0.25, 0.1, 0.25, 1)),
              box-shadow var(--motion-duration-fast, 0.15s) var(--motion-easing-standard, cubic-bezier(0.25, 0.1, 0.25, 1));
}

.input-text::placeholder {
  color: var(--color-text-muted, #8d97a6);
}

.input-text:focus {
  border-color: var(--color-primary, #ff1469);
  box-shadow: var(--elevation-focus-ring, 0px 0px 0px 4px rgba(255, 20, 105, 0.2));
  outline: none;
  background-color: rgb(32, 33, 35); /* from pseudoStates */
}

.input-text:disabled {
  background-color: var(--color-surface-darker, #22272d);
  color: var(--color-text-disabled, #586271);
  border-color: var(--color-text-disabled, #586271);
  cursor: default;
  opacity: 0.7; /* inferred from screenshot */
}
```

#### Form Label
Labels for form fields, using primary white text for clarity.

```css
.form-label {
  color: var(--color-text-primary, #ffffff);
  font-family: 'Roboto Flex', sans-serif;
  font-size: 16px;
  font-weight: 400;
  margin-bottom: var(--spacing-sm, 8px); /* inferred from screenshot */
  display: block;
}

label.form-label:has(input:disabled) {
  cursor: default; /* from pseudoStates */
}
```

#### Checkbox/Radio
A custom-styled checkbox with a dark background and a primary pink fill when checked.

```css
.checkbox-container {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 8px); /* inferred from screenshot */
  cursor: pointer;
}

.checkbox-input {
  appearance: none;
  width: 20px; /* inferred from screenshot */
  height: 20px; /* inferred from screenshot */
  border: 1px solid var(--color-border, #586271);
  border-radius: var(--radius-sm, 8px); /* inferred from screenshot */
  background-color: var(--color-surface, #282d35);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color var(--motion-duration-fast, 0.15s) var(--motion-easing-standard, cubic-bezier(0.25, 0.1, 0.25, 1)),
              border-color var(--motion-duration-fast, 0.15s) var(--motion-easing-standard, cubic-bezier(0.25, 0.1, 0.25, 1));
}

.checkbox-input:checked {
  background-color: var(--color-checkbox-checked-bg, rgba(255, 20, 105, 0.25)); /* from pseudoStates */
  border-color: var(--color-primary, #ff1469);
}

.checkbox-input:checked::before {
  content: '✓'; /* inferred from screenshot */
  color: var(--color-text-primary, #ffffff);
  font-size: 14px; /* inferred from screenshot */
  transform: scale(1); /* from pseudoStates */
  opacity: 1; /* from pseudoStates */
  transition: transform var(--motion-duration-fast, 0.15s) var(--motion-easing-standard, cubic-bezier(0.25, 0.1, 0.25, 1)),
              opacity var(--motion-duration-fast, 0.15s) var(--motion-easing-standard, cubic-bezier(0.25, 0.1, 0.25, 1));
}

.checkbox-input:disabled {
  background-color: var(--color-surface-darker, #22272d);
  border-color: var(--color-text-disabled, #586271);
  cursor: default; /* from pseudoStates */
  opacity: 0.7; /* inferred from screenshot */
}

.checkbox-input:disabled:checked {
  background-color: rgba(255, 20, 105, 0.1); /* inferred from screenshot */
}
```

### Navigation

#### Top Navigation Bar
The main header bar, fixed at the top, providing global navigation links and user actions. It features a subtle blur effect on scroll.

```css
.nav-bar {
  background-color: var(--color-background, #20242a);
  color: var(--color-text-primary, #ffffff);
  padding: 16px 40px; /* inferred from screenshot */
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: sticky;
  top: 0;
  width: 100%;
  z-index: 2; /* from elevation.zIndexValues */
  transition: background-color var(--motion-duration-base, 0.3s) var(--motion-easing-standard, cubic-bezier(0.25, 0.1, 0.25, 1));
}

.nav-bar.blur-on-scroll { /* Example class for scroll effect */
  background-color: rgba(32, 36, 42, 0.8); /* inferred from screenshot */
  backdrop-filter: blur(8px); /* inferred from screenshot */
}
```

#### Navigation Link
Individual links within the navigation bar, using muted text that brightens to white on hover, often with a subtle background change.

```css
.nav-link {
  color: var(--color-text-muted, #8d97a6);
  font-family: 'Roboto Flex', sans-serif;
  font-size: 16px;
  font-weight: 400;
  text-decoration: none;
  padding: 8px 12px; /* inferred from screenshot */
  border-radius: var(--radius-sm, 8px); /* inferred from screenshot */
  transition: color var(--motion-duration-fast, 0.15s) var(--motion-easing-standard, cubic-bezier(0.25, 0.1, 0.25, 1)),
              background-color var(--motion-duration-fast, 0.15s) var(--motion-easing-standard, cubic-bezier(0.25, 0.1, 0.25, 1));
}

.nav-link:hover {
  color: var(--color-nav-link-hover-text, #ffffff); /* from pseudoStates */
  background-color: var(--color-nav-link-hover-bg, #282d35); /* from pseudoStates */
}

.nav-link.active,
.nav-link[aria-current="page"] {
  color: var(--color-text-primary, #ffffff);
  background-color: var(--color-surface, #282d35); /* inferred from screenshot */
  font-weight: 500; /* inferred from screenshot */
}

.nav-link:visited {
  color: var(--color-text-muted, #8d97a6); /* no change for visited */
}
```

#### Dropdown Menu
A menu that appears on interaction, typically for language selection or user profiles, featuring a dark surface background and rounded corners.

```css
.dropdown-menu {
  background-color: var(--color-surface, #282d35);
  border-radius: var(--radius-md, 12px);
  padding: var(--spacing-sm, 8px) 0;
  box-shadow: var(--elevation-card, rgba(27, 27, 27, 0.1) 0px -2px 16px 0px); /* inferred from screenshot */
  z-index: 999; /* from elevation.zIndexValues */
  min-width: 120px; /* inferred from screenshot */
}

.dropdown-menu-item {
  color: var(--color-text-primary, #ffffff);
  font-family: 'Roboto Flex', sans-serif;
  font-size: 16px;
  font-weight: 400;
  padding: var(--spacing-sm, 8px) var(--spacing-md, 16px);
  cursor: pointer;
  transition: background-color var(--motion-duration-fast, 0.15s) var(--motion-easing-standard, cubic-bezier(0.25, 0.1, 0.25, 1));
}

.dropdown-menu-item:hover {
  background-color: var(--color-background, #20242a); /* inferred from screenshot */
}
```

### Links

#### Standard Link
Inline text links, typically using the primary accent color for visibility, especially for calls to action within text.

```css
.link-standard {
  color: var(--color-primary, #ff1469);
  text-decoration: none;
  font-family: 'Roboto Flex', sans-serif;
  font-size: 16px;
  font-weight: 400;
  transition: color var(--motion-duration-fast, 0.15s) var(--motion-easing-standard, cubic-bezier(0.25, 0.1, 0.25, 1));
}

.link-standard:hover {
  color: var(--color-primary-hover, #e00e5e); /* inferred from screenshot */
  text-decoration: underline; /* inferred from screenshot */
}

.link-standard:visited {
  color: var(--color-primary, #ff1469); /* no change for visited */
}
```

#### Secondary Link
Less prominent inline text links, using muted text colors, suitable for navigation or informational links within body text.

```css
.link-secondary {
  color: var(--color-text-muted, #8d97a6);
  text-decoration: none;
  font-family: 'Roboto Flex', sans-serif;
  font-size: 16px;
  font-weight: 400;
  transition: color var(--motion-duration-fast, 0.15s) var(--motion-easing-standard, cubic-bezier(0.25, 0.1, 0.25, 1));
}

.link-secondary:hover {
  color: var(--color-text-primary, #ffffff); /* from pseudoStates */
  text-decoration: underline; /* inferred from screenshot */
}

.link-secondary:visited {
  color: var(--color-text-muted, #8d97a6); /* no change for visited */
}
```

### Badges
(none observed in source)

## 5. Layout Principles
-   **Spacing System**:
    -   Base unit: `4px`
    -   Scale: `[0, 4, 8, 12, 16, 20, 24, 32, 40]`
    -   Usage Context:
        -   `4px`: Smallest element spacing, e.g., icon to text.
        -   `8px`: `var(--spacing-sm)` — Minor internal padding, gaps in small components.
        -   `12px`: `var(--spacing-md)` — Padding within buttons, dropdown items.
        -   `16px`: `var(--spacing-lg)` — Standard internal padding, gaps between form elements.
        -   `20px`: `var(--spacing-xl)` — Larger component spacing, vertical rhythm.
        -   `24px`: `var(--spacing-2xl)` — Section sub-dividers, card internal spacing.
        -   `32px`: `var(--spacing-3xl)` — `var(--spacing-card-padding)` — Card padding, spacing between major content blocks.
        -   `40px`: `var(--spacing-4xl)` — Large section padding, spacing around hero elements.
-   **Grid & Container** *(Suggested — not measured)*:
    _Note: container widths and column counts are not extracted from the source. The values below are reasonable defaults inferred from the visible layout density._
    -   Max width: `1280px` (inferred from screenshot)
    -   Columns: `12` (inferred from screenshot)
    -   Gutter: `24px` (inferred from screenshot)
    -   Section padding: `64px 0` (inferred from screenshot)
-   **Whitespace Philosophy**: Melonity leverages extensive dark negative space to create a sense of depth and focus. Generous padding around components, especially cards and content blocks, ensures elements are distinct and content is easily scannable. This approach minimizes visual clutter, allowing the vibrant accent colors and strong typography to guide the user's eye.
-   **Border Radius Scale**:
    -   `sm: 8px` — Used for smaller interactive elements like dropdown items or input fields.
    -   `md: 12px` — Standard for buttons and most input fields, providing a soft, modern feel.
    -   `lg: 16px` — Applied to larger containers and cards, defining distinct content blocks.
    -   `full: 9999px` — Used for pill-shaped elements like tags or avatars (not explicitly seen but a common pattern for large radii).

## 6. Depth & Elevation
Melonity uses a subtle elevation system, primarily relying on shadows for cards and a distinct focus ring for interactive elements. Z-index values are clearly defined for stacking contexts.

-   **Background (z--2)**: `none` — Used for large background images or decorative elements that sit beneath all content.
-   **Sub-Background (z--1)**: `none` — Elements like hero section backgrounds that are behind the main content flow.
-   **Base (z-1)**: `none` — Default stacking context for most content and containers.
-   **Interactive (z-2)**: `none` — Used for the main header bar, ensuring it stays above scrolling content.
-   **Overlay (z-5)**: `none` — Specific interactive elements like statistics sections that might overlap content.
-   **Modal (z-10)**: `none` — Used for achievement content or other interactive overlays that need to sit above most UI.
-   **Dropdown (z-999)**: `none` — Highest z-index for dropdown menus, ensuring they always appear on top.

Shadow Philosophy: Melonity employs subtle shadows to provide depth without distracting from the dark aesthetic. The primary shadow, `rgba(27, 27, 27, 0.1) 0px -2px 16px 0px`, is used on cards to lift them slightly from the background. A distinct, vibrant pink focus ring, `0px 0px 0px 4px rgba(255, 20, 105, 0.2)`, is crucial for accessibility and drawing attention to interactive elements. A larger, more diffuse glow, `0px 0px 65px 17px rgba(255, 20, 105, 0.4)`, is reserved for hero sections or highlighted cards to create a powerful visual impact.

## 7. Do's and Don'ts

### Do's
-   **Do** use `Roboto Flex` with `700` weight for H1 titles at `40px` to ensure strong hierarchy.
-   **Do** apply `border-radius: 12px` (`var(--radius-md)`) to all `button` components for consistent styling.
-   **Do** ensure all body text uses `text-primary: #ffffff` on `background: #20242a` for a WCAG AAA contrast ratio of 15.59.
-   **Do** use `primary: #ff1469` for all main CTA buttons, like "Create account", with `12px 24px` padding.
-   **Do** maintain `24px` of vertical spacing (`var(--spacing-2xl)`) between distinct content cards.
-   **Do** use `text-muted: #8d97a6` for secondary text on `background: #20242a`, which provides a WCAG AA contrast ratio of 5.28.
-   **Do** implement a `0px 0px 0px 4px rgba(255, 20, 105, 0.2)` focus ring for all interactive inputs.
-   **Do** use `surface: #282d35` for card backgrounds and `background: #20242a` for the main page.
-   **Do** apply `border-radius: 16px` (`var(--radius-lg)`) to all `card` components.
-   **Do** use `var(--motion-duration-fast, 0.15s)` for all button and link hover transitions.

### Don'ts
-   **Don't** use `text-disabled: #586271` for primary body text on `background: #20242a` as it would fail WCAG AA contrast.
-   **Don't** introduce `border-radius` values other than `8px`, `12px`, or `16px` for components.
-   **Don't** use `primary: #ff1469` for body text on `text-primary: #ffffff` backgrounds; it is intended for dark surfaces.
-   **Don't** use `Roboto Flex` with `400` weight for H1 titles; reserve `700` weight for display and heading elements.
-   **Don't** use spacing values outside the `[4, 8, 12, 16, 20, 24, 32, 40]` scale.
-   **Don't** apply the `elevation-hero-glow` shadow to standard cards; reserve it for highlighted sections.
-   **Don't** use `text-primary: #ffffff` on `primary: #ff1469` for small text; the contrast ratio of 3.78 only passes AA-large.
-   **Don't** use `background: #20242a` as a button background; `surface: #282d35` or `primary: #ff1469` are preferred.
-   **Don't** omit the `border: 1px solid var(--color-border, #586271)` on `input-text` fields.
-   **Don't** use `var(--motion-duration-base, 0.3s)` for micro-interactions; prefer `var(--motion-duration-fast, 0.15s)`.

## 8. Responsive Behavior *(Suggested — not measured)*
_Note: breakpoints below are industry-standard recommendations, not measurements from the source. Adjust to the brand's actual media queries when implementing._

-   **Suggested Breakpoints**:
    -   **Mobile Small** (~375px): Stack content vertically; reduce `font-size` for `display` to `32px`.
    -   **Mobile Large** (~430px): Navigation items collapse into a hamburger menu; card padding reduces to `16px`.
    -   **Tablet** (~768px): Two-column layouts become common; `h1` font size reduces to `32px`.
    -   **Desktop** (~1200px): Standard multi-column layouts; full navigation visible.
    -   **Desktop Large** (~1440px): Max container width applies; additional horizontal padding.
-   **Touch Targets**:
    -   Ensure all interactive elements, especially buttons and links, have a minimum touch target size of `44px` by `44px`.
    -   Maintain at least `8px` of clear space around touch targets to prevent accidental taps.
-   **Collapsing Strategy**:
    -   **Navigation**: The top navigation bar should collapse into a hamburger menu at widths below `768px`.
    -   **Cards**: Multi-column card layouts should stack vertically on screens smaller than `768px`.
    -   **Typography**: `Display` and `H1` font sizes should scale down by `25-50%` on mobile.
    -   **Padding**: Section and component padding should reduce by `50%` on mobile (e.g., `40px` to `20px`).
    -   **Forms**: Input fields and form elements should stretch to `100%` width on mobile.
    -   **Spacing**: Larger spacing values (`32px`, `40px`) should be scaled down for mobile layouts.

## 9. Agent Prompt Guide
-   **Quick Color Reference**:
    -   `primary: #ff1469`
    -   `primary-hover: #e00e5e`
    -   `accent-green: #15c188`
    -   `background: #20242a`
    -   `surface: #282d35`
    -   `surface-darker: #22272d`
    -   `text-primary: #ffffff`
    -   `text-muted: #8d97a6`
    -   `text-secondary: #b9c0cb`
    -   `text-disabled: #586271`
    -   `border: #586271`
    -   `border-light: #ffffff`
    -   `focus-ring: rgba(255, 20, 105, 0.2)`
-   **Iteration Guide**:
    1.  Always use `Roboto Flex` as the primary font family.
    2.  Always use `primary: #ff1469` for main call-to-action buttons.
    3.  Always set `border-radius: 12px` (`var(--radius-md)`) for all buttons and inputs.
    4.  Always use `padding: 12px 24px` for standard buttons.
    5.  Always use `text-primary: #ffffff` for body text on `background: #20242a`.
    6.  Always apply a `0px 0px 0px 4px rgba(255, 20, 105, 0.2)` focus ring to interactive elements.
    7.  Always use `surface: #282d35` for card backgrounds with `border-radius: 16px` (`var(--radius-lg)`).
    8.  Always use `var(--motion-duration-fast, 0.15s)` for hover transitions on buttons and links.
    9.  Always ensure sufficient contrast; `text-muted: #8d97a6` on `background: #20242a` is the minimum acceptable for body text.
    10. Always use the `4px` spacing base and its derived scale for all layout and component spacing.
    11. Always collapse main navigation into a hamburger menu on screens below `768px`.
    12. Always use `elevation-card` shadow for standard cards and `elevation-hero-glow` for highlighted sections.