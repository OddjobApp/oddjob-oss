# Oddjob App Forge - Visual Editor Solution & Block Expansion

**Date:** May 6, 2026  
**Focus:** Detailed Visual Editor Architecture & New Block Recommendations  
**Status:** Implementation Ready

---

## Part 1: Additional Blocks Needed

### Analysis of Current Block Registry

**Current State:** 23 blocks in `block-registry.json`
- 6 Display Blocks (IndustrialDashboardHero, MissionControlTable, etc.)
- 17 Platform-Wired Self-Wiring Blocks

**Gap Identified:** Missing **content presentation blocks** for marketing sites, portfolios, and media-rich applications.

---

### 🎯 New Blocks to Add

#### Content & Media Blocks (High Priority)

| Block ID | Name | Purpose | Props | Platform Integration |
|----------|------|---------|-------|---------------------|
| **PlatformMediaGalleryBlock** | Media Gallery (Self-Wiring) | Image/video carousel with dataset-backed media | `collection`, `mediaField`, `titleField`, `layout: 'grid' \| 'carousel'`, `autoPlay`, `lightbox` | Reads media URLs from dataset records |
| **PlatformContentCarouselBlock** | Content Carousel (Self-Wiring) | Testimonials, features, news from dataset | `collection`, `cardTemplate`, `autoPlay`, `interval`, `showIndicators` | Dynamic content from dataset |
| **PlatformHeroSliderBlock** | Hero Slider (Self-Wiring) | Full-width hero carousel | `collection`, `slides`, `height`, `overlay`, `ctaField` | Marketing content from dataset |
| **PlatformImageComparisonBlock** | Before/After Slider | Visual comparisons | `beforeImage`, `afterImage`, `orientation` | Images from dataset |
| **PlatformVideoGalleryBlock** | Video Collection Player | YouTube/Vimeo playlist | `collection`, `videoField`, `thumbnailField`, `layout` | Video URLs from dataset |
| **PlatformSocialFeedBlock** | Social Media Feed | Display social posts | `platform`, `collection`, `usernameField` | Aggregated social data |

#### E-commerce & Business Blocks (Medium Priority)

| Block ID | Name | Purpose | Props | Platform Integration |
|----------|------|---------|-------|---------------------|
| **PlatformProductGridBlock** | Product Grid/Listing | E-commerce product display | `collection`, `cartEnabled`, `filters`, `sortOptions` | Product dataset |
| **PlatformShoppingCartBlock** | Shopping Cart Widget | Cart summary and checkout | `collection`, `checkoutPipelineId` | Cart dataset + pipeline trigger |
| **PlatformBookingCalendarBlock** | Appointment Booking | Calendar with booking slots | `collection`, `availabilityField`, `duration` | Booking dataset |
| **PlatformPaymentFormBlock** | Payment Collection | Stripe/PayPal integration | `amount`, `currency`, `successPipelineId` | Payment pipeline |

#### Advanced Data Blocks (Medium Priority)

| Block ID | Name | Purpose | Props | Platform Integration |
|----------|------|---------|-------|---------------------|
| **PlatformKanbanBoardBlock** | Kanban/Task Board | Trello-style board | `collection`, `statusField`, `assigneeField` | Task dataset |
| **PlatformGanttChartBlock** | Project Timeline | Gantt visualization | `collection`, `startField`, `endField`, `dependencyField` | Project dataset |
| **PlatformTreeViewBlock** | Hierarchical Data | Tree navigation | `collection`, `parentField`, `childrenField` | Hierarchical dataset |
| **PlatformCalendarBlock** | Full Calendar View | Event calendar | `collection`, `dateField`, `titleField`, `colorField` | Event dataset |
| **PlatformMapDataLayerBlock** | Map with Data Points | Mapbox + dataset pins | `collection`, `latField`, `lngField`, `popupTemplate` | Geospatial dataset |

#### Utility Blocks (Lower Priority)

| Block ID | Name | Purpose | Props |
|----------|------|---------|-------|
| **PlatformCountdownBlock** | Countdown Timer | Event countdown | `targetDate`, `format`, `expiredMessage` |
| **PlatformQRCodeBlock** | QR Code Generator | QR for URLs/data | `value`, `size`, `label` |
| **PlatformFileUploadBlock** | File Upload Widget | Drag-drop upload | `collection`, `accept`, `maxSize`, `multiple` |
| **PlatformRichTextEditorBlock** | WYSIWYG Editor | Rich content editing | `collection`, `field`, `placeholder` |

#### Advanced AI & Agent Blocks (High Priority - Differentiation)

| Block ID | Name | Purpose | Props | Platform Integration |
|----------|------|---------|-------|---------------------|
| **PlatformAgentSwarmBlock** | Multi-Agent Swarm UI | Orchestrate multiple agents on same task | `agentIds`, `coordinatorPrompt`, `consensusThreshold` | Multi-agent coordination API |
| **PlatformAgentComparisonBlock** | Agent Response Comparison | Side-by-side agent outputs | `agentIds`, `prompt`, `comparisonCriteria` | Parallel agent execution |
| **PlatformPromptEngineeringBlock** | Prompt Versioning & Testing | A/B test prompts with metrics | `promptVersions`, `testDataset`, `metricPipeline` | Pipeline-powered evaluation |
| **PlatformRAGDebuggerBlock** | RAG Debug Visualizer | Show retrieved chunks, scores, relevance | `query`, `topicId`, `showChunkDetails` | Knowledge graph query |
| **PlatformAIObservabilityBlock** | AI Performance Monitor | Track latency, tokens, costs per agent | `agentId`, `timeRange`, `granularity` | Agent telemetry API |
| **PlatformConversationTreeBlock** | Branching Conversation Designer | Visual flow for multi-turn AI | `treeData`, `nodeTypes`, `exitConditions` | Agent session management |
| **PlatformEmbeddingExplorerBlock** | Vector Similarity Explorer | Visualize embedding clusters | `collection`, `dimensionReduction`, `searchQuery` | Vector DB query |
| **PlatformModelRouterBlock** | Smart Model Selection | Route to optimal model per query | `routingRules`, `fallbackModel`, `costCap` | Multi-model orchestration |

