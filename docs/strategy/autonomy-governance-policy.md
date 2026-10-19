# Autonomy Governance Policy

Oddjob's autonomy policy gives high-autonomy work a shared risk language before agents touch external systems, generated apps, tools, or remote desktops.

## Policy Contract

The shared policy lives in `shared/governance/autonomy-policy.ts` and returns:

- `allow`: no policy risk requires intervention.
- `review`: a human or higher-level governor should approve before execution.
- `block`: the request should not execute automatically.

Every evaluation includes risk flags, the maximum risk level, review reasons, and a short rationale. This makes policy decisions portable across domains instead of embedding one-off regexes inside each integration.

## Current Risk Classes

- Critical: credentials, passwords, API keys, secrets, financial data, identity data.
- High: destructive actions, financial transactions, external commitments such as sending, publishing, deploying, merging, or releasing.
- Medium: production, customer, legal, compliance, security, audit, and unusually large text or clipboard inputs.

Critical sensitive-data actions are blocked unless the caller explicitly opts into sensitive handling. With that opt-in, Oddjob still returns `review`, not `allow`.

## First Integration

Trycua guided computer use now consumes this policy before executing low-level GUI actions. The planner uses the shared decision to:

- block critical sensitive actions without opt-in,
- require review for high-consequence actions,
- keep typed text and clipboard content redacted in proposed actions,
- preserve policy flags in the computer-use plan and replay trail.

## Smoke Check

Run:

```bash
npm run smoke:autonomy-policy
```

The check validates canonical allow, review, and block cases so future policy changes do not quietly weaken the safety envelope.

## Next Integrations

- Mission orchestration: require approval on destructive, financial, external, or production changes before tool execution.
- App Forge: review generated app publish/deploy actions and schema/data deletion plans.
- Tool registry: classify tool invocations before execution and attach policy flags to audit logs.
- Approval center: display shared policy flags and rationale consistently across domains.
