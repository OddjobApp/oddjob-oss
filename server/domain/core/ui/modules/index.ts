// Public API for the Dashboard pod

// Pages
export { default as DashboardPage } from './pages/Dashboard.js';
export { default as CostDashboard } from './pages/CostDashboard.js';

// Components
export { default as Dashboard } from './components/Dashboard.js';
export { ActivityTimeline } from './components/ActivityTimeline.js';
export { ProactiveInsightsCard } from './components/ProactiveInsightsCard.js';
export { default as Alerts } from './components/Alerts.js';
export { default as Executions } from './components/Executions.js';
export { DashboardCustomizer } from './components/DashboardCustomizer.js';
export { FilterBar } from './components/FilterBar.js';
export { UniversalSearch, useUniversalSearch } from './components/UniversalSearch.js';
export { AVAILABLE_WIDGETS, DEFAULT_LAYOUT_WIDGETS } from './components/WidgetRegistry.js';

// Types
export * from './types/index.js';