#### Integration & Webhook Blocks (High Priority - Connectivity)

| Block ID | Name | Purpose | Props | Platform Integration |
|----------|------|---------|-------|---------------------|
| **PlatformWebhookListenerBlock** | Webhook Endpoint UI | Monitor incoming webhooks live | `endpointPath`, `eventTypes`, `payloadPreview` | Webhook ingestion service |
| **PlatformAPIExplorerBlock** | API Test Console | Test platform APIs with UI | `endpoint`, `method`, `authType`, `paramBuilder` | API proxy service |
| **PlatformEventStreamBlock** | Real-time Event Feed | SSE event visualization | `eventTypes`, `filterRules`, `maxEvents` | Event streaming API |
| **PlatformThirdPartyAuthBlock** | OAuth Connector | Connect external services | `providers`, `scopes`, `tokenRefresh` | OAuth service |
| **PlatformDataSyncBlock** | Sync Status Dashboard | Show sync jobs, conflicts, resolutions | `sourceConnection`, `targetDataset`, `syncSchedule` | Sync pipeline |
| **PlatformIntegrationHealthBlock** | Health Check Monitor | Status of all integrations | `integrations`, `checkInterval`, `alertRules` | Health check API |
| **PlatformSchemaMapperBlock** | Field Mapping UI | Visual mapping between schemas | `sourceSchema`, `targetSchema`, `mappings` | Schema transformation |
| **PlatformAPIGatewayBlock** | Rate Limit & Quota UI | Monitor API usage, quotas | `apiKeys`, `rateLimits`, `usageMetrics` | API gateway metrics |

#### User Experience & Onboarding Blocks (Medium Priority - Engagement)

| Block ID | Name | Purpose | Props |
|----------|------|---------|-------|
| **PlatformOnboardingTourBlock** | Interactive Product Tour | Step-by-step user guidance | `steps`, `trigger`, `progressPersistence` |
| **PlatformInAppAnnouncementBlock** | News/Updates Banner | Display announcements | `announcements`, `dismissible`, `priority` |
| **PlatformFeedbackCollectorBlock** | NPS/CSAT Widget | Collect user feedback | `question`, `scale`, `followUpQuestions` |
| **PlatformFeatureFlagBlock** | Feature Toggle UI | Show/hide based on flags | `flagKey`, `defaultValue`, `overrideControls` |
| **PlatformUserProfileCardBlock** | User Identity Display | Show user info, roles, permissions | `userId`, `showPermissions`, `editableFields` |
| **PlatformActivityFeedBlock** | User Activity Stream | Recent actions, notifications | `userId`, `activityTypes`, `timeRange` |
| **PlatformNotificationCenterBlock** | Unified Notifications | Bell icon with notification list | `channels`, `readStatus`, `actions` |
| **PlatformSearchAutocompleteBlock** | Smart Search Bar | Global search with suggestions | `indexes`, `filters`, `recentSearches` |
| **PlatformCommandPaletteBlock** | Quick Action Launcher | Cmd+K style command menu | `commands`, `hotkeys`, `contextAware` |
| **PlatformThemeCustomizerBlock** | Live Theme Editor | Adjust colors, fonts, spacing | `themeVariables`, `previewMode`, `saveAction` |

#### Analytics & Monitoring Blocks (Medium Priority - Insights)

| Block ID | Name | Purpose | Props | Platform Integration |
|----------|------|---------|-------|---------------------|
| **PlatformMetricsDashboardBlock** | Custom Metrics Builder | Build visual dashboards from any data | `metricQueries`, `visualizationTypes`, `timeRange` | Metrics API |
| **PlatformFunnelAnalysisBlock** | Conversion Funnel | Step-by-step drop-off analysis | `steps`, `conversionEvents`, `segmentBy` | Analytics pipeline |
| **PlatformCohortAnalysisBlock** | Cohort Retention Table | User retention over time | `cohortDefinition`, `metric`, `timeBuckets` | Cohort query API |
| **PlatformABTestResultsBlock** | Experiment Results | Statistical significance, winners | `experimentId`, `metrics`, `confidenceLevel` | A/B testing service |
| **PlatformRealTimeMetricsBlock** | Live Metric Ticker | Auto-updating KPIs | `metrics`, `refreshInterval`, `sparklines` | Real-time metrics |
| **PlatformAnomalyDetectionBlock** | Anomaly Alert Panel | Unusual patterns highlighted | `baselineMetrics`, `sensitivity`, `alertChannels` | Anomaly detection API |
| **PlatformUsageHeatmapBlock** | Feature Usage Heatmap | Visual usage patterns | `featureEvents`, `timeGranularity`, `userSegments` | Event aggregation |
| **PlatformPerformanceProfilerBlock** | App Performance Monitor | Load times, errors, bottlenecks | `routes`, `thresholds`, `traceDetails` | Performance API |
| **PlatformCostExplorerBlock** | Cost Breakdown | AI spend, infra costs by app | `costCategories`, `timeRange`, `forecastEnabled` | Billing API |

