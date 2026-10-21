# Organization OAuth apps

Organization admins can open Connections → Integrations, expand **Configure
organization OAuth app** under Google or QuickBooks, and save their client ID
and secret. These settings always belong to the selected organization, including
when the card is opened inside a project. Members can see connection readiness
but cannot replace an organization's account or app credentials.

Create a Google OAuth **web application** client or an Intuit QuickBooks app in
the provider's developer console. Register the exact callback URL displayed in
Oddjob. For Google, enable the APIs required by the chosen connection and configure
the consent screen and permitted users. For QuickBooks, choose the matching
sandbox or production credentials and accounting scope. Saving app credentials
does not authorize an account: use **Connect** afterward and complete consent.

App secrets use the existing encrypted-credentials store, keyed by organization
and provider; no schema migration is required. Reads return metadata only. An
organization's app takes precedence over deployment-wide OAuth credentials.
The shared Oddjob OAuth app remains a fallback for organizations without their
own app, while their account tokens remain separate. A stored app that cannot be
decrypted fails closed rather than falling back to shared credentials.

OAuth state records an app fingerprint. Changing app credentials during consent
requires starting again; existing fingerprinted grants require reconnecting when
their app changes. Automatic refresh uses the connector's owning organization,
including background execution without a browser session. Org app settings do
not change the scopes or project restrictions of an existing account grant.

Org-wide connections can be inherited by a project. An explicit project
connection stays within its organization and overrides the inherited connection.
Disconnect inherited connections from organization Integrations. Google
disconnect removes the local encrypted grant without revoking other scopes or
organizations that may use the same Google account.

QuickBooks app credentials cover consent, refresh, and revocation. Webhook
verification remains deployment-managed (`QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN`);
configure the provider's webhook integration separately. This screen does not
provision developer-console apps or webhook subscriptions.
