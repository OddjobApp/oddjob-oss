import { useState, useEffect } from 'react';
import { useLocation } from "wouter";
import { Settings as SettingsIcon, Database, Bell, Shield, Clock, Save, Users as UsersIcon, Mail, BookOpen, Network, Sparkles, Monitor, BellRing, KeyRound, CreditCard } from 'lucide-react';

import LocalAiSettings from './LocalAiSettings';
import GmailSettings from './GmailSettings';
import SystemAiDefaultsCard from './SystemAiDefaultsCard';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@domain-ui/core/ui/components/ui/tabs';
import { useMaintenanceMode } from '@/contexts/MaintenanceContext';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { getSessionTimeout, setSessionTimeout } from '@domain-ui/core/ui/hooks/use-session-timeout';
import Users from './Users';
import { apiRequest } from '@/lib/queryClient';
import { jobTypes } from "@shared/schema/jobs/types";
import { GovernanceTab } from './GovernanceTab';
import { NotificationsTab } from './NotificationsTab';
import { AgentToolGovernanceCard } from './settings/AgentToolGovernanceCard';
import { JobTypeGovernanceCard } from './settings/JobTypeGovernanceCard';
import { SystemInfoCard } from './settings/SystemInfoCard';
import { EmbedOAuthCard } from './settings/EmbedOAuthCard';
import { SmtpSettingsCard } from './settings/SmtpSettingsCard';
import { KnowledgeIntegrationCard } from './settings/KnowledgeIntegrationCard';
import { NotificationSettingsCard } from './settings/NotificationSettingsCard';
import { ComputerUseSettingsCard } from './settings/ComputerUseSettingsCard';
import { GeneralSettingsCard } from './settings/GeneralSettingsCard';
import { DataStorageCard } from './settings/DataStorageCard';
import { SecuritySettingsCard } from './settings/SecuritySettingsCard';
import { MissionOrchestrationCard } from './settings/MissionOrchestrationCard';
import { FinancialGuardrailsCard } from './settings/FinancialGuardrailsCard';
import { GranolaConnectionCard } from '@/components/GranolaConnectionCard';