#### Collaboration & Communication Blocks (Medium Priority - Team)

| Block ID | Name | Purpose | Props | Platform Integration |
|----------|------|---------|-------|---------------------|
| **PlatformCommentsThreadBlock** | Inline Commenting | Comments on any record | `targetId`, `targetType`, `mentionUsers` | Comment service |
| **PlatformActivityLogBlock** | Audit Trail Viewer | Complete change history | `entityType`, `entityId`, `userFilter` | Audit log API |
| **PlatformTeamPresenceBlock** | Who's Online | Real-time user presence | `teamId`, `statusIndicators`, `lastSeen` | Presence service |
| **PlatformSharedCursorBlock** | Multiplayer Cursors | See others' cursor positions | `roomId`, `showNames`, `cursorStyle` | Collaboration WS |
| **PlatformMentionsInboxBlock** | @Mentions Feed | All mentions across apps | `userId`, `filterStatus`, `quickReply` | Notification service |
| **PlatformApprovalWorkflowBlock** | Multi-Step Approvals | Visual approval chains | `workflowId`, `stages`, `escalationRules` | Approval engine |
| **PlatformTeamWorkloadBlock** | Capacity Planning | Team member load visualization | `teamId`, `taskSource`, `capacityFields` | Work allocation API |
| **PlatformHandoffBlock** | Session Transfer | Pass context between users | `sessionData`, `recipientId`, `transferNotes` | Session management |

#### Workflow & Automation Blocks (High Priority - Productivity)

| Block ID | Name | Purpose | Props | Platform Integration |
|----------|------|---------|-------|---------------------|
| **PlatformWorkflowBuilderBlock** | Visual Workflow Designer | Drag-drop automation builder | `workflowId`, `steps`, `triggers`, `conditions` | Workflow engine |
| **PlatformSchedulerBlock** | Cron Job Manager | Schedule recurring tasks | `jobs`, `timezone`, `executionHistory` | Scheduler service |
| **PlatformTriggerManagerBlock** | Event Trigger Hub | Manage all event listeners | `triggers`, `eventTypes`, `actionMappings` | Event system |
| **PlatformDataTransformerBlock** | ETL Pipeline Builder | Visual data transformation | `source`, `transformations`, `destination` | Pipeline designer |
| **PlatformConditionalLogicBlock** | If/Then/Else Builder | Business rules engine | `conditions`, `actions`, `elseActions` | Rules engine |
| **PlatformApprovalChainBlock** | Sequential Approvals | Multi-person sign-off | `approvers`, `timeoutRules`, `reminders` | Approval service |
| **PlatformNotificationBuilderBlock** | Multi-Channel Alerts | Build notification flows | `channels`, `templates`, `deliveryRules` | Notification orchestrator |
| **PlatformEscalationBlock** | Auto-Escalation Manager | Timeout-based escalations | `escalationRules`, `tiers`, `notificationPrefs` | Escalation engine |
| **PlatformBatchProcessorBlock** | Bulk Operation UI | Process many records at once | `collection`, `operation`, `batchSize`, `filters` | Batch job API |
| **PlatformFormWorkflowBlock** | Form + Approval Chain | Form submission triggers workflow | `formId`, `postSubmitActions`, `routingRules` | Form workflow engine |

#### Security & Compliance Blocks (High Priority - Enterprise)

| Block ID | Name | Purpose | Props | Platform Integration |
|----------|------|---------|-------|---------------------|
| **PlatformAccessControlBlock** | Permission Matrix | Visual role/permission editor | `resourceType`, `roles`, `permissions` | RBAC service |
| **PlatformDataRetentionBlock** | Retention Policy Manager | Manage data lifecycle | `policies`, `schedule`, `auditLogs` | Compliance API |
| **PlatformPIIScannerBlock** | Sensitive Data Detector | Find and redact PII | `scanScope`, `piiTypes`, `redactionRules` | Data classification |
| **PlatformAuditExporterBlock** | Compliance Export | Generate compliance reports | `dateRange`, `eventTypes`, `format` | Audit service |
| **PlatformConsentManagerBlock** | Privacy Consents | Track user consent status | `consentTypes`, `userId`, `expiryRules` | Consent management |
| **PlatformSecurityScorecardBlock** | Security Health Check | Overall security metrics | `categories`, `scoring`, `recommendations` | Security scan API |
| **PlatformDataLineageBlock** | Data Flow Visualizer | Show data origins and flow | `datasetId`, `depth`, `transformationNodes` | Lineage API |
| **PlatformEncryptionStatusBlock** | Encryption Monitor | Field-level encryption status | `collection`, `encryptedFields`, `keyRotation` | Encryption service |
| **PlatformSessionMonitorBlock** | Active Session Manager | View/revoke user sessions | `userId`, `sessionDetails`, `revokeAction` | Session management |

#### Advanced Visualization Blocks (Medium Priority - Rich UI)

