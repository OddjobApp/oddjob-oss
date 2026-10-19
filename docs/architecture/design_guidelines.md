# Odd Job Design Guidelines

## Design Approach
**System-Based Approach**: Enterprise productivity application following Material Design principles adapted for data-intensive workflows. Prioritizes clarity, efficiency, and information density over visual flourish.

**Reference Inspiration**: Linear (clean data tables), Vercel Dashboard (status indicators), Render Dashboard (system monitoring), Supabase (developer-focused UI)

## Core Design Principles
1. **Information Hierarchy**: Dense data presentation with clear visual separation
2. **Status-First Design**: Immediate visual feedback on job states, execution results, alerts
3. **Minimal Cognitive Load**: Consistent patterns across all admin screens
4. **Performance Transparency**: Always show system state, loading indicators, execution metrics

---

## Typography

**Font Stack**: System font stack for optimal performance and readability
- Primary: `font-sans` (system: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto)
- Monospace: For code blocks, logs, credentials: `font-mono`

**Hierarchy**:
- Page Titles: `text-2xl font-semibold` (24px)
- Section Headers: `text-lg font-semibold` (18px)
- Card Titles: `text-base font-medium` (16px)
- Body Text: `text-sm` (14px)
- Labels/Metadata: `text-xs font-medium uppercase tracking-wider` (12px)
- Data Tables: `text-sm` (14px, ensuring scannability)

---

## Layout System

**Spacing Units**: Tailwind scale focusing on 2, 4, 6, 8, 12, 16, 20, 24
- Component padding: `p-5` (20px) standard, `p-6` (24px) for dialogs
- Section gaps: `space-y-6` between major sections
- Card spacing: `gap-6` in grids
- Form fields: `space-y-4` for vertical rhythm
- Table cells: `px-6 py-4` for comfortable data scanning

**Grid Systems**:
- Dashboard stats: `grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6`
- Job/Schedule cards: `grid-cols-1 lg:grid-cols-2 gap-6`
- Full-width data tables with horizontal scroll

**Container**: `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8` (Standard) or `w-full max-w-full px-4` (Cinematic high-density dashboards like Stage Cycle and Cycle Details).

---

## Component Library

**Buttons**:
- Primary: Indigo filled (`bg-indigo-600 hover:bg-indigo-700`)
- Secondary: Gray outlined (`border border-gray-300 hover:bg-gray-50`)
- Destructive: Red filled (`bg-red-600 hover:bg-red-700`)
- Ghost: Transparent with hover (`hover:bg-gray-100`)
- Sizes: `h-8 px-3 text-xs` (sm), `h-10 px-4 text-sm` (default), `h-12 px-6 text-base` (lg)

**Status Badges**:
- Success: `bg-green-100 text-green-800` (completed jobs, active status)
- Warning: `bg-yellow-100 text-yellow-800` (pending, retrying)
- Critical/Error: `bg-red-100 text-red-800` (failed jobs, critical alerts)
- Info: `bg-blue-100 text-blue-800` (scheduled, informational)
- Neutral: `bg-gray-100 text-gray-800` (inactive, disabled)

**Data Tables**:
- Header: `bg-gray-50` with uppercase `text-xs font-medium text-gray-500`
- Row hover: `hover:bg-gray-50 transition`
- Borders: `divide-y divide-gray-200`
- Action columns: Right-aligned with icon buttons

**Cards**:
- Background: `bg-white`
- Borders: `border border-gray-200 rounded-xl`
- Shadows: `shadow-lg` for elevation
- Header separator: `border-b border-gray-200`

**Forms**:
- Inputs: `border-gray-300 focus:ring-indigo-500 focus:border-indigo-500 rounded-lg`
- Labels: `text-sm font-medium text-gray-700 mb-1`
- Help text: `text-xs text-gray-500 mt-1`
- Error states: `border-red-300 focus:ring-red-500 text-red-600`

**Dialogs/Modals**:
- Overlay: `bg-gray-900 bg-opacity-50`
- Container: `max-w-lg rounded-xl shadow-2xl`
- Fixed header with close button (X icon)
- Scrollable content area

**Navigation Sidebar**:
- Width: `w-64` fixed on desktop
- Background: `bg-white border-r border-gray-200`
- Active item: `bg-indigo-50 text-indigo-600 border-l-4 border-indigo-600`
- Hover: `hover:bg-gray-50`
- Icons: 20px lucide-react icons with `mr-3` spacing

---

## Screen-Specific Patterns

**Dashboard**: 4-column stat cards (Jobs, Executions, Alerts, Pipelines) → Recent Executions table → Alerts list → Activity timeline

**Data Management Screens** (Jobs, Schedules, Credentials, Users): 
- Page header with title + "Create New" button (top-right)
- Filter/search bar below header
- Data table with sortable columns
- Row actions: Edit, Delete, Test (icon buttons)
- Empty states with illustration + "Create First" CTA

**Execution Details**: Split view - metadata sidebar (left 1/3) + log output terminal (right 2/3, `bg-gray-900 text-green-400 font-mono`)

**Alert Screen**: Severity filter tabs → Table with color-coded rows → Acknowledge action

**Login Screen**: Centered card (`max-w-md`) with logo, form, and subtle background pattern

---

## Visual Polish

**Shadows**: Subtle depth hierarchy
- Cards: `shadow-lg`
- Dropdowns: `shadow-xl`
- Dialogs: `shadow-2xl`

**Transitions**: `transition-colors` on interactive elements (150ms default)

**Loading States**: Spinner icon with "Loading..." text, skeleton screens for tables

**Icons**: Lucide React at 20px for navigation, 16px for inline actions

---

## No Images
This is a pure enterprise application - no hero images or marketing visuals. Focus entirely on functional UI, data visualization, and clear information architecture.