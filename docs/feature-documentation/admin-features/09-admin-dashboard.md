# Admin Dashboard Documentation

## **Feature Overview**

### **Purpose & Business Value**
The Admin Dashboard provides comprehensive system administration capabilities for Oddjob, including user management, system monitoring, configuration management, and security controls. It serves as the central hub for system administrators to maintain platform health, manage organizational settings, and oversee all platform operations.

### **User Personas & Use Cases**
- **System Administrators**: Complete system management and configuration
- **Organization Administrators**: User management within their organization
- **Security Officers**: Monitor system security and audit compliance
- **DevOps Engineers**: System monitoring, performance optimization, backup management
- **Compliance Officers**: Review audit logs and ensure regulatory compliance
- **Support Teams**: Diagnose issues, manage system maintenance

### **Key Requirements & Constraints**
- **Multi-level Access Control**: Different admin levels (super admin, org admin, regular admin)
- **Real-time Monitoring**: Live system metrics and health indicators
- **Configuration Management**: Centralized system settings and preferences
- **Audit Trail**: Complete logging of all administrative actions
- **Maintenance Mode**: Ability to put system in maintenance mode
- **Backup Management**: Automated and manual backup capabilities
- **Security Controls**: Comprehensive security settings and monitoring
- **Performance Analytics**: System performance metrics and optimization recommendations

### **Success Metrics**
- System uptime > 99.9%
- Admin action completion rate > 98%
- Security incident detection time < 5 minutes
- System configuration consistency 100%
- Audit log completeness > 99.5%

---

## **User Interface Documentation**

### **Screens & Navigation**

#### **Main Admin Dashboard (`/admin` or `/settings`)**
- **Purpose**: Central overview of system status and quick actions
- **Key Features**:
  - System health indicators (CPU, memory, storage)
  - Active user sessions and recent activity
  - Job execution statistics and trends
  - Security alerts and notifications
  - Quick access to common admin tasks
  - System maintenance status
  - Performance metrics dashboard

#### **User Management (`/users`)**
- **Purpose**: Comprehensive user account management
- **Key Features**:
  - User listing with search and filtering
  - User creation and editing forms
  - Role assignment and permission management
  - Bulk user operations (import, export, deactivate)
  - User activity monitoring and audit logs
  - Password management and reset capabilities
  - Multi-organization user management

#### **System Settings (`/admin/settings`)**
- **Purpose**: System-wide configuration management (912 lines)
- **Key Features**:
  - AI provider configuration and defaults
  - Email service settings (SMTP, Gmail integration)
  - System timezone and localization settings
  - Security policies and password requirements
  - Session management and timeout settings
  - Backup and retention policies
  - Integration service configurations
  - Performance and resource limits

#### **Credentials Management (`/credentials`)**
- **Purpose**: External service credentials and API keys management
- **Key Features**:
  - Credential listing by type and service
  - Secure credential creation and editing: the secret is entered once, stored encrypted for the organization, and never shown again; replace it from the credential's page
  - Credential testing and validation
  - Access control and usage monitoring
  - Credential rotation and expiration management
  - Audit logging of credential access

#### **System Monitoring (`/monitoring`, `/observability`)**
- **Purpose**: Real-time system performance and health monitoring
- **Key Features**:
  - Live performance metrics (CPU, memory, disk, network)
  - Application performance indicators
  - Database performance and query analysis
  - External service integration status
  - Alert management and notification settings
  - Historical performance data and trends
  - Performance optimization recommendations

#### **Audit Logs (`/admin/audit`)**
- **Purpose**: Comprehensive audit trail and compliance reporting
- **Key Features**: Searchable audit log, filtering by user/action/date, compliance export

#### **Tool Registry (`/admin/tools`), MCP Tokens (`/admin/mcp-tokens`), Event Log (`/admin/events`)**
- **Purpose**: OpenAPI tool specs, MCP token management, system event stream
- **Spec**: MCP_SPEC

### **Component Hierarchy**

