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

## Google setup walkthrough

The Google card includes this walkthrough next to the credential fields.

1. Open [Google Cloud console](https://console.cloud.google.com/) and select or
   create a project owned by your organization. Use the same project throughout.
2. In **Google Auth platform → Branding**, complete **Get started**, including
   app name, support email, and contact email. Choose the audience: **Internal**
   for your Google Workspace organization when available, or **External** for
   other accounts. For an External app in Testing, add the signing-in account
   under **Audience → Test users**.
3. In **APIs & Services → Library**, enable the APIs you will use:

   | Connection | APIs |
   | --- | --- |
   | Gmail | Gmail API |
   | Drive and document editing | Google Drive API, Google Docs API |
   | Calendar | Google Calendar API |
   | YouTube | YouTube Data API v3 |
   | Combined Gmail + Drive | Gmail, Drive, Docs, and Calendar APIs |

4. In **Google Auth platform → Clients → Create client**, choose **Web
   application**. Add the exact callback displayed by Oddjob to **Authorized
   redirect URIs**, not JavaScript origins. For the production Oddjob site it is
   `https://oddjob.app/api/saas/connectors/google/oauth/callback`; self-hosted
   installations must use their own displayed URL.
5. Copy the client ID and client secret into Oddjob and save. Keep the secret
   private; an API key or service-account JSON file does not replace it.
6. Click the desired **Connect** button and complete Google's account consent.
   Saving the app alone does not authorize an account.

For `redirect_uri_mismatch`, compare the complete redirect URI, including scheme,
host, and path. For blocked access, check test users and Workspace administrator
policy. For API errors, check API enablement in the client's project and the
permissions requested by the chosen connection under **Data Access**.

External apps in Testing that request these service permissions have refresh
tokens that expire after seven days; reconnect as needed. Review Google's
publishing and verification requirements before broader use. Sensitive or
restricted scopes can require additional review. Replacing app credentials also
requires reconnecting existing accounts.

Official references: [consent screen and scopes](https://developers.google.com/workspace/guides/configure-oauth-consent),
[web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server),
and [refresh token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).