| Block ID | Name | Purpose | Props |
|----------|------|---------|-------|
| **PlatformSankeyDiagramBlock** | Flow Visualization | Show flow between categories | `nodes`, `links`, `colorScheme` |
| **PlatformChordDiagramBlock** | Relationship Web | Circular relationship diagram | `matrix`, `labels`, `colors` |
| **PlatformTreemapBlock** | Hierarchical Rectangles | Space-filing hierarchy | `treeData`, `valueField`, `colorField` |
| **PlatformSunburstBlock** | Radial Hierarchy | Multi-level pie chart | `hierarchy`, `depth`, `arcWidth` |
| **PlatformForceGraphBlock** | Network Visualization | Node-link force simulation | `nodes`, `links`, `forces` |
| **PlatformHeatmapGridBlock** | Matrix Heatmap | 2D density visualization | `gridData`, `xLabels`, `yLabels`, `colorScale` |
| **PlatformSparklineGridBlock** | Mini Charts Grid | Multiple sparklines | `series`, `width`, `height` |
| **PlatformBulletChartBlock** | Performance vs Target | Bullet-style metrics | `measures`, `ranges`, `markers` |
| **PlatformPictogramBlock** | Icon-based Chart | Isotype visualization | `value`, `icon`, `totalIcons` |
| **PlatformWordCloudBlock** | Text Frequency Cloud | Tag/word visualization | `words`, `weights`, `colorPalette` |
| **PlatformTimelineBlock** | Horizontal Timeline | Event sequences | `events`, `orientation`, `groupBy` |
| **PlatformOrgChartBlock** | Organization Hierarchy | Tree org structure | `orgData`, `expandable`, `searchable` |
| **PlatformMermaidBlock** | Diagram as Code | Mermaid.js diagrams | `diagramDefinition`, `theme` |

#### Specialized Industry Blocks (Lower Priority - Verticals)

| Block ID | Name | Purpose | Industry | Platform Integration |
|----------|------|---------|----------|---------------------|
| **PlatformPatientRecordBlock** | Healthcare Patient View | Medical history, vitals | Healthcare | HIPAA-compliant dataset |
| **PlatformLabResultsBlock** | Lab Test Display | Test results, trends | Healthcare | Lab integration API |
| **PlatformInsuranceClaimBlock** | Claim Status Tracker | Claims, approvals, payments | Insurance | Claims dataset |
| **PlatformPolicyDocumentBlock** | Policy Document Viewer | Terms, coverage details | Insurance | Document management |
| **PlatformPropertyListingBlock** | Real Estate Listing | Property details, tours | Real Estate | Property dataset |
| **PlatformLeaseManagementBlock** | Lease Agreement UI | Leases, renewals, payments | Real Estate | Lease dataset |
| **PlatformCoursePlayerBlock** | LMS Course Viewer | Lessons, progress, quizzes | Education | Course content API |
| **PlatformGradebookBlock** | Student Grades | Scores, attendance, analytics | Education | Student information |
| **PlatformInventoryBlock** | Stock Management | Levels, alerts, reordering | Retail/Logistics | Inventory dataset |
| **PlatformShipmentTrackerBlock** | Delivery Tracking | Routes, ETAs, notifications | Logistics | Shipment tracking API |
| **PlatformLegalMatterBlock** | Case Management | Cases, documents, billing | Legal | Matter management |
| **PlatformContractReviewBlock** | Contract Analysis | Redlines, approvals, signatures | Legal | Contract lifecycle |
| **PlatformPortfolioBlock** | Investment Portfolio | Holdings, performance, allocation | Finance | Portfolio dataset |
| **PlatformRiskDashboardBlock** | Risk Metrics | VaR, exposures, stress tests | Finance | Risk calculation engine |

---

### Implementation Priority (Expanded)

**Phase 1 (This Week):**
1. `PlatformMediaGalleryBlock` - Most requested for marketing sites
2. `PlatformContentCarouselBlock` - Testimonials, features
3. `PlatformCalendarBlock` - Event management apps
4. `PlatformAgentSwarmBlock` - AI differentiation
5. `PlatformWebhookListenerBlock` - Integration demand

**Phase 2 (Next 2 Weeks):**
6. `PlatformKanbanBoardBlock` - Project management apps
7. `PlatformProductGridBlock` - E-commerce
8. `PlatformMapDataLayerBlock` - Location-based apps
9. `PlatformOnboardingTourBlock` - User experience
10. `PlatformMetricsDashboardBlock` - Analytics demand
11. `PlatformWorkflowBuilderBlock` - Automation

**Phase 3 (Next Month):**
12. All remaining data visualization blocks
13. Collaboration blocks (comments, presence)
14. Security & compliance blocks

**Phase 4 (Ongoing):**
15. Industry-specific vertical blocks (healthcare, finance, etc.)
16. Advanced AI blocks (RAG debugger, embedding explorer)

---

### Block Category Summary

| Category | Count | Priority | Use Case |
|----------|-------|----------|----------|
| Content & Media | 6 | P0 | Marketing, portfolios |
| E-commerce & Business | 4 | P1 | Online stores, bookings |
| Advanced Data | 5 | P1 | Project management, CRM |
| Utility | 4 | P2 | General functionality |
| **Advanced AI & Agent** | **8** | **P0** | **Competitive differentiation** |
| **Integration & Webhook** | **8** | **P0** | **Platform connectivity** |
| User Experience | 10 | P1 | Engagement, onboarding |
| Analytics & Monitoring | 9 | P1 | Insights, observability |
| Collaboration | 8 | P2 | Team features |
| **Workflow & Automation** | **10** | **P0** | **Productivity, no-code** |
| Security & Compliance | 9 | P1 | Enterprise requirements |
| Advanced Visualization | 13 | P2 | Rich data presentation |
| Industry Verticals | 14 | P3 | Specialized sectors |
| **TOTAL** | **108 blocks** | | |

