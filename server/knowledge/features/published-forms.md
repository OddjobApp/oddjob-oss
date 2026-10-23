# Published agents and forms

## Overview
A published agent provides a public page at `/a/:slug`. It can accept chat, present publisher-defined buttons, or display a published form. A guided form experience is useful for announcement sign-ups and structured intake.

## Configure a guided experience
1. Prepare the form fields, validation, and any consent question required for the workflow.
2. Publish the form and connect it to the intended agent deployment.
3. In the agent's **Deploy** tab, open **Visitor interaction**. Turn off **Allow chat input** when visitors should interact only through buttons and forms, then save.
4. Add publisher-defined buttons if the flow needs explicit choices. Open the public page and test each allowed path before sharing it.

Existing deployments default to chat enabled. Disabling chat removes free-text input and the public API rejects free-text messages; button messages are resolved server-side. A configured initial Form Studio form can render directly when chat is disabled and no buttons are configured.

## Submissions and external communication
A collected email address is a form submission, not proof that a subscription message or announcement was delivered. Configure the destination workflow and organization-owned mail connection separately. Keep consent, removal handling, and approval requirements appropriate to the communication.

Pipeline-backed forms require a valid deployment session and an exposed pipeline or form. Form Studio submissions use the existing public form API. Do not place credentials or private documents in public fields, default values, or agent instructions intended for visitors.

## Public example
[Try the Oddjob announcements form](/a/oddjob-announcements) to inspect a published email-and-consent form. Submit only if you intend to sign up.
