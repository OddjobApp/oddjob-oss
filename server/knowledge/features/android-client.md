# Android app

## Overview
Oddjob CREW for Android is a native Kotlin and Jetpack Compose client that connects to a running Oddjob server. It uses your signed-in account and the organizations you belong to.

## Work with your crew on the move
- Open, create, or join rooms and follow live streamed conversations.
- Complete native chat forms, inspect tool evidence, and review supported approval cards.
- Attach photos and documents, view map cards, and confirm a one-time location beacon before sharing it with the room.
- Read cached recent rooms when offline. Sending messages and taking actions require a connection.
- Receive approval, mission, and room notifications when Firebase push is configured.

## Availability and setup
The client is available in source form; a signed public release is not yet available. A developer build requires JDK 17 or newer and an Android SDK with platform 36. Connect it to your deployed Oddjob origin and sign in. Maps require a Mapbox public token; push requires Firebase setup on the client and server. Without these services, the remaining client can still be built.

The mobile client focuses on CREW rooms. It does not include the full desktop studios or every specialized web rail. Actions retain the server's permissions and approval requirements.