```
AdminDashboard/
├── Settings/
│   ├── index.tsx - Main settings page (912 lines)
│   ├── SystemInfoCard.tsx - System status display
│   ├── LocalAiSettings.tsx - AI provider configuration
│   ├── GmailSettings.tsx - Gmail integration settings
│   ├── SystemAiDefaultsCard.tsx - Default AI settings
│   ├── NotificationSettings.tsx - Email and alert configuration
│   ├── SecuritySettings.tsx - Security policies configuration
│   └── BackupSettings.tsx - Backup and retention settings
├── UserManagement/
│   ├── Users.tsx - Main user management interface
│   ├── UserDetail.tsx - Individual user configuration (984 lines)
│   ├── UserCreation.tsx - New user creation wizard
│   ├── RoleManagement.tsx - Role and permission configuration
│   ├── BulkOperations.tsx - Bulk user operations
│   └── ActivityMonitor.tsx - User activity tracking
├── CredentialManagement/
│   ├── Credentials.tsx - Credential listing and management
│   ├── CredentialDetail.tsx - Individual credential details (1,297 lines)
│   ├── CredentialForms/ - Type-specific credential forms
│   ├── CredentialTestPanel.tsx - Credential testing interface
│   └── AccessControl.tsx - Credential access management
├── Monitoring/
│   ├── SystemMetrics.tsx - Performance metrics dashboard
│   ├── HealthIndicators.tsx - System health status
│   ├── AlertManagement.tsx - Alert configuration and history
│   └── PerformanceAnalytics.tsx - Performance analysis tools
├── Audit/
│   ├── AuditLog.tsx - Audit log viewing and searching
│   ├── ComplianceReports.tsx - Compliance report generation
│   └── SecurityEvents.tsx - Security event monitoring
└── Shared/
    ├── AdminLayout.tsx - Admin interface layout
    ├── PermissionCheck.tsx - Permission-based component rendering
    └── AuditWrapper.tsx - Audit logging wrapper for actions
```

### **User Interactions**

#### **User Management Flow**
1. Navigate to `/admin/users` → View user list
2. Search/filter users → Find specific users
3. Click "Create User" → Fill user creation form
4. Assign roles and permissions → Configure access levels
5. Send invitation or create password → User account creation
6. Edit existing user → Modify user details or permissions
7. Bulk operations → Select multiple users for batch actions
8. View user activity → Monitor user actions and login history

#### **System Configuration Flow**
1. Navigate to `/admin/settings` → View configuration tabs
2. Select configuration area → Access specific settings
3. Modify settings → Update system configuration
4. Test changes → Validate new configuration
5. Save changes → Apply configuration to system
6. Review system impact → Monitor effects of changes

#### **Credential Management Flow**
1. Navigate to `/admin/credentials` → View credential list
2. Click "Add Credential" → Choose credential type
3. Fill credential form → Enter service-specific details
4. Test credential → Validate connection and access
5. Set access controls → Configure who can use credential
6. Save and activate → Make credential available for use

---

## **API Documentation**

### **User Management Endpoints**

#### **GET /api/admin/users**
- **Purpose**: List users with filtering and pagination
- **Query Parameters**:
  - `search`: Search term for name, email, username
  - `role`: Filter by user role
  - `organizationId`: Filter by organization
  - `isActive`: Filter by account status
  - `limit`: Pagination limit
  - `offset`: Pagination offset
- **Response**: `{ users: User[], total: number }`
- **Authentication**: Admin permission required

#### **POST /api/admin/users**
- **Purpose**: Create new user account
- **Request Body**: `CreateUserInput` with role assignments
- **Response**: Created `User`
- **Validation**: Username uniqueness, email validation, password strength

#### **PUT /api/admin/users/:id**
- **Purpose**: Update user account
- **Request Body**: Partial user updates
- **Response**: Updated `User`
- **Authentication**: Admin or self-update permission required

#### **DELETE /api/admin/users/:id**
- **Purpose**: Deactivate or delete user
- **Response**: Success message
- **Authentication**: Admin permission required
- **Audit**: Logs deletion action with reason

#### **POST /api/admin/users/:id/reset-password**
- **Purpose**: Reset user password
- **Request Body**: `{ newPassword: string, notifyUser: boolean }`
- **Response**: Success message
- **Security**: Force password change on next login

### **System Settings Endpoints**

#### **GET /api/admin/settings**
- **Purpose**: Get current system settings
- **Response**: System settings object with all configurations
- **Authentication**: Admin permission required
- **Caching**: Cached for performance

#### **PUT /api/admin/settings**
- **Purpose**: Update system settings
- **Request Body**: Partial system settings updates
- **Response**: Updated settings object
- **Validation**: Setting validation and security checks
- **Side Effects**: May require service restarts