---

## Part 2: Visual Editor - Complete Solution

### Current Problem Statement

**Pain Point:**
```
User wants to add a dataset-connected table:
→ Types in chat: "Add a table showing my customers"
→ AI generates code
→ User waits for build
→ User hopes it works
→ If wrong, repeat
```

**Time:** 5-10 minutes per component  
**Friction:** High - requires knowing what to ask  
**Error Rate:** 30% - AI misunderstanding

---

### Proposed Solution: Visual Canvas Editor

#### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    VISUAL EDITOR LAYOUT                      │
├────────────┬─────────────────────────────┬──────────────────┤
│            │                             │                  │
│  PALETTE   │        CANVAS               │  PROPERTIES    │
│  SIDEBAR   │      (React Flow)           │   PANEL        │
│            │                             │                  │
│  ┌─────┐   │   ┌─────────────────┐      │  ┌──────────┐   │
│  │🔶   │   │   │                 │      │  │ Block:   │   │
│  │Data │   │   │   [Hero Block]  │      │  │Dataset   │   │
│  │Table│   │   │        ↓        │      │  │Table     │   │
│  └─────┘   │   │   [Chart Block] │      │  ├──────────┤   │
│            │   │        ↓        │      │  │Collection│   │
│  ┌─────┐   │   │   [Form Block]  │      │  │[dropdown]│   │
│  │📊   │   │   │                 │      │  ├──────────┤   │
│  │Chart│   │   └─────────────────┘      │  │Columns   │   │
│  └─────┘   │                             │  │☑ Name    │   │
│            │                             │  │☑ Email   │   │
│  ┌─────┐   │   Canvas Controls:           │  │☐ Phone   │   │
│  │💬   │   │   [+] Zoom [−] [Fit] [Play]  │  └──────────┘   │
│  │Chat │   │                             │                  │
│  └─────┘   │                             │                  │
│            │                             │                  │
└────────────┴─────────────────────────────┴──────────────────┘
```

---

### Core Components

#### 1. Block Palette Sidebar

**Categories:**
```typescript
const PALETTE_CATEGORIES = [
  {
    id: 'platform-data',
    label: '🔶 Platform Data',
    icon: Database,
    blocks: [
      { id: 'PlatformDatasetTableBlock', icon: Table, label: 'Data Table' },
      { id: 'PlatformDatasetChartBlock', icon: BarChart3, label: 'Chart' },
      { id: 'PlatformFormBlock', icon: FormInput, label: 'Form' },
      { id: 'PlatformCalendarBlock', icon: Calendar, label: 'Calendar' },
      { id: 'PlatformKanbanBoardBlock', icon: LayoutGrid, label: 'Kanban' },
    ]
  },
  {
    id: 'platform-operations',
    label: '⚡ Platform Operations',
    icon: Zap,
    blocks: [
      { id: 'PlatformPipelineTriggerBlock', icon: Play, label: 'Pipeline Trigger' },
      { id: 'PlatformJobRunnerBlock', icon: Cpu, label: 'Job Runner' },
      { id: 'PlatformMissionsBlock', icon: Target, label: 'Mission Control' },
    ]
  },
  {
    id: 'platform-ai',
    label: '🤖 Platform AI',
    icon: Bot,
    blocks: [
      { id: 'PlatformAgentChatBlock', icon: MessageSquare, label: 'AI Chat' },
      { id: 'PlatformKnowledgeSearchBlock', icon: Search, label: 'Knowledge Search' },
      { id: 'MultiAgentDashboardBlock', icon: Users, label: 'Multi-Agent' },
    ]
  },
  {
    id: 'platform-governance',
    label: '🛡️ Platform Governance',
    icon: Shield,
    blocks: [
      { id: 'PlatformHILApprovalBlock', icon: CheckCircle, label: 'Approvals' },
      { id: 'PlatformDeadLetterQueueBlock', icon: AlertTriangle, label: 'Dead Letter' },
      { id: 'PlatformPipelineStatusBlock', icon: Activity, label: 'Pipeline Status' },
    ]
  },
  {
    id: 'content',
    label: '🎨 Content & Media',
    icon: Image,
    blocks: [
      { id: 'PlatformMediaGalleryBlock', icon: Images, label: 'Media Gallery' },
      { id: 'PlatformContentCarouselBlock', icon: CarouselIcon, label: 'Carousel' },
      { id: 'PlatformHeroSliderBlock', icon: Monitor, label: 'Hero Slider' },
    ]
  },
  {
    id: 'layout',
    label: '📐 Layout',
    icon: Layout,
    blocks: [
      { id: 'Card', icon: Square, label: 'Card' },
      { id: 'Tabs', icon: Tab, label: 'Tabs' },
      { id: 'Sidebar', icon: PanelLeft, label: 'Sidebar' },
    ]
  },
];
```

**Drag Behavior:**
- Drag from palette → drop on canvas
- Ghost preview follows cursor
- Drop zones highlight on hover

---

#### 2. Canvas (React Flow)

**Node Types:**
```typescript
// Visual representation of each block
interface CanvasNode {
  id: string;           // Unique node ID
  type: 'platformBlock'; // All blocks are this type
  position: { x: number; y: number };
  data: {
    blockId: string;           // PlatformDatasetTableBlock, etc.
    blockName: string;         // Human-readable name
    config: BlockConfig;       // Current configuration
    datasetBindings: {        // Connected datasets
      collection?: string;
      fields?: string[];
    };
    isConfigured: boolean;     // Has required config
    preview?: ReactNode;       // Live preview thumbnail
  };
}

