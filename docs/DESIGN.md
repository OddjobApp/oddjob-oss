# Design System: Oddjob Agentic Agency (Cinematic Edition)
**Project ID:** oddjob-483505

## 1. Visual Theme & Atmosphere
The Oddjob design philosophy has evolved into **Cinematic Utilitarian**. It draws inspiration from orbital interfaces and high-end automotive design, characterized by a "grounded but elevated" aesthetic.
- **Dramatic Glassmorphism**: High-intensity backdrop blurs (`backdrop-blur-2xl`) with multi-layered border semi-transparency.
- **Warm Earth Contrast**: A sophisticated blend of Espresso and Obsidian against warm Tan backgrounds, accented by Vibrant Bronze.
- **Heavy Curvature**: Container rounding is pushed to `2rem` (32px), creating a premium, almost architectural feel.

## 2. Color Palette & Roles

| Color Name | Hex / Variable | Functional Role |
| :--- | :--- | :--- |
| **Espresso Dark** | `#2D241E` | **Foreground**: Primary text and deep branding elements. |
| **Tan Background** | `hsl(35, 30%, 96%)` | **Neutral**: The base canvas of the application. |
| **Vibrant Bronze** | `#CD7F32` | **Accent**: Used for active states, highlighting, and primary buttons in Dark Mode. |
| **Primary Mocha** | `#4B3D33` | **Base Action**: Main primary color for headers and major UI components. |
| **Accent Tan** | `#A68D7B` | **Muted**: Secondary text and softer decorative borders. |
| **Deep Charcoal** | `hsl(25, 10%, 12%)` | **Dark Canvas**: The base background for "Atmospheric" dark mode. |

## 3. Typography Rules
- **Primary Font**: **Inter** - Chosen for its technical precision and elegant character at large weights.
- **Secondary Font**: **Roboto** - Retained for its data-readability in technical tables and grids.
- **Styling**: Headers are **Black Weight** (`font-black`) with tight tracking and high-contrast colors.

## 4. Layout & Motion
- **Floating Headers**: The primary navigation is a detached, glassmorphic capsule floating at the top of the viewport.
- **Micro-Animations**:
  - **Float**: Subtle vertical hovering on brand elements and cards.
  - **Glass Glow**: Soft shadow-glows around active buttons and avatars.
- **Border Logic**: Multi-layered borders (`border-white/20`) are used to create depth on glass surfaces.

## 5. UI Primitives
* **Capsules**: Used for the Header and primary interactive elements (2rem rounding).
* **Avatar Badging**: Avatars are wrapped in bronze/mocha gradients with emerald status rings.
* **Semantic Depth**: Use of "Atmospheric" vs "Orbital" modes instead of standard light/dark.

> **Theming is live in both modes.** The app is dark-first ("Atmospheric") but light ("Orbital") mode is fully supported and **user-toggleable** from the sidebar and mobile menu. Both are driven by a single semantic-token system (`bg-background`, `bg-card`, `text-foreground`, `border-border`, …) defined as HSL variables in `client/src/index.css` — `:root` = light, `.dark` = dark. New UI must style through these tokens rather than hardcoding colors; the `npm run lint:theme` CI gate enforces it. See [Frontend Architecture → §6 Theming & Semantic Tokens](./frontend_architecture.md#6-ui-system--design-language) for the developer contract.

## 6. Iterative Wave-Based Governance
The App Forge utilizes a **Surgical Drafting** lifecycle, suspending execution at key industrial gateways for human review:
- **Wave 1: MMF (Minimum Maintainable Feature)**: Focused on the core functional objective. Establishes the "Draft" state in the arsenal.
- **Wave 2: Expansion**: Introduces secondary features, refined UX, and extended logic based on Wave 1 review.
- **Wave 3: Polish & Hardening**: Final industrialization, security audits, and production-ready performance tuning.

**HIL Interaction**: Governance panels utilize a distinct "Review Mode" with amber accents and pulsing status indicators to signal required human steering.