#### **POST /api/admin/settings/test-email**
- **Purpose**: Test email configuration
- **Request Body**: `{ testEmail: string }`
- **Response`: Email delivery status and details
- **Authentication**: Admin permission required

#### **POST /api/admin/settings/test-ai-provider**
- **Purpose**: Test AI provider configuration
- **Request Body**: `{ provider: string, testQuery: string }`
- **Response**: Test results and API response
- **Authentication**: Admin permission required

### **Credential Management Endpoints**

#### **GET /api/admin/credentials**
- **Purpose**: List system credentials
- **Query Parameters**:
  - `type`: Filter by credential type
  - `organizationId`: Filter by organization
  - `isExpired`: Filter by expiration status
- **Response**: `{ credentials: Credential[] }`
- **Authentication**: Admin permission required

#### **POST /api/admin/credentials**
- **Purpose**: Create new credential
- **Request Body**: `CreateCredentialInput` with encrypted data
- **Response**: Created `Credential`
- **Security**: Credentials stored with encryption at rest

#### **POST /api/admin/credentials/:id/test**
- **Purpose**: Test credential validity
- **Request Body**: `{ testEndpoint?: string }`
- **Response`: Test results and connection status
- **Authentication**: Admin permission required

#### **PUT /api/admin/credentials/:id/rotate**
- **Purpose**: Rotate credential keys/secrets
- **Response**: New credential with updated keys
- **Security**: Automatic invalidation of old credentials

### **System Monitoring Endpoints**

#### **GET /api/admin/metrics**
- **Purpose**: Get current system metrics
- **Query Parameters**:
  - `timeRange`: Time range for metrics (1h, 24h, 7d, 30d)
  - `type`: Specific metric types (cpu, memory, disk, network)
- **Response**: `{ metrics: SystemMetrics[], timestamp: Date }`
- **Authentication**: Admin permission required
- **Real-time**: WebSocket updates available

#### **GET /api/admin/health**
- **Purpose**: Get system health status
- **Response**: `{ status: 'healthy' | 'warning' | 'critical', services: ServiceHealth[] }`
- **Authentication**: Admin permission required

#### **GET /api/admin/alerts**
- **Purpose**: Get system alerts and notifications
- **Query Parameters**: Pagination, severity filters, date ranges
- **Response**: `{ alerts: Alert[], total: number }`
- **Authentication**: Admin permission required

### **Audit and Compliance Endpoints**

#### **GET /api/admin/audit**
- **Purpose**: Get audit log entries
- **Query Parameters**:
  - `userId`: Filter by specific user
  - `action`: Filter by action type
  - `resourceType`: Filter by resource type
  - `dateFrom`: Start date filter
  - `dateTo`: End date filter
- **Response**: `{ entries: AuditEntry[], total: number }`
- **Authentication**: Admin permission required

#### **POST /api/admin/audit/export**
- **Purpose**: Export audit data for compliance
- **Request Body**: Export filters and format preferences
- **Response**: Download URL or file data
- **Authentication**: Admin permission required
- **Compliance**: Includes necessary compliance metadata

### **Request/Response Schemas**

#### **System Settings Schema**
```typescript
interface SystemSettings {
  // AI Settings
  aiProviders: {
    openai?: { apiKey: string, defaultModel: string };
    anthropic?: { apiKey: string, defaultModel: string };
    google?: { apiKey: string, defaultModel: string };
  };
  defaultAiSettings: {
    temperature: number;
    maxTokens: number;
    timeout: number;
  };
  
  // Email Settings
  email: {
    smtp?: {
      host: string;
      port: number;
      secure: boolean;
      username: string;
      password: string;
    };
    gmail?: {
      clientId: string;
      clientSecret: string;
      refreshToken: string;
    };
  };
  
  // System Settings
  system: {
    timezone: string;
    sessionTimeout: number; // minutes
    logRetentionDays: number;
    maintenanceMode: boolean;
    maxFileSize: number; // bytes
  };
  
  // Security Settings
  security: {
    requireMFA: boolean;
    passwordMinLength: number;
    passwordRequireSpecialChars: boolean;
    maxLoginAttempts: number;
    lockoutDuration: number; // minutes
  };
  
  // Backup Settings
  backup: {
    enabled: boolean;
    schedule: string; // cron expression
    retentionDays: number;
    destination: string; // S3, Google Drive, etc.
  };
}
```