// Connections show data flow
interface CanvasEdge {
  id: string;
  source: string;      // Source node ID
  target: string;      // Target node ID
  type: 'dataFlow';    // Visual connection type
  animated: boolean;   // Pulse if live data flowing
}
```

**Visual Node Design:**
```
┌─────────────────────────┐
│ 🔶 Dataset Table        │ ← Block icon + name
│    "Customers"          │ ← Dataset name (if bound)
├─────────────────────────┤
│ ┌─────┐ ┌─────┐ ┌────┐ │ ← Mini preview
│ │ Row │ │ Row │ │... │ │    (last 3 records)
│ └─────┘ └─────┘ └────┘ │
├─────────────────────────┤
│ ⚠️ Needs configuration  │ ← Status indicator
│    [Configure]          │ ← Quick action
└─────────────────────────┘
```

**Canvas Interactions:**
- **Click:** Select → show properties panel
- **Double-click:** Expand to full preview
- **Drag:** Move node on canvas
- **Drag handle:** Create connection to another node
- **Right-click:** Context menu (delete, duplicate, configure)
- **Scroll/Pinch:** Zoom canvas
- **Space+Drag:** Pan canvas

---

#### 3. Properties Panel

**Dynamic Form Based on Block Type:**

**Example: PlatformDatasetTableBlock**
```
┌──────────────────────────┐
│ Platform Dataset Table   │
├──────────────────────────┤
│                          │
│ Collection *             │
│ ┌──────────────────────┐ │
│ │ ▼ customers          │ │  ← Dropdown of user's datasets
│ └──────────────────────┘ │
│                          │
│ [Analyze Schema]         │  ← Button to auto-discover fields
│                          │
│ Columns                  │
│ ☑ id          (hidden)   │
│ ☑ name        Text       │
│ ☑ email       Text       │
│ ☑ status      Badge      │
│ ☐ phone       -          │
│ ☑ createdAt   Date       │
│                          │
│ Options                  │
│ ☑ Enable search          │
│ ☑ Enable pagination      │
│ ☑ Enable sorting         │
│ ☑ Allow create           │
│ ☑ Allow edit             │
│ ☑ Allow delete           │
│                          │
│ Page Size: [10 ▼]         │
│                          │
│ [Advanced]               │
│                          │
│ ┌──────────────────────┐ │
│ │ 💡 Auto-detect       │ │  ← Smart suggestions
│ │   relations to       │ │
│ │   "orders" dataset   │ │
│ │   [Link Tables]      │ │
│ └──────────────────────┘ │
│                          │
│ [🗑️ Delete] [💾 Save]   │
└──────────────────────────┘
```

**Smart Features:**
- **Auto-detect:** "This dataset has 5 fields suitable for display"
- **Relations:** "Link to 'orders' dataset via customer_id?"
- **Validation:** Red warning if selected collection doesn't exist
- **Preview:** Live data sample below form

---

#### 4. Resource Browser (Bottom Panel)

**Collapsible drawer showing platform resources:**

```
┌────────────────────────────────────────────────────────────┐
│ Platform Resources                    [▲] [Connect]        │
├────────────────────────────────────────────────────────────┤
│ 📊 Datasets        🤖 Agents         ⚡ Pipelines           │
│ ┌─────────────┐   ┌─────────────┐   ┌─────────────┐       │
│ │ customers   │   │ Sales Bot   │   │ Invoice Gen │       │
│ │ 1,234 rows  │   │ Status: ON  │   │ Last: 2h ago│       │
│ │ [Preview]   │   │ [Connect]   │   │ [Trigger]   │       │
│ ├─────────────┤   ├─────────────┤   ├─────────────┤       │
│ │ orders      │   │ Support Bot │   │ Data Sync   │       │
│ │ 5,678 rows  │   │ Status: OFF │   │ Last: 1d ago│       │
│ │ [Preview]   │   │ [Connect]   │   │ [Trigger]   │       │
│ └─────────────┘   └─────────────┘   └─────────────┘       │
│                                                            │
│ 🎯 Missions              📚 Knowledge Topics               │
│ ┌─────────────┐          ┌─────────────┐                  │
│ │ Migration   │          │ Products    │                  │
│ │ Status: ▶️  │          │ 234 docs    │                  │
│ │ [Logs]      │          │ [Browse]    │                  │
│ └─────────────┘          └─────────────┘                  │
└────────────────────────────────────────────────────────────┘
```

**Drag-and-Drop Integration:**
- Drag dataset → drop on canvas = Create PlatformDatasetTableBlock
- Drag agent → drop on canvas = Create PlatformAgentChatBlock
- Drag pipeline → drop on canvas = Create PlatformPipelineTriggerBlock

---

### User Scenarios

#### Scenario 1: Marketing Manager Builds Landing Page

**Goal:** Create product showcase page with testimonials carousel

**Traditional (Current) Flow:**
```
1. Chat: "Create a landing page"
2. AI generates generic page
3. Chat: "Add a carousel with testimonials"
4. AI generates, but uses fake data
5. Chat: "Connect to my testimonials dataset"
6. AI may or may not understand
7. Build fails 30% of time
8. Repeat...
Total time: 45 minutes
```

**Visual Editor Flow:**
```
1. Drag "Hero Slider" to canvas top
2. Properties panel: Select "hero_slides" dataset
3. Drag "Media Gallery" below hero
4. Properties: Select "product_images" dataset
5. Drag "Content Carousel" below gallery
6. Properties: Select "testimonials" dataset
7. Configure: cardTemplate = quote + author + company
8. Click "Preview" → See live app immediately
9. Click "Deploy" → Live in production
Total time: 8 minutes
Success rate: 95%
```

**Key Advantage:** User sees structure visually, dataset binding is point-and-click, no AI interpretation errors.

---

#### Scenario 2: Operations Manager Builds Mission Control Dashboard

**Goal:** Real-time dashboard showing active missions, logs, and pipeline triggers

**Traditional Flow:**
```
User: "Create mission control dashboard"
AI: Generates static mock UI
User: "Make it show real missions"
AI: Tries to add API calls, often breaks
User: "Add live logs"
AI: Misses the log connection
... 10+ iterations
```

**Visual Editor Flow:**
```
1. New template: "Mission Control Center" (pre-built)
2. Canvas shows:
   ┌─────────────────────────────┐
   │ [PlatformMissionsBlock]     │ ← Already configured
   │ Active: 5 | Pending: 2      │
   └─────────────────────────────┘
   ┌─────────────────────────────┐
   │ [PlatformMissionLogBlock]   │ ← Auto-wired to above
   │ [Live log stream...]        │
   └─────────────────────────────┘
   ┌─────────────────────────────┐
   │ [PlatformPipelineTrigger]   │ ← Drop new pipeline
   │ ┌───────────────────────┐   │
   │ │ ▼ Invoice Processing  │   │ ← Select from dropdown
   │ │ [Trigger] [Schedule]  │   │
   │ └───────────────────────┘   │
   └─────────────────────────────┘

