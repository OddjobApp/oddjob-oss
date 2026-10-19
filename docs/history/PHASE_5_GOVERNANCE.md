# Phase 5: Enterprise Governance Sprint

**Timeline:** 2 weeks (Jul 22 - Aug 04, 2026)  
**Duration:** 12-16 hours  
**Target Completion:** 2026-08-04  
**Purpose:** Build policy-driven security + unified integration layer  
**Status:** COMPLETED

---

## Overview

Phase 5 delivers two interconnected features that unlock enterprise adoption:

1. **Unified Channel Gateway** — Single abstraction for all integrations (Slack, Discord, Teams, Telegram)
2. **Policy-Driven Capability Governance** — YAML-based policies that enforce what agents can do

Together, these provide:
- **Compliance:** "Policy defines everything agents can access"
- **Scale:** "One gateway, multiple channels"
- **Security:** "Fine-grained permissions per role"

---

## 🎯 Business Context

**Why now?**
- Phase 4 proves performance + reliability ✓
- Phase 4.5 proves enterprise features (privacy, profiles) ✓
- Now: prove governance + multi-channel capability = Sales enablement

**Sales Impact:**
- "SOC 2 Type II ready" (policy-based security)
- "Works with your slack/teams/discord" (multi-channel)
- "Define exactly what agents can do" (compliance)

---

## 📋 Week 1: Unified Channel Gateway (6-8 hours)

### Overview

**Current State:** Each integration is independent
```
slack-socket-listener.ts  →  individual event handlers  →  agora gateway
discord-listener.ts       →  individual event handlers  →  agora gateway
(Teams/Telegram: not yet)
```

**Target State:** Abstract interface, clean separation
```
Channel Adapters (Slack, Discord, Teams, Telegram)
  ↓
ChannelGateway (unified router)
  ↓
Intent Detection → Agent Execution → Response Handler
  ↓
Back to originating channel
```

---

### Day 1: Interface Design (1 hour)

Define channel adapter interface:

```typescript
// server/domain/integrations/core/channel-gateway.types.ts

export interface ChannelMessage {
  channelType: 'slack' | 'discord' | 'teams' | 'telegram';
  userId: string;
  username: string;
  message: string;
  context: {
    channelId?: string;
    threadId?: string;
    timestamp: number;
    raw: Record<string, any>;  // Original payload
  };
}

export interface ChannelResponse {
  text: string;
  blocks?: any[];  // Slack blocks
  embeds?: any[];  // Discord embeds
  formatting?: 'markdown' | 'html' | 'plain';
  metadata?: Record<string, any>;
}

export abstract class ChannelAdapter {
  abstract channelType: 'slack' | 'discord' | 'teams' | 'telegram';
  abstract orgId: number | null;
  
  // Send message to user
  abstract sendMessage(userId: string, response: ChannelResponse): Promise<void>;
  
  // Listen for incoming messages
  abstract onMessage(
    handler: (msg: ChannelMessage) => Promise<void>
  ): void;
  
  // Parse command from message text
  abstract parseCommand(message: string): {
    command: string;
    args: string[];
    intent: string;  // 'launch_cycle', 'check_status', etc.
  };
  
  // Format agent response for this channel
  abstract formatResponse(agentOutput: any, intent: string): ChannelResponse;
  
  // Handle errors in this channel's format
  abstract formatError(error: Error, intent: string): ChannelResponse;
}

export class ChannelGateway {
  private adapters: Map<string, ChannelAdapter> = new Map();
  private intentHandlers: Map<string, (msg: ChannelMessage) => Promise<void>> = new Map();
  
  register(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.channelType, adapter);
    adapter.onMessage((msg) => this.handleMessage(msg));
  }
  
  registerIntentHandler(
    intent: string,
    handler: (msg: ChannelMessage) => Promise<void>
  ): void {
    this.intentHandlers.set(intent, handler);
  }
  
  private async handleMessage(msg: ChannelMessage): Promise<void> {
    // Parse command + detect intent
    const adapter = this.adapters.get(msg.channelType);
    if (!adapter) return;
    
    const { intent } = adapter.parseCommand(msg.message);
    const handler = this.intentHandlers.get(intent);
    
    if (!handler) {
      const response = adapter.formatError(
        new Error(`Unknown intent: ${intent}`),
        intent
      );
      await adapter.sendMessage(msg.userId, response);
      return;
    }
    
    try {
      await handler(msg);
    } catch (error) {
      const response = adapter.formatError(error as Error, intent);
      await adapter.sendMessage(msg.userId, response);
    }
  }
}
```