#### **System Metrics Schema**
```typescript
interface SystemMetrics {
  timestamp: Date;
  cpu: {
    usage: number; // percentage
    cores: number;
    loadAverage: number[];
  };
  memory: {
    total: number; // bytes
    used: number; // bytes
    free: number; // bytes
    usagePercentage: number;
  };
  disk: {
    total: number; // bytes
    used: number; // bytes
    free: number; // bytes
    usagePercentage: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
    connections: number;
  };
  application: {
    activeUsers: number;
    activeJobs: number;
    queuedJobs: number;
    errorRate: number;
    avgResponseTime: number; // milliseconds
  };
}
```

#### **Audit Entry Schema**
```typescript
interface AuditEntry {
  id: number;
  userId: number;
  username: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  details: Record<string, any>;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
  organizationId?: number;
  result: 'success' | 'failure' | 'partial';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}
```

### **Error Handling & Status Codes**

#### **Admin Action Errors**
- `INSUFFICIENT_PERMISSIONS`: User lacks required admin permissions
- `SETTINGS_VALIDATION_FAILED`: System settings validation failed
- `CREDENTIAL_TEST_FAILED`: Credential validation failed
- `USER_CREATION_FAILED`: User account creation failed
- `SYSTEM_OPERATION_FAILED`: System-level operation failed

#### **Configuration Errors**
- `INVALID_AI_PROVIDER`: AI provider configuration invalid
- `EMAIL_CONFIG_FAILED`: Email configuration test failed
- `BACKUP_CONFIG_INVALID`: Backup configuration invalid
- `SECURITY_POLICY_VIOLATION`: Settings violate security policies

---

## **Component Architecture**

### **Settings Component State**
```typescript
const Settings = () => {
  // System configuration state
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // Individual setting sections
  const [aiSettings, setAiSettings] = useState<AISettings>({});
  const [emailSettings, setEmailSettings] = useState<EmailSettings>({});
  const [securitySettings, setSecuritySettings] = useState<SecuritySettings>({});
  
  // UI state
  const [activeTab, setActiveTab] = useState('general');
  const [hasChanges, setHasChanges] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  
  // System info
  const { data: systemInfo } = useQuery({
    queryKey: ['/api/system/info'],
    refetchInterval: 60000 // Update every minute
  });
};
```

### **React Query Integration**
```typescript
// Settings data
const { data: settings, isLoading, error } = useQuery({
  queryKey: ['/api/admin/settings'],
  queryFn: fetchSystemSettings,
  staleTime: 5 * 60 * 1000 // 5 minutes
});

// Settings mutation
const updateSettingsMutation = useMutation({
  mutationFn: updateSystemSettings,
  onMutate: (newSettings) => {
    // Optimistic update
    queryClient.setQueryData(['/api/admin/settings'], newSettings);
    setHasChanges(false);
  },
  onSuccess: (updatedSettings) => {
    toast({
      title: "Settings updated",
      description: "System settings have been successfully updated.",
    });
  },
  onError: (error) => {
    toast({
      title: "Update failed",
      description: error.message,
      variant: "destructive",
    });
    // Refetch to restore correct state
    queryClient.invalidateQueries(['/api/admin/settings']);
  },
});
```

### **Key Component Interfaces**

#### **Settings Component Interface**
```typescript
interface SettingsProps {
  // No direct props - gets data from context and API
}

// Internal sections
interface SettingsSection {
  title: string;
  icon: React.ComponentType;
  component: React.ComponentType;
  permission?: Permission;
}
```

#### **UserDetail Component Interface**
```typescript
interface UserDetailProps {
  userId: number;
  mode: 'view' | 'edit' | 'create';
  onSave?: (user: User) => void;
  onCancel?: () => void;
}
```

### **Custom Hooks**

#### **useSystemSettings**
```typescript
const useSystemSettings = () => {
  const { data: settings, isLoading, error } = useQuery({
    queryKey: ['/api/admin/settings'],
    queryFn: fetchSystemSettings
  });
  
  const updateSettings = useMutation({
    mutationFn: updateSystemSettings,
    onSuccess: () => {
      queryClient.invalidateQueries(['/api/admin/settings']);
    }
  });
  
  return {
    settings,
    isLoading,
    error,
    updateSettings: updateSettings.mutate,
    isUpdating: updateSettings.isPending
  };
};
```

