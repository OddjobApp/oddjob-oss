
# Core Infrastructure Services

This directory contains foundational services that provide common, low-level capabilities used across multiple domains within Oddjob.

## Adversarial Infrastructure ("Hiding" Services)

A key set of services in this module powers the **"Ghost Runner"** Adversarial Selenium Suite. These services work together to allow the agent to mimic a real user and evade detection.

### 1. `fingerprint-manager.service.ts`

*   **Purpose:** Generates realistic, randomized browser fingerprints.
*   **Functionality:** Creates a complete `BrowserFingerprint` object, including a `userAgent`, `viewport` dimensions, `gpuVendor`, and other properties to make the automated browser appear like a standard consumer device.

### 2. `proxy-pool.service.ts`

*   **Purpose:** Manages and rotates through pools of residential and mobile proxies.
*   **Functionality:** This service is responsible for a critical piece of the agent's identity: **Proxy & Fingerprint Synchronization**. When a proxy is requested from the pool, this service pairs it with a corresponding browser fingerprint from the `FingerprintManagerService`. This ensures the agent's network identity (IP address) and browser identity (fingerprint) are coherent and believable.

### 3. `adversarial-ai.service.ts`

*   **Purpose:** Provides a library of known prompt injection and AI "jailbreaking" attack patterns.
*   **Functionality:** This service allows the "Ghost Runner" to test the resilience of Oddjob's own AI agents. It can take a benign prompt and wrap it in a malicious template, such as an instruction hijacking or role-playing attack, before sending it to an AI model.
