# Public marketing and announcements

The public homepage is `client/src/pages/marketing/MarketingPage.tsx`. It is
mounted in the login SPA as well as CoreRouting and the marketing entry. The
server serves `login.html` at `/`, so changing only the marketing entry does not
change the production homepage. Explicit `/auth/*` routes remain available.

## Sign-up uses the platform

The homepage embeds `/a/oddjob-announcements?embed=1`, the public deployment of
the owning organization's announcements form agent. It also provides an ordinary
link for visitors who prefer to open the agent separately.

Provision this slug on each deployment before releasing the homepage:

1. In the organization that owns the public site, create an announcements form
   in Forms. Require an email field and an unchecked, required boolean consent
   field. Set single-page navigation without a review step.
2. Publish the form for anyone with the link, without OTP or link expiry. Keep
   reviewer results, datasets, rules, and actions out of the respondent view.
   Responses remain private to the owning organization's authorized users.
3. Create a Form Agent job with the corresponding input schema and document
   template. Publish it under `oddjob-announcements`, with public access and no
   tools, datasets, knowledge topics, or pipelines exposed.
4. Set its welcome message to the existing published-form response envelope:

   ```json
   {"type":"form_studio_form","token":"<48-character published form token>","formName":"Oddjob announcements","releaseNumber":1}
   ```

   AgentDeploymentPage renders this through PublicForm. Disabling **Allow chat input** omits
   the chat composer and shows the published form directly after access checks. Submissions use the
   existing rate-limited Form Studio public API; there is no newsletter-specific
   database or endpoint. The welcome form renders without an AI model call.
5. Read responses through the owning organization's Forms library. Check required
   consent and email validation using the form's test mode. Never treat a saved
   response as proof that an email was delivered or its address was verified.

The public form token is intentionally public. Do not put AgentMail API keys,
provider credentials, subscriber lists, or reviewer information in the deployment's
welcome message or public branding.

## Outbound announcements

Use the owning organization's AgentMail connection for Oddjob announcement
emails. This is separate from the Google/Microsoft account confirmation used
when a person authors an email. The signup agent has no send tools and signing
up does not trigger an email or start a campaign.

Before enabling delivery, configure that organization's AgentMail inbox/key,
implement removal/suppression handling, and connect an explicitly authorized
announcement workflow. Record actual provider receipts and respect consent;
the collection form alone is not a mailing-list delivery service.

## Guided published agents

In a job’s Publish tab, open **Visitor interaction** and turn off **Allow chat input**.
Save the interaction settings. Existing deployments default to chat enabled. This
uses `embedConfig.allowChatInput`; no migration is needed.

You can add named buttons with publisher-defined messages. The public API exposes
only button IDs and labels. It resolves the message server-side and rejects
free-text chat when disabled; structured pipeline forms still require a valid
session nonce for a pipeline or form exposed by that deployment. Form Studio
submissions continue through their existing public form API.