export default function Settings() {
  // GeneralSettingsCard reads this context directly for the toggle; only the
  // current value is needed here, for the save payload below.
  const { isMaintenanceMode } = useMaintenanceMode();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [logRetentionDays, setLogRetentionDays] = useState('30');
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [slackNotifications, setSlackNotifications] = useState(false);
  const [systemTimezone, setSystemTimezone] = useState('UTC');
  const [executionHistoryLimit, setExecutionHistoryLimit] = useState('1000');
  const [emailRecipients, setEmailRecipients] = useState('');
  const [requireMFA, setRequireMFA] = useState(false);
  const [sessionTimeout, setSessionTimeoutValue] = useState<string>(getSessionTimeout().toString());
  const [smtpEnabled, setSmtpEnabled] = useState(false);
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [knowledgeStoreEnabled, setKnowledgeStoreEnabled] = useState(true);
  const [knowledgeGraphEnabled, setKnowledgeGraphEnabled] = useState(true);
  const [psychologistEnabled, setPsychologistEnabled] = useState(true);
  const [skillImportEnabled, setSkillImportEnabled] = useState(false);
  const [missionConcurrency, setMissionConcurrency] = useState(1);
  const [monthlyBudgetUsd, setMonthlyBudgetUsd] = useState('100.00');
  const [budgetResetDay, setBudgetResetDay] = useState(1);
  const [trycuaEnabled, setTrycuaEnabled] = useState(false);
  const [trycuaDefaultOs, setTrycuaDefaultOs] = useState<'linux' | 'windows' | 'macos'>('linux');
  const [trycuaMaxSessionTime, setTrycuaMaxSessionTime] = useState('60');
  const [location, setLocation] = useLocation();

  const [allowedAgentTools, setAllowedAgentTools] = useState<string[]>([]);
  const [allowedJobTypes, setAllowedJobTypes] = useState<string[]>([...jobTypes]);
  const [systemAiDefaults, setSystemAiDefaults] = useState<any>({});
  const [governorSettings, setGovernorSettings] = useState<{ enabled: boolean; mode: 'AUTONOMOUS' | 'ADVISORY' | 'OFF' }>({ enabled: false, mode: 'OFF' });

  const [embedOAuthConfig, setEmbedOAuthConfig] = useState<{
    embedOAuthEnabled?: boolean;
    embedOAuthClientId?: string;
    embedOAuthClientSecretRef?: string;
    embedOAuthAuthUrl?: string;
    embedOAuthTokenUrl?: string;
    embedOAuthScopes?: string[];
    embedOAuthRedirectUri?: string;
  }>({});
  const [profileApiDomainAllowlist, setProfileApiDomainAllowlist] = useState<string[]>([]);

  // Fetch organization settings
  const { data: orgSettings, isLoading: orgSettingsLoading } = useQuery({
    queryKey: ['/api/org-settings'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/org-settings');
      return res.json();
    },
  });

  // Update form state when org settings are loaded
  useEffect(() => {
    if (orgSettings) {
      setKnowledgeStoreEnabled(orgSettings.knowledgeStoreEnabled ?? true);
      setKnowledgeGraphEnabled(orgSettings.knowledgeGraphEnabled ?? true);
      setPsychologistEnabled(orgSettings.psychologistEnabled ?? true);
      setSkillImportEnabled(orgSettings.skillImportEnabled ?? false);
      setAllowedAgentTools(orgSettings.allowedAgentTools || ['calculator', 'search_knowledge_base', 'http_request', 'current_time']);
      setAllowedJobTypes(orgSettings.allowedJobTypes || [...jobTypes]);
      setEmbedOAuthConfig((orgSettings.embedOAuthConfig as Record<string, unknown>) ?? {});
      setProfileApiDomainAllowlist((orgSettings.profileApiDomainAllowlist as string[]) ?? []);
      setMissionConcurrency(orgSettings.missionConcurrency ?? 1);
      setMonthlyBudgetUsd(orgSettings.monthlyBudgetUsd || '100.00');
      setBudgetResetDay(orgSettings.budgetResetDay ?? 1);
      setTrycuaEnabled(orgSettings.trycuaEnabled ?? false);
      setTrycuaDefaultOs(orgSettings.trycuaDefaultOs ?? 'linux');
      setTrycuaMaxSessionTime((orgSettings.trycuaMaxSessionTime ?? 60).toString());
    }
  }, [orgSettings]);

  // Mutation to save organization settings
  const saveOrgSettingsMutation = useMutation({
    mutationFn: async (settingsData: { 
      knowledgeStoreEnabled: boolean; 
      knowledgeGraphEnabled: boolean; 
      psychologistEnabled: boolean; 
      skillImportEnabled: boolean; 
      allowedAgentTools: string[]; 
      allowedJobTypes: string[]; 
      embedOAuthConfig?: Record<string, unknown>; 
      profileApiDomainAllowlist?: string[];
      missionConcurrency: number;
      monthlyBudgetUsd: string;
      budgetResetDay: number;
      trycuaEnabled: boolean;
      trycuaDefaultOs: 'linux' | 'windows' | 'macos';
      trycuaMaxSessionTime: number;
    }) => {
      const res = await apiRequest('PUT', '/api/org-settings', settingsData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/org-settings'] });
      toast({
        title: 'Organization settings saved',
        description: 'Knowledge store and knowledge graph settings have been updated.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Fetch current settings from API
  const { data: settings, isLoading } = useQuery({
    queryKey: ['/api/settings'],
    queryFn: async () => {
      const res = await fetch('/api/settings', {
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error('Failed to fetch settings');
      }
      return res.json();
    },
  });

  // Update form state when settings are loaded
  useEffect(() => {
    if (settings) {
      setLogRetentionDays(settings.logRetentionDays?.toString() || '30');
      setEmailNotifications(settings.emailNotifications ?? true);
      setSlackNotifications(settings.slackNotifications || false);
      setSystemTimezone(settings.systemTimezone || 'UTC');
      setExecutionHistoryLimit(settings.executionHistoryLimit?.toString() || '1000');
      setEmailRecipients(settings.emailRecipients || '');
      setRequireMFA(settings.requireMFA || false);
      if (settings.smtp) {
        setSmtpEnabled(settings.smtp.enabled || false);
        setSmtpHost(settings.smtp.host || '');
        setSmtpPort(settings.smtp.port?.toString() || '587');
        setSmtpSecure(settings.smtp.secure || false);
        setSmtpUser(settings.smtp.user || '');
        setSmtpPass(settings.smtp.pass || '');
        setSmtpFrom(settings.smtp.from || '');
      }
      setSystemAiDefaults(settings.systemAiDefaults || {});
      setGovernorSettings(settings.governorSettings || { enabled: false, mode: 'OFF' });
    }
  }, [settings]);

  useEffect(() => {
    // Load session timeout from storage
    setSessionTimeoutValue(getSessionTimeout().toString());
  }, []);

  // Mutation to save settings
  const saveSettingsMutation = useMutation({
    mutationFn: async (settingsData: any) => {
      const res = await apiRequest('PUT', '/api/settings', settingsData);
      return res;
    },
    onSuccess: () => {
      // Save session timeout to localStorage
      const timeoutMinutes = parseInt(sessionTimeout, 10);
      if (!isNaN(timeoutMinutes) && timeoutMinutes > 0) {
        setSessionTimeout(timeoutMinutes);
      }

      queryClient.invalidateQueries({ queryKey: ['/api/settings'] });
      toast({
        title: 'Settings saved',
        description: 'Your system settings have been updated successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleSaveOrgSettings = () => {
    saveOrgSettingsMutation.mutate({
      knowledgeStoreEnabled,
      knowledgeGraphEnabled,
      psychologistEnabled,
      skillImportEnabled,
      allowedAgentTools,
      allowedJobTypes,
      embedOAuthConfig,
      profileApiDomainAllowlist,
      missionConcurrency,
      monthlyBudgetUsd,
      budgetResetDay,
      trycuaEnabled,
      trycuaDefaultOs,
      trycuaMaxSessionTime: Math.max(1, Math.min(1440, parseInt(trycuaMaxSessionTime, 10) || 60)),
    });
  };

  const handleSaveSettings = () => {
    const timeoutMinutes = parseInt(sessionTimeout, 10);
    const settingsData = {
      maintenanceMode: isMaintenanceMode,
      logRetentionDays: !isNaN(timeoutMinutes) && timeoutMinutes > 0 ? parseInt(logRetentionDays, 10) : 30,
      emailNotifications,
      slackNotifications,
      systemTimezone: systemTimezone || 'UTC',
      executionHistoryLimit: executionHistoryLimit || '1000',
      emailRecipients: emailRecipients || '',
      requireMFA: requireMFA || false,
      smtp: {
        enabled: smtpEnabled,
        host: smtpHost,
        port: parseInt(smtpPort, 10) || 587,
        secure: smtpSecure,
        user: smtpUser,
        pass: smtpPass,
        from: smtpFrom,
      },
      systemAiDefaults,
      governorSettings,
    };

    saveSettingsMutation.mutate(settingsData);
  };

  return (
    <div className="space-y-6">
      {/* The page title ("Settings") is provided by the app header, so this is just
          the lede — dropping the redundant "Administration" heading removes a level
          of nesting (and a duplicate h1) before the tabs. */}
      <p className="text-sm text-muted-foreground">Manage system settings and users</p>

      <Tabs defaultValue="settings" className="space-y-6">
        <TabsList>
          <TabsTrigger value="settings">
            <SettingsIcon className="w-4 h-4 mr-2" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="governance">
            <Shield className="w-4 h-4 mr-2" />
            Governance (OODA)
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <BellRing className="w-4 h-4 mr-2" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="users">
            <UsersIcon className="w-4 h-4 mr-2" />
            User Management
          </TabsTrigger>
          <TabsTrigger value="local_ai">
            <Monitor className="w-4 h-4 mr-2" />
            Local AI
          </TabsTrigger>
        </TabsList>

        <TabsContent value="governance" className="space-y-6">
          <GovernanceTab
            governorSettings={governorSettings}
            setGovernorSettings={setGovernorSettings}
            onSave={handleSaveSettings}
            isSaving={saveSettingsMutation.isPending}
          />
        </TabsContent>

        <TabsContent value="settings" className="space-y-6">
          {/* Sticky header so "Save Changes" stays reachable while scrolling the long form. */}
          <div className="sticky top-0 z-20 -mx-1 flex items-center justify-between border-b border-border bg-background/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div>
              <h2 className="text-xl font-semibold text-foreground">System Settings</h2>
              <p className="text-sm text-muted-foreground mt-1">Configure system preferences and behavior</p>
            </div>
            <Button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleSaveSettings();
              }}
              disabled={saveSettingsMutation.isPending}
              data-testid="button-save-settings"
            >
              <Save className="w-4 h-4 mr-2" />
              {saveSettingsMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>

          <div className="grid gap-6">
            <GranolaConnectionCard />

            <GeneralSettingsCard
              setSystemTimezone={setSystemTimezone}
              systemTimezone={systemTimezone}
            />

            <ComputerUseSettingsCard
              handleSaveOrgSettings={handleSaveOrgSettings}
              orgSettingsLoading={orgSettingsLoading}
              saveOrgSettingsMutation={saveOrgSettingsMutation}
              setTrycuaDefaultOs={setTrycuaDefaultOs}
              setTrycuaEnabled={setTrycuaEnabled}
              setTrycuaMaxSessionTime={setTrycuaMaxSessionTime}
              trycuaDefaultOs={trycuaDefaultOs}
              trycuaEnabled={trycuaEnabled}
              trycuaMaxSessionTime={trycuaMaxSessionTime}
            />

            <DataStorageCard
              executionHistoryLimit={executionHistoryLimit}
              logRetentionDays={logRetentionDays}
              setExecutionHistoryLimit={setExecutionHistoryLimit}
              setLogRetentionDays={setLogRetentionDays}
            />

            <NotificationSettingsCard
              emailNotifications={emailNotifications}
              emailRecipients={emailRecipients}
              handleSaveSettings={handleSaveSettings}
              saveSettingsMutation={saveSettingsMutation}
              setEmailNotifications={setEmailNotifications}
              setEmailRecipients={setEmailRecipients}
              setSlackNotifications={setSlackNotifications}
              slackNotifications={slackNotifications}
            />

            <SystemAiDefaultsCard
              defaults={systemAiDefaults}
              onUpdate={setSystemAiDefaults}
            />

            <GmailSettings />

            <SecuritySettingsCard
              requireMFA={requireMFA}
              sessionTimeout={sessionTimeout}
              setRequireMFA={setRequireMFA}
              setSessionTimeoutValue={setSessionTimeoutValue}
            />

            <SmtpSettingsCard
              setSmtpEnabled={setSmtpEnabled}
              setSmtpFrom={setSmtpFrom}
              setSmtpHost={setSmtpHost}
              setSmtpPass={setSmtpPass}
              setSmtpPort={setSmtpPort}
              setSmtpSecure={setSmtpSecure}
              setSmtpUser={setSmtpUser}
              smtpEnabled={smtpEnabled}
              smtpFrom={smtpFrom}
              smtpHost={smtpHost}
              smtpPass={smtpPass}
              smtpPort={smtpPort}
              smtpSecure={smtpSecure}
              smtpUser={smtpUser}
            />

            <KnowledgeIntegrationCard
              handleSaveOrgSettings={handleSaveOrgSettings}
              knowledgeGraphEnabled={knowledgeGraphEnabled}
              knowledgeStoreEnabled={knowledgeStoreEnabled}
              orgSettingsLoading={orgSettingsLoading}
              psychologistEnabled={psychologistEnabled}
              saveOrgSettingsMutation={saveOrgSettingsMutation}
              setKnowledgeGraphEnabled={setKnowledgeGraphEnabled}
              setKnowledgeStoreEnabled={setKnowledgeStoreEnabled}
              setPsychologistEnabled={setPsychologistEnabled}
              setSkillImportEnabled={setSkillImportEnabled}
              skillImportEnabled={skillImportEnabled}
            />

            <MissionOrchestrationCard
              handleSaveOrgSettings={handleSaveOrgSettings}
              missionConcurrency={missionConcurrency}
              orgSettingsLoading={orgSettingsLoading}
              saveOrgSettingsMutation={saveOrgSettingsMutation}
              setMissionConcurrency={setMissionConcurrency}
            />

            <FinancialGuardrailsCard
              budgetResetDay={budgetResetDay}
              handleSaveOrgSettings={handleSaveOrgSettings}
              monthlyBudgetUsd={monthlyBudgetUsd}
              orgSettingsLoading={orgSettingsLoading}
              saveOrgSettingsMutation={saveOrgSettingsMutation}
              setBudgetResetDay={setBudgetResetDay}
              setMonthlyBudgetUsd={setMonthlyBudgetUsd}
            />

            <EmbedOAuthCard
              embedOAuthConfig={embedOAuthConfig}
              setEmbedOAuthConfig={setEmbedOAuthConfig}
              profileApiDomainAllowlist={profileApiDomainAllowlist}
              setProfileApiDomainAllowlist={setProfileApiDomainAllowlist}
              handleSaveOrgSettings={handleSaveOrgSettings}
              orgSettingsLoading={orgSettingsLoading}
              saveOrgSettingsMutation={saveOrgSettingsMutation}
            />

            <AgentToolGovernanceCard
              allowedAgentTools={allowedAgentTools}
              onChange={setAllowedAgentTools}
              onSave={handleSaveOrgSettings}
              isLoading={orgSettingsLoading}
              isSaving={saveOrgSettingsMutation.isPending}
            />

            <JobTypeGovernanceCard
              allowedJobTypes={allowedJobTypes}
              onChange={setAllowedJobTypes}
              onSave={handleSaveOrgSettings}
              isLoading={orgSettingsLoading}
              isSaving={saveOrgSettingsMutation.isPending}
            />
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-primary" />
                  <CardTitle>System Info</CardTitle>
                </div>
                <CardDescription>Current system status and version</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <SystemInfoCard />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6">
          <NotificationsTab
            emailEnabled={smtpEnabled}
            slackEnabled={slackNotifications}
          />
        </TabsContent>

        <TabsContent value="local_ai">
          <LocalAiSettings />
        </TabsContent>

        <TabsContent value="users" className="space-y-6">
          <Users />
        </TabsContent>
      </Tabs>
    </div>
  );
}