#### **useAdminPermissions**
```typescript
const useAdminPermissions = () => {
  const { user, adminRole } = useAuth();
  
  const canManageUsers = useMemo(() => {
    return adminRole?.isSuperAdmin || adminRole?.role === 'org_admin';
  }, [adminRole]);
  
  const canViewSystemMetrics = useMemo(() => {
    return adminRole?.permissions?.includes(Permission.SYSTEM_ADMIN);
  }, [adminRole]);
  
  const canManageCredentials = useMemo(() => {
    return adminRole?.permissions?.includes(Permission.MANAGE_CREDENTIALS);
  }, [adminRole]);
  
  return {
    canManageUsers,
    canViewSystemMetrics,
    canManageCredentials,
    // ... other permission checks
  };
};
```

---

## **Integration Points**

### **External Services**
- **AI Providers**: OpenAI, Anthropic, Google for AI settings testing
- **Email Services**: SMTP servers, Gmail API for notification testing
- **Monitoring Services**: External monitoring integrations
- **Backup Services**: AWS S3, Google Cloud Storage for backups
- **Security Services**: External security scanning and monitoring
- **Compliance Services**: External audit and compliance reporting

### **Database Dependencies**
- **users table**: User account management
- **admin_roles table**: Role and permission assignments
- **system_settings table**: System configuration storage
- **credentials table**: Encrypted credential storage
- **audit_logs table**: Administrative action logging
- **organizations table**: Organization-level settings

### **System Monitoring Integration**
- **Application Metrics**: Custom application performance tracking
- **Infrastructure Monitoring**: System resource monitoring
- **Database Monitoring**: Query performance and connection monitoring
- **Network Monitoring**: External service connectivity monitoring
- **Security Monitoring**: Authentication and authorization monitoring

### **Internal Service Dependencies**
- **Auth Service**: User authentication and session management
- **Jobs Service**: Job execution monitoring and control
- **Pipeline Service**: Pipeline execution monitoring
- **Knowledge Service**: Knowledge system monitoring
- **Notification Service**: Alert and notification delivery
- **File Storage Service**: Credential backup and file management

---

## **Error Handling & Edge Cases**

### **Settings Validation**
- **AI Provider Validation**: API key validation, quota checking
- **Email Configuration Validation**: SMTP connection testing, delivery verification
- **Security Policy Validation**: Password policy validation, MFA requirements
- **Backup Configuration Validation**: Storage access testing, permissions checking

### **User Management Validation**
- **User Creation Validation**: Username uniqueness, email validation, password strength
- **Permission Assignment Validation**: Role hierarchy validation, permission conflict checking
- **Bulk Operation Validation**: Data consistency, transaction integrity
- **User Deletion Validation**: Data cleanup, job reassignment

### **System Maintenance Scenarios**
- **Configuration Rollback**: Revert failed configuration changes
- **Service Restart Coordination**: Coordinated service restarts for settings
- **Backup Restoration**: System state restoration from backups
- **Emergency Access**: Override mechanisms for critical system access

---

## **Performance Considerations**

### **Critical Paths**
- **Settings Loading**: Load system settings < 2 seconds
- **Settings Updates**: Apply setting changes < 5 seconds
- **User Management**: User operations < 3 seconds
- **Metrics Dashboard**: Load metrics data < 1 second
- **Audit Log Search**: Search audit logs < 2 seconds

### **Bottlenecks & Optimizations**
- **Large Settings Objects**: Complex settings with nested structures
- **User List Performance**: Loading thousands of users
- **Real-time Metrics**: High-frequency metric updates
- **Audit Log Growth**: Large audit tables affecting search performance
- **Credential Testing**: Slow external service validation

### **Memory & CPU Usage**
- **Settings Caching**: Cache frequently accessed settings
- **Metrics Streaming**: Efficient real-time data updates
- **Large User Lists**: Virtual scrolling for user management
- **Background Updates**: Non-blocking configuration updates
- **Component Optimization**: Minimize re-renders in admin interfaces

---

## **Security & Permissions**