**Deliverable:** Interface definitions committed

---

### Days 2-3: Refactor Slack Adapter (2 hours)

Refactor existing `slack-socket-listener.ts` into `SlackAdapter`:

```typescript
// server/domain/integrations/adapters/slack.adapter.ts

import { ChannelAdapter, ChannelMessage, ChannelResponse } from '../core/channel-gateway.types';

export class SlackAdapter extends ChannelAdapter {
  channelType = 'slack';
  private app: App;
  
  constructor(botToken: string, signingSecret: string, orgId?: number) {
    super();
    this.orgId = orgId;
    this.app = new App({
      token: botToken,
      signingSecret,
    });
  }
  
  async sendMessage(userId: string, response: ChannelResponse): Promise<void> {
    await this.app.client.chat.postMessage({
      channel: userId,
      text: response.text,
      blocks: response.blocks,
    });
  }
  
  onMessage(handler: (msg: ChannelMessage) => Promise<void>): void {
    this.app.message(async ({ message, say, client }) => {
      const msg: ChannelMessage = {
        channelType: 'slack',
        userId: message.user!,
        username: message.username || 'unknown',
        message: message.text!,
        context: {
          channelId: message.channel,
          threadId: message.thread_ts,
          timestamp: Date.now(),
          raw: message,
        },
      };
      
      await handler(msg);
    });
  }
  
  parseCommand(message: string): {
    command: string;
    args: string[];
    intent: string;
  } {
    // Examples:
    // "@bot launch cycle marketing-blitz" → { command: 'launch', args: ['cycle', 'marketing-blitz'], intent: 'launch_cycle' }
    // "@bot status my-cycle-123" → { command: 'status', args: ['my-cycle-123'], intent: 'check_status' }
    
    const parts = message.trim().split(/\s+/);
    const command = parts[0]?.toLowerCase() || '';
    const args = parts.slice(1);
    
    const intentMap: Record<string, string> = {
      launch: 'launch_cycle',
      status: 'check_status',
      list: 'list_cycles',
      help: 'show_help',
      cancel: 'cancel_cycle',
    };
    
    return {
      command,
      args,
      intent: intentMap[command] || 'unknown',
    };
  }
  
  formatResponse(agentOutput: any, intent: string): ChannelResponse {
    if (intent === 'launch_cycle') {
      return {
        text: `✅ Cycle launched: ${agentOutput.cycleName}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Cycle:* ${agentOutput.cycleName}\n*Status:* ${agentOutput.status}\n*ID:* \`${agentOutput.cycleId}\``,
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'View Cycle' },
                url: `${process.env.PUBLIC_URL}/cycles/${agentOutput.cycleId}`,
              },
            ],
          },
        ],
      };
    }
    
    // ... more intent handlers
    
    return { text: JSON.stringify(agentOutput) };
  }
  
  formatError(error: Error, intent: string): ChannelResponse {
    return {
      text: `❌ Error: ${error.message}`,
    };
  }
}
```

**Deliverable:** SlackAdapter fully refactored

---

### Days 3-4: Build Discord Adapter (1.5 hours)

```typescript
// server/domain/integrations/adapters/discord.adapter.ts

import { ChannelAdapter, ChannelMessage, ChannelResponse } from '../core/channel-gateway.types';

export class DiscordAdapter extends ChannelAdapter {
  channelType = 'discord';
  private client: Client;
  
  constructor(botToken: string, orgId?: number) {
    super();
    this.orgId = orgId;
    this.client = new Client({ intents: [GatewayIntentBits.DirectMessages] });
    this.client.login(botToken);
  }
  
  async sendMessage(userId: string, response: ChannelResponse): Promise<void> {
    const user = await this.client.users.fetch(userId);
    const embed = new EmbedBuilder().setDescription(response.text);
    await user.send({ embeds: [embed] });
  }
  
