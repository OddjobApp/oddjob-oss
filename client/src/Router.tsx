import { BrowserRouter, Routes, Route } from "react-router-dom";
import MarketingPage from "./pages/marketing/MarketingPage";
import App from "./App";
import AuthPage from "@domain-ui/auth/ui/modules/auth/pages/AuthPage";
import CodeModificationPage from "./pages/admin/code-modification";
import McpMarketplacePage from "./pages/admin/mcp-marketplace";
// Default import: WorkflowHistoryPage.tsx exports the component as its default
// and does not export the name. A named import here resolved to `undefined`,
// which React only reports when the route is rendered ("Element type is
// invalid"), so it survived as a type error rather than a visible crash.
import WorkflowHistoryPage from "./components/signal-intelligence/spatial/WorkflowHistoryPage";

export function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MarketingPage />} />
        <Route path="/login" element={<AuthPage />} />
        <Route path="/launchpad" element={<App />} />
        <Route path="/launch" element={<App />} />
        <Route path="/dashboard" element={<App />} />
        <Route path="/signal-intelligence/*" element={<App />} />
        <Route path="/admin/code-modification" element={<CodeModificationPage />} />
        <Route path="/admin/mcp-marketplace" element={<McpMarketplacePage />} />
        <Route path="*" element={<App />} />
      </Routes>
    </BrowserRouter>
  );
}