### **Access Control Implementation**
```typescript
// Admin permission checking
export function canPerformAdminAction(
  user: User,
  adminRole: AdminRoleInfo,
  action: AdminAction,
  resource?: string
): boolean {
  // Super admins have all permissions
  if (adminRole?.isSuperAdmin) {
    return true;
  }
  
  // Check role-specific permissions
  switch (action) {
    case 'MANAGE_USERS':
      return adminRole?.role === 'org_admin' || 
             adminRole?.permissions?.includes(Permission.MANAGE_USERS);
    
    case 'VIEW_SYSTEM_METRICS':
      return adminRole?.permissions?.includes(Permission.SYSTEM_ADMIN);
    
    case 'MANAGE_CREDENTIALS':
      return adminRole?.permissions?.includes(Permission.MANAGE_CREDENTIALS);
    
    // ... other admin actions
  }
  
  return false;
}
```

### **Security Measures**
- **Action Auditing**: Log all administrative actions
- **Permission Validation**: Strict permission checking for all admin operations
- **Secure Settings Storage**: Encrypt sensitive system settings
- **Configuration Validation**: Validate all setting changes for security compliance
- **Session Security**: Admin sessions with enhanced security requirements
- **Network Security**: Admin-only network restrictions when possible

### **Compliance Requirements**
- **Complete Audit Trail**: Log all admin actions with full context
- **Data Retention**: Configurable retention policies for audit data
- **Access Reviewing**: Regular access review workflows
- **Change Approval**: Optional approval workflow for critical changes
- **Export Controls**: Secure export of sensitive system data

---

## **Testing Requirements**

### **Unit Tests**
- **Settings Validation**: Test all setting validation logic
- **Permission Checking**: Test admin permission logic
- **User Management**: Test user creation, update, deletion
- **Credential Management**: Test credential creation and validation
- **Audit Logging**: Test audit trail functionality

### **Integration Tests**
- **Settings API**: Test all settings endpoints
- **User Management API**: Test user management operations
- **Permission Integration**: Test permission checking across services
- **External Service Integration**: Test AI provider and email service connections
- **Database Transactions**: Test data consistency in admin operations

### **E2E Tests**
- **Admin Workflows**: Complete administrative workflows
- **Settings Changes**: End-to-end setting update processes
- **User Lifecycle**: Complete user management workflows
- **System Monitoring**: Admin dashboard monitoring workflows
- **Emergency Procedures**: System recovery and maintenance procedures

---

## **Current Issues & Technical Debt**

### **Known Bugs**
- **Settings.tsx**: 912 lines with multiple responsibilities mixed
- **Real-time Updates**: Metrics dashboard connection issues
- **Permission Caching**: Stale permission cache after role changes
- **Bulk Operations**: Data consistency issues in bulk user operations
- **Configuration Conflicts**: Settings validation not catching all conflicts

### **Performance Issues**
- **User List Loading**: Slow loading with 1000+ users
- **Settings Updates**: Some setting changes require full page reload
- **Metrics Dashboard**: High memory usage with real-time updates
- **Audit Log Search**: Slow search performance with large datasets

### **Code Quality Issues**
- **Monolithic Components**: Large components with mixed concerns
- **State Management**: Inconsistent state patterns across admin components
- **Error Handling**: Different error handling approaches in admin features
- **Testing Coverage**: Low test coverage for admin functions
- **Documentation**: Inconsistent documentation patterns

---

## **Documentation References**

### **Related Documents**
- 05-auth-system.md - User authentication and permissions
- [01-jobs-system.md](../core-features/01-jobs-system.md) - Job administration and monitoring
- [03-knowledge-system.md](../core-features/03-knowledge-system.md) - Knowledge system administration
- 10-system-monitoring.md - Detailed monitoring documentation
- 11-audit-logging.md - Audit and compliance documentation

### **External Documentation**
- [React Admin Templates](https://marmelab.com/react-admin/) - Admin interface patterns
- [System Monitoring Best Practices](https://www.monitoring-explained.com/) - Monitoring guidelines
- [OWASP Admin Security](https://owasp.org/www-project-admin-security-guide/) - Admin security best practices

### **Important Code Locations**
- Admin components in client/src/components/admin/
- Admin routes in server/routes/admin.ts
- Settings management in server/services/admin-service.ts
- Permission logic in client/src/lib/permissions.ts
- Audit logging in server/services/audit-service.ts