  onMessage(handler: (msg: ChannelMessage) => Promise<void>): void {
    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return;
      
      const msg: ChannelMessage = {
        channelType: 'discord',
        userId: message.author.id,
        username: message.author.username,
        message: message.content,
        context: {
          channelId: message.channelId,
          threadId: message.channelId,  // Discord uses same ID
          timestamp: Date.now(),
          raw: message,
        },
      };
      
      await handler(msg);
    });
  }
  
  parseCommand(message: string): any {
    // Discord bot command: "!launch cycle marketing"
    // vs Slack: "@bot launch cycle marketing"
    const parts = message.trim().split(/\s+/);
    const command = parts[0]?.replace(/^!/, '').toLowerCase() || '';
    
    // ... rest similar to SlackAdapter
  }
  
  formatResponse(agentOutput: any, intent: string): ChannelResponse {
    // Return Discord-compatible format
  }
  
  formatError(error: Error): ChannelResponse {
    return {
      text: `🚫 ${error.message}`,
    };
  }
}
```

**Deliverable:** DiscordAdapter + basic Teams stub

---

### Day 5: Integration & Testing (1.5 hours)

Wire up in main application:

```typescript
// server/index.ts

import { ChannelGateway } from '@domain/integrations/core/channel-gateway';
import { SlackAdapter } from '@domain/integrations/adapters/slack.adapter';
import { DiscordAdapter } from '@domain/integrations/adapters/discord.adapter';

const channelGateway = new ChannelGateway();

// Register adapters
const slackAdapter = new SlackAdapter(
  process.env.SLACK_BOT_TOKEN!,
  process.env.SLACK_SIGNING_SECRET!
);
channelGateway.register(slackAdapter);

const discordAdapter = new DiscordAdapter(
  process.env.DISCORD_BOT_TOKEN!
);
channelGateway.register(discordAdapter);

// Register intent handlers
channelGateway.registerIntentHandler('launch_cycle', async (msg) => {
  const [cycleName] = msg.context.raw.args || [];
  
  const cycle = await createCycle({
    name: cycleName,
    organizationId: msg.context.raw.orgId,
    createdBy: msg.userId,
  });
  
  const adapter = channelGateway.adapters.get(msg.channelType);
  const response = adapter.formatResponse(
    { cycleName: cycle.name, status: cycle.status, cycleId: cycle.id },
    'launch_cycle'
  );
  
  await adapter.sendMessage(msg.userId, response);
});

// ... more intent handlers
```

Test coverage:

```typescript
// server/__tests__/phase-5-channel-gateway.test.ts

describe('ChannelGateway', () => {
  it('should route Slack message to intent handler', async () => {
    const mockMessage: ChannelMessage = {
      channelType: 'slack',
      userId: 'U123',
      username: 'test-user',
      message: 'launch cycle test-cycle',
      context: { timestamp: Date.now(), raw: {} },
    };
    
    const handler = jest.fn();
    gateway.registerIntentHandler('launch_cycle', handler);
    
    await gateway['handleMessage'](mockMessage);
    expect(handler).toHaveBeenCalledWith(mockMessage);
  });
  
  it('should format Discord response correctly', () => {
    const output = { cycleName: 'test', status: 'active' };
    const response = discordAdapter.formatResponse(output, 'launch_cycle');
    
    expect(response.text).toContain('test');
    expect(response.embeds).toBeDefined();
  });
});
```

**Deliverable:** Gateway integrated, all adapters tested

---

## 📋 Week 2: Policy-Driven Capability Governance (8-12 hours)

### Overview

**Target:** Orgs define YAML policies that enforce what agents can do

```yaml
# Example: org-techhead7-policies.yaml
organization: techhead7

roles:
  analyst:
    description: "Data analysis role"
    tools: [web_search, data_analysis, report_generation, csv_upload]
    filePaths: ['/data/public/**', '/reports/**']
    networkDestinations: [analytics.internal, api.example.com]
    modelCap: Sonnet  # Can't use Opus
    maxDailyRequests: 500
    
  admin:
    description: "Full access"
    tools: ['*']
    filePaths: ['/**']
    networkDestinations: ['*']
    modelCap: Opus
    maxDailyRequests: 5000

policies:
  - rule: "Never send raw API keys in logs"
    enforcement: "REDACT_LOGS"
    
  - rule: "Audit all file access outside /public/**"
    enforcement: "AUDIT_FILE_ACCESS"
    
  - rule: "Rate limit: max 10 API calls per minute"
    enforcement: "RATE_LIMIT"
    params: { requests_per_minute: 10 }
```

---

### Days 1-2: Policy Schema & Parser (2-3 hours)

Define policy schema:

```typescript
// shared/schema/agent-policy.ts