3. Drag additional pipeline from resource browser
4. Drop on PlatformPipelineTriggerBlock
5. Auto-populates dropdown
6. Click "Deploy"
Done: 5 minutes
```

**Key Advantage:** Template provides structure, blocks self-wire, resource browser eliminates typing names.

---

#### Scenario 3: Developer Builds Custom CRM

**Goal:** Full CRM with customers, deals, calendar, and AI assistant

**Visual Editor Flow:**
```
1. Start with "CRUD App" template
2. Canvas shows:
   ┌───────────────────────────────────┐
   │ Sidebar: Customers | Deals | Cal │
   ├───────────────────────────────────┤
   │ [PlatformDatasetTableBlock]       │
   │ Collection: customers             │
   └───────────────────────────────────┘

3. Click "Deals" tab in sidebar preview
4. Properties panel: Add PlatformKanbanBoardBlock
5. Configure:
   - Collection: deals
   - Status field: status
   - Columns: prospecting → qualified → proposal → closed

6. Click "Calendar" tab
7. Add PlatformCalendarBlock
8. Configure:
   - Collection: meetings
   - Date field: meeting_date
   - Title field: customer_name

9. Add PlatformAgentChatBlock to sidebar
10. Configure:
    - Agent: "Sales Assistant"
    - Context: "You help with CRM questions"

11. Add PlatformDatasetChartBlock to dashboard
12. Configure:
    - Collection: deals
    - Chart type: Funnel
    - Group by: status

13. Preview → All blocks live-connected to datasets
14. Deploy
Total: 15 minutes for full CRM
```

**Key Advantage:** Visual layout matches final app structure, tab-based editing, complex relationships visible.

---

#### Scenario 4: Data Analyst Builds Analytics Dashboard

**Goal:** Multi-chart dashboard with filters and drill-down

**Visual Editor Flow:**
```
1. Template: "Analytics Dashboard"
2. Canvas shows 4 placeholder chart blocks
3. Click first chart:
   Properties:
   - Collection: sales_data
   - Chart type: Line
   - X-axis: date
   - Y-axis: revenue
   - Filter: last_30_days

4. Click second chart:
   - Collection: sales_data
   - Chart type: Bar
   - X-axis: product_category
   - Y-axis: units_sold

5. Drag "PlatformDatasetTableBlock" below charts
6. Configure:
   - Collection: sales_data
   - Enable: search, sort, pagination
   - Columns: date, product, revenue, region

7. Add date range picker (input component)
8. Connect to all charts via visual line:
   [DatePicker] ──→ [Chart1]
            ├──→ [Chart2]
            └──→ [Table]

9. Preview: Changing date range updates all visualizations
10. Deploy
```

**Key Advantage:** Visual connections show data flow, filter propagation clear, dashboard layout matches WYSIWYG.

---

### Technical Implementation

#### Tech Stack

```typescript
// Core libraries
- @xyflow/react (React Flow) - Canvas engine
- zustand - State management for canvas
- @dnd-kit/core - Drag and drop
- react-resizable-panels - Collapsible panels

