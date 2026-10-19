export * from "./core/auth-engine.js";
export * from "./core/user-manager.js";
export * from "./core/password-service.js";
export * from "./core/token-service.js";
export * from "./hooks/security-hooks.js";
export * from "./hooks/notify-hooks.js";

import { authEngine } from "./core/auth-engine.js";
import { userManager } from "./core/user-manager.js";
import { podRegistry } from "../core/infrastructure/pod-registry.service.js";

// Register Pod Facade
podRegistry.register('auth', {
    engine: authEngine,
    users: userManager
});