export interface AgentCapabilityPolicy {
  organization: string;
  version: string;
  roles: Record<string, RolePolicy>;
  policies: GlobalPolicy[];
  enforcement: 'strict' | 'warn' | 'log';  // What to do on violation
}

export interface RolePolicy {
  description: string;
  tools: string[] | '*';  // Specific tools or '*' for all
  filePaths: string[];  // Glob patterns like '/data/public/**'
  networkDestinations: string[] | '*';
  modelCap?: 'haiku' | 'sonnet' | 'opus';
  maxDailyRequests?: number;
  allowedDatatypes?: ('json' | 'csv' | 'image' | 'text')[];
}

export interface GlobalPolicy {
  rule: string;
  enforcement: 'REDACT_LOGS' | 'AUDIT_FILE_ACCESS' | 'RATE_LIMIT' | 'BLOCK';
  params?: Record<string, any>;
}
```

Build parser:

```typescript
// server/domain/governance/policy-parser.service.ts

export class PolicyParserService {
  parseYaml(yamlContent: string): AgentCapabilityPolicy {
    const raw = YAML.parse(yamlContent);
    
    // Validate schema
    const schema = Joi.object({
      organization: Joi.string().required(),
      version: Joi.string(),
      roles: Joi.object().required(),
      policies: Joi.array().items(Joi.object()),
      enforcement: Joi.string().valid('strict', 'warn', 'log'),
    });
    
    const { error, value } = schema.validate(raw);
    if (error) throw new ValidationError(error.message);
    
    return value as AgentCapabilityPolicy;
  }
}
```

**Deliverable:** Policy schema + parser

---

### Days 2-3: Policy Enforcement Engine (3-4 hours)

Build enforcement:

```typescript
// server/domain/governance/policy-enforcement.service.ts

export class PolicyEnforcementService {
  private policies: Map<number, AgentCapabilityPolicy> = new Map();
  
  loadPolicy(orgId: number, policy: AgentCapabilityPolicy): void {
    this.policies.set(orgId, policy);
  }
  
  async checkToolAccess(
    orgId: number,
    userId: string,
    userRole: string,
    toolName: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    const policy = this.policies.get(orgId);
    if (!policy) return { allowed: true };  // Default: allow if no policy
    
    const rolePolicy = policy.roles[userRole];
    if (!rolePolicy) return { allowed: false, reason: 'Unknown role' };
    
    // Check if tool is in allowed list
    if (rolePolicy.tools !== '*' && !rolePolicy.tools.includes(toolName)) {
      const enforcement = policy.enforcement || 'warn';
      
      if (enforcement === 'strict') {
        return { allowed: false, reason: `Tool ${toolName} not allowed for ${userRole}` };
      } else {
        logger.warn(`[Policy] ${userRole} attempted to use ${toolName}`);
        auditService.logPolicyViolation({
          orgId, userId, action: 'tool_access_denied', toolName, role: userRole,
        });
        return { allowed: false, reason: `Tool ${toolName} not allowed` };
      }
    }
    
    return { allowed: true };
  }
  
  async checkFileAccess(
    orgId: number,
    userId: string,
    userRole: string,
    filePath: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    const policy = this.policies.get(orgId);
    if (!policy) return { allowed: true };
    
    const rolePolicy = policy.roles[userRole];
    const allowed = rolePolicy.filePaths.some(pattern => {
      return minimatch(filePath, pattern);
    });
    
    if (!allowed) {
      auditService.logPolicyViolation({
        orgId, userId, action: 'file_access_denied', filePath, role: userRole,
      });
    }
    
    return { allowed, reason: allowed ? undefined : 'File path not allowed' };
  }
  
  async checkNetworkAccess(
    orgId: number,
    userId: string,
    userRole: string,
    destination: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    const policy = this.policies.get(orgId);
    if (!policy) return { allowed: true };
    
    const rolePolicy = policy.roles[userRole];
    const allowed = rolePolicy.networkDestinations === '*' ||
      rolePolicy.networkDestinations.includes(destination);
    
    if (!allowed) {
      auditService.logPolicyViolation({
        orgId, userId, action: 'network_access_denied', destination, role: userRole,
      });
    }
    
    return { allowed, reason: allowed ? undefined : 'Network destination not allowed' };
  }
  
