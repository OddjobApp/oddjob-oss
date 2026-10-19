import { Link, useLocation } from "wouter";
import { Home } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@domain-ui/core/ui/components/ui/breadcrumb";

interface BreadcrumbItemProps {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items?: BreadcrumbItemProps[];
  className?: string;
}

// Route to label mapping
const routeLabels: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/jobs": "Jobs",
  "/schedules": "Schedules",
  "/scheduled-jobs": "Scheduled Jobs",
  "/monitoring": "Monitoring",
  "/observability": "Observability",
  "/alerts": "Alerts",
  "/events": "Events",
  "/pulse": "Pulse",
  "/pipelines": "Pipelines",
  "/dashboard/forms": "Forms",
  "/armory": "Apps & Forge",
  "/armory/apps": "App Arsenal",
  "/armory/forge": "Forge Studio",
  "/armory/forge/history": "Forge History",
  "/armory/forge/settings": "Forge Settings",
  "/armory/org-forge": "Org Forge",
  "/armory/forms": "Forms",
  "/armory/forms/builder": "Form Builder",
  "/forms": "Forms",
  "/insights": "Insights",
  "/insights/roi": "ROI & Value",
  "/insights/costs": "Cost Center",
  "/insights/tools": "Tool Analytics",
  "/insights/agents": "Agent Analytics",
  "/insights/scoring": "Scoring",
  "/insights/prediction": "Prediction Intelligence",
  "/analytics": "Cost Center",
  "/analytics/roi": "ROI & Value",
  "/account-admin": "Account & Admin",
  "/account-admin/organizations": "Organizations",
  "/account-admin/users": "Users",
  "/account-admin/billing": "Billing",
  "/account-admin/licensing": "Licensing",
  "/platform-maintenance": "Platform Maintenance",
  "/platform-maintenance/snapshots": "Snapshots",
  "/platform-maintenance/documentation": "Documentation",
  "/platform-maintenance/software-audit": "Software Audit",
  "/platform-maintenance/evolution": "System Evolution",
  "/platform-maintenance/autoresearch": "Autoresearch",
  "/platform-maintenance/system-graph": "System Graph",
  "/health": "Health",
  "/health/observability": "Observability",
  "/health/monitoring": "Monitoring",
  "/health/alerts": "Alerts",
  "/health/events": "Events",
  "/health/pulse": "Pulse",
  "/health/incidents": "Incidents",
  "/health/infra-health": "Infra Health",
  "/connections": "Connections",
  "/connections/credentials": "Credentials",
  "/connections/credentials/new": "Add Credential",
  "/connections/integrations": "Integrations",
  "/connections/mcp-tokens": "MCP Tokens",
  "/connections/saas": "SaaS Connectors",
  "/connections/saas/workflows": "Event Workflows",
  "/connections/saas/sync-config": "Sync Config",
  "/connections/saas/analytics": "SaaS Analytics",
  "/credentials": "Credentials",
  "/credentials/new": "Add Credential",
  "/knowledge": "Knowledge",
  "/knowledge/store": "Knowledge Store",
  "/knowledge-store": "Knowledge Store",
  "/knowledge/graph": "Knowledge Graph",
  "/knowledge/search": "Search",
  "/knowledge/query-builder": "Query Builder",
  "/knowledge/datasets": "Datasets",
  "/knowledge/fine-tuning": "Fine-Tuning",
  "/knowledge/scoring": "Scoring",
  "/knowledge/garden": "Knowledge Garden",
  "/knowledge/schemas": "Schemas",
  "/knowledge/document-templates": "Document Templates",
  "/knowledge/status": "Knowledge Status",
  "/knowledge/compare-runs": "Compare Runs",
  "/organizations": "Organizations",
  "/users": "Users",
  "/billing": "Billing",
  "/admin/licensing": "Licensing",
  "/snapshots": "Snapshots",
  "/admin/documentation": "Documentation",
  "/admin/dependencies": "Software Audit",
  "/admin/evolution": "System Evolution",
  "/admin/autoresearch": "Autoresearch",
  "/admin/system-graph": "System Graph",
  "/admin/events": "Events",
  "/admin/alerts": "Alerts",
  "/admin/diagnoses": "Incidents",
  "/admin/infra-health": "Infra Health",
  "/tactics/tools": "Tool Registry",
  "/admin/integrations": "Integrations",
  "/admin/mcp-tokens": "MCP Tokens",
  "/saas": "SaaS Connectors",
  "/saas/connectors": "SaaS Connectors",
  "/saas/workflows": "Event Workflows",
  "/saas/sync-config": "Sync Config",
  "/saas/analytics": "SaaS Analytics",
  "/settings": "Settings",
  "/profile": "Profile",
};

// Generate breadcrumbs from current path
function generateBreadcrumbs(path: string): BreadcrumbItemProps[] {
  const items: BreadcrumbItemProps[] = [{ label: "Home", href: "/dashboard" }];

  if (path === "/dashboard") {
    return items;
  }

  const segments = path.split("/").filter(Boolean);
  let currentPath = "";

  segments.forEach((segment, index) => {
    currentPath += `/${segment}`;
    const isLast = index === segments.length - 1;

    // Try to get label from mapping, or format the segment
    const label = routeLabels[currentPath] ||
      segment.split("-").map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");

    items.push({
      label,
      href: isLast ? undefined : currentPath,
    });
  });

  return items;
}

export default function AppBreadcrumb({ items, className }: BreadcrumbProps) {
  const [location] = useLocation();
  const breadcrumbItems = items || generateBreadcrumbs(location);

  if (breadcrumbItems.length <= 1 && location === '/dashboard') {
    return null;
  }

  return (
    <Breadcrumb className={className}>
      <BreadcrumbList>
        {breadcrumbItems.map((item, index) => {
          const isLast = index === breadcrumbItems.length - 1;
          const isHome = index === 0;

          return (
            <div key={item.href || item.label} className="flex items-center">
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem className={index > 0 ? "ml-2" : ""}>
                {isLast ? (
                  <BreadcrumbPage>{item.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={item.href || "#"} className="flex items-center gap-1">
                      {isHome && <Home className="w-4 h-4" />}
                      <span>{item.label}</span>
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </div>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