// New components to build
- VisualCanvas.tsx - Main canvas component
- BlockPalette.tsx - Sidebar block catalog
- PropertiesPanel.tsx - Dynamic config forms
- ResourceBrowser.tsx - Platform resources drawer
- CanvasNode.tsx - Visual block representation
- CanvasEdge.tsx - Data flow connections
- PreviewModal.tsx - Live preview overlay
```

#### Data Flow Architecture

```
┌─────────────────────────────────────────────────────┐
│                  USER ACTIONS                        │
│  (Drag, Drop, Configure, Connect)                  │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│              CANVAS STATE (Zustand)                 │
│  {                                                  │
│    nodes: CanvasNode[],                             │
│    edges: CanvasEdge[],                            │
│    selectedNode: string | null,                     │
│    viewport: { x, y, zoom }                         │
│  }                                                  │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│              CODE GENERATOR                         │
│  - Traverses nodes → edges                          │
│  - Generates JSX imports                          │
│  - Creates page layout                            │
│  - Binds datasets via props                       │
│  - Outputs: pages/index.tsx, etc.                 │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│              EXISTING FORGE PIPELINE                │
│  - Code validated                                  │
│  - Container built                                 │
│  - App deployed                                    │
└─────────────────────────────────────────────────────┘
```

#### Code Generation Logic

```typescript
// Pseudo-code for code generation from canvas
function generateAppFromCanvas(nodes: CanvasNode[], edges: CanvasEdge[]): GeneratedCode {
  const imports = new Set<string>();
  const componentCode: string[] = [];
  
  // Sort nodes by vertical position (top to bottom)
  const sortedNodes = nodes.sort((a, b) => a.position.y - b.position.y);
  
  for (const node of sortedNodes) {
    const block = getBlockDefinition(node.data.blockId);
    imports.add(block.importPath);
    
    // Generate JSX for this block
    const props = generateProps(node.data.config);
    componentCode.push(`
      <${block.componentName}
        ${Object.entries(props).map(([k, v]) => `${k}={${JSON.stringify(v)}}`).join('\n        ')}
      />
    `);
  }
  
  return {
    'pages/index.tsx': `
      ${Array.from(imports).map(i => `import { ${i} } from '${i}';`).join('\n')}
      
      export default function App() {
        return (
          <div className="space-y-8">
            ${componentCode.join('\n')}
          </div>
        );
      }
    `,
  };
}
```

---

### Implementation Phases

#### Phase 1: MVP (2 Weeks)

**Goal:** Basic visual canvas with 5 platform blocks

**Deliverables:**
1. Integrate React Flow into AppInteractiveBuilderTab
2. Build BlockPalette sidebar with categories
3. Create CanvasNode component (visual block representation)
4. Implement drag-and-drop from palette to canvas
5. Build PropertiesPanel for PlatformDatasetTableBlock
6. Support 5 blocks: Table, Chart, Form, AgentChat, PipelineTrigger
7. Code generation: Export to pages/index.tsx
8. Deploy button triggers existing forge pipeline

**User Value:** Can visually build simple data apps

---

#### Phase 2: Smart Features (2 Weeks)

**Goal:** Auto-wiring and resource integration

**Deliverables:**
1. ResourceBrowser panel with user's datasets/agents/pipelines
2. Drag dataset → auto-create PlatformDatasetTableBlock
3. Schema introspection: "This dataset has 8 fields, suggesting 5 for display"
4. Auto-detect relations between datasets
5. Visual connections between blocks (data flow lines)
6. Template gallery (5 pre-built layouts)
7. Undo/redo history
8. Canvas save/load (JSON serialization)

**User Value:** 5-minute app creation from existing data

---

#### Phase 3: Advanced (2 Weeks)

**Goal:** Complex layouts and all platform blocks

**Deliverables:**
1. All 23+ platform blocks supported
2. Layout blocks (Tabs, Sidebar, Cards with nesting)
3. Responsive breakpoint editor (mobile/tablet/desktop)
4. Theme/styling panel (colors, fonts, spacing)
5. Component marketplace (save/share custom blocks)
6. Real-time collaboration (multiplayer cursors)
7. Version history (save points)

**User Value:** Professional-grade app builder

---

### Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Visual Editor Adoption** | 70% of new apps | % created via canvas vs chat |
| **Time to First Preview** | < 5 minutes | From start to working preview |
| **Dataset Binding Success** | 95% | % of blocks successfully connected |
| **Block Reuse** | 5 blocks/app | Average blocks per app |
| **Template Usage** | 60% | % apps started from template |
| **User Satisfaction** | 4.5/5 | Post-creation survey |

---

### Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Users prefer chat | Keep both modes, A/B test |
| Complex layouts hard | Provide templates, smart defaults |
| Performance with many blocks | Virtualization, lazy loading |
| Mobile canvas unusable | Fallback to simplified mobile builder |
| Code generation errors | Validation, fallback to AI fix |

---

## Conclusion

**The Visual Editor transforms Oddjob from:**
> "AI app generator that sometimes works"

**To:**
> "Visual full-stack platform where apps are born connected to your infrastructure"

**Immediate Next Steps:**
1. Add `PlatformMediaGalleryBlock`, `PlatformContentCarouselBlock`, `PlatformCalendarBlock`
2. Integrate React Flow into AppInteractiveBuilderTab
3. Build BlockPalette with platform block categories
4. Implement drag-and-drop canvas

**Competitive Moat:** Once users experience instant visual wiring to their datasets, agents, and pipelines, switching to competitors requires rebuilding those connections manually.

---

*Analysis based on block-registry.json, ui-registry.service.ts, AppInteractiveBuilderTab.tsx, and packaged block implementations.*