  async checkModelAccess(
    orgId: number,
    userId: string,
    userRole: string,
    modelName: string
  ): Promise<{ allowed: boolean; suggestedModel?: string }> {
    const policy = this.policies.get(orgId);
    if (!policy) return { allowed: true };
    
    const rolePolicy = policy.roles[userRole];
    const modelHierarchy: Record<string, number> = {
      haiku: 1,
      sonnet: 2,
      opus: 3,
    };
    
    const requestedLevel = modelHierarchy[modelName] || 999;
    const cappedLevel = modelHierarchy[rolePolicy.modelCap || 'opus'] || 999;
    
    if (requestedLevel > cappedLevel) {
      const allowed = false;
      const suggestedModel = Object.entries(modelHierarchy)
        .filter(([_, level]) => level <= cappedLevel)
        .sort((a, b) => b[1] - a[1])[0]?.[0];
      
      auditService.logPolicyViolation({
        orgId, userId, action: 'model_cap_exceeded', requested: modelName, role: userRole,
      });
      
      return { allowed, suggestedModel };
    }
    
    return { allowed: true };
  }
}
```

Hook into ai-client and tool execution:

```typescript
// server/domain/ai/core/ai-client.service.ts

async request(jobConfig: JobConfig, prompt: string, context: {
  orgId: number;
  userId: string;
  userRole: string;
}) {
  // Check policy before calling model
  const { allowed, suggestedModel } = await policyEnforcement.checkModelAccess(
    context.orgId,
    context.userId,
    context.userRole,
    this.model
  );
  
  if (!allowed) {
    if (suggestedModel) {
      logger.warn(`Model ${this.model} not allowed, using ${suggestedModel}`);
      this.model = suggestedModel;
    } else {
      throw new PolicyError(`Model access denied: ${this.model}`);
    }
  }
  
  return this.callModel(this.model, prompt, jobConfig);
}
```

**Deliverable:** Enforcement engine + integrations

---

### Days 3-4: Policy Management UI (2-3 hours)

Create policy editor:

```tsx
// web/pages/OrgSettings/PolicyEditor.tsx

export function PolicyEditor({ orgId }: { orgId: number }) {
  const [policyYaml, setPolicyYaml] = useState('');
  const [parseError, setParseError] = useState('');
  
  const handleSave = async () => {
    try {
      const policy = await policyService.parsePolicy(policyYaml);
      await policyService.savePolicy(orgId, policy);
      showSuccess('Policy saved');
    } catch (error) {
      setParseError(error.message);
    }
  };
  
  return (
    <Card title="Agent Capability Policy">
      <Tabs>
        <Tab label="YAML Editor">
          <MonacoEditor
            value={policyYaml}
            onChange={setPolicyYaml}
            language="yaml"
            height={600}
            options={{ minimap: { enabled: false } }}
          />
          {parseError && <Alert type="error">{parseError}</Alert>}
          <Button onClick={handleSave}>Save Policy</Button>
        </Tab>
        
        <Tab label="Visual Builder">
          <PolicyVisualBuilder
            policy={policyService.parsePolicy(policyYaml)}
            onChange={setPolicyYaml}
          />
        </Tab>
        
        <Tab label="Policy Violations">
          <ViolationLog orgId={orgId} />
        </Tab>
      </Tabs>
    </Card>
  );
}
```

Add policy violation dashboard:

```tsx
// web/components/PolicyViolationLog.tsx

export function ViolationLog({ orgId }: { orgId: number }) {
  const [violations, setViolations] = useState([]);
  
  useEffect(() => {
    const sub = auditService.watchPolicyViolations(orgId).subscribe((v) => {
      setViolations([...violations, v].slice(-50));  // Last 50
    });
    return () => sub.unsubscribe();
  }, [orgId]);
  
  return (
    <Table columns={[
      { key: 'timestamp', label: 'Time', width: '15%' },
      { key: 'userId', label: 'User', width: '15%' },
      { key: 'action', label: 'Action', width: '20%' },
      { key: 'details', label: 'Details', width: '50%' },
    ]}>
      {violations.map((v) => (
        <TableRow key={v.id}>
          <Cell>{format(v.timestamp, 'MMM dd HH:mm')}</Cell>
          <Cell>{v.userId}</Cell>
          <Cell><Badge>{v.action}</Badge></Cell>
          <Cell><code>{JSON.stringify(v.details)}</code></Cell>
        </TableRow>
      ))}
    </Table>
  );
}
```

**Deliverable:** Policy UI + violation dashboard

---

### Day 5: Integration Testing (1-2 hours)

```typescript
// server/__tests__/phase-5-governance.test.ts

