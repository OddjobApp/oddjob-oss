# Electron desktop app

## Overview
The Electron desktop app opens a configured Oddjob server in a dedicated desktop window. It does not bundle a backend; your workspace must be running and reachable.

## Desktop conveniences
- Receive native approval notifications and open the workbench by clicking a notification.
- Keep the app in the system tray when its window closes; use the tray menu to quit.
- See pending approval counts through supported badges or Windows tray and taskbar indicators.
- Open installed-app oddjob:// links in the running desktop instance.

## Availability and setup
The desktop shell is available in source form, with Windows installer packaging documented. Code signing and an automatic update feed are still pending. An unsigned Windows installer can trigger SmartScreen. Configure the server origin for your installation rather than expecting a bundled local server.

The shell uses context isolation and sandboxing with Node integration disabled for the page. External sites open in the system browser. This app does not give agents control of your computer's mouse or keyboard; configured remote computer-use sessions remain separate.