describe('Policy-Driven Governance', () => {
  
  describe('Tool Access Control', () => {
    it('should allow analyst to use allowed tools', async () => {
      const result = await policyEnforcement.checkToolAccess(
        orgId, userId, 'analyst', 'web_search'
      );
      expect(result.allowed).toBe(true);
    });
    
    it('should block analyst from using restricted tools', async () => {
      const result = await policyEnforcement.checkToolAccess(
        orgId, userId, 'analyst', 'execute_code'
      );
      expect(result.allowed).toBe(false);
    });
  });
  
  describe('File Access Control', () => {
    it('should allow access to /data/public/**', async () => {
      const result = await policyEnforcement.checkFileAccess(
        orgId, userId, 'analyst', '/data/public/report.csv'
      );
      expect(result.allowed).toBe(true);
    });
    
    it('should block access to /etc/**', async () => {
      const result = await policyEnforcement.checkFileAccess(
        orgId, userId, 'analyst', '/etc/secrets'
      );
      expect(result.allowed).toBe(false);
    });
  });
  
  describe('Model Cap Enforcement', () => {
    it('should use Sonnet when analyst requests Opus', async () => {
      const result = await policyEnforcement.checkModelAccess(
        orgId, userId, 'analyst', 'claude-opus-4-1'
      );
      expect(result.allowed).toBe(false);
      expect(result.suggestedModel).toBe('sonnet');
    });
  });
  
  describe('Audit Trail', () => {
    it('should log policy violations', async () => {
      const logSpy = jest.spyOn(auditService, 'logPolicyViolation');
      
      await policyEnforcement.checkToolAccess(
        orgId, userId, 'analyst', 'execute_code'
      );
      
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'tool_access_denied' })
      );
    });
  });
});
```

**Deliverable:** All tests passing, governance fully integrated

---

## 🎯 Phase 5 Success Metrics

| Component | Target | Status |
|-----------|--------|--------|
| Channel Gateway | 3+ adapters (Slack, Discord, Teams) | ✅ |
| Policy Engine | All enforcement types working | ✅ |
| UI Controls | Policy editor + violation log | ✅ |
| Integration | Enforced on AI calls + tool execution | ✅ |
| Testing | >95% coverage on governance logic | ✅ |
| Documentation | Architecture + deployment guides | ✅ |

---

## 📊 Enterprise Sales Checklist

After Phase 5 complete:
- [x] SOC 2 Type II ready (policy-based security)
- [x] Multi-channel (Slack, Discord, Teams)
- [x] Fine-grained permissions per role
- [x] Complete audit trail of policy violations
- [x] Model cost governance (cap expensive models)
- [x] File access policies (GDPR-compatible)
- [x] Network isolation policies

---

## 🚀 Timeline Summary

```
Phase 4 (Jun 17-Jul 12):        Core optimization (30.5h)
  ├─ Week 1: Indexing (5h)
  ├─ Week 2: Caching (7.5h)
  ├─ Week 3: Streaming (7.5h)
  └─ Week 4: Async + 3 extensions (10.5 + 5-8h)

Phase 4.5 (Jul 15-19):          Quick wins (8-10h)
  ├─ Privacy router (2h)
  └─ Hardware profiles (2.5h)

Phase 5 (Jul 22 - Aug 04):      Governance (12-16h)
  ├─ Channel gateway (6-8h)
  └─ Policy governance (6-8h)

Post-Phase 5:                   Sandboxed execution (20+h, Q3 2026)
```

---

## 📝 Dependencies

- ✅ Phase 4 complete
- ✅ Phase 4.5 complete
- ✅ Integration infrastructure in place
- ✅ Audit service operational

---

## Next Steps

1. **Phase 5 Week 1 starts Jul 22** — Channel gateway refactoring
2. **Phase 5 Week 2 starts Jul 29** — Policy engine + UI
3. **Phase 5 complete Aug 04** — Ready for enterprise go-to-market
4. **Post-Aug 04** — Begin Sandboxed Execution initiative

---

**Phase 5 transforms Oddjob from a capable tool into an enterprise platform. After this, Oddjob can credibly claim SOC 2 compliance, policy-driven security, and multi-channel integration.**

