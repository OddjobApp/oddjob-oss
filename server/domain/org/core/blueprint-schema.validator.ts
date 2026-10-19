/**
 * Blueprint Schema Validator
 * 
 * Validates YAML manifest structure and content before provisioning.
 * Provides clear error messages with line numbers and context.
 */

import { createLogger } from "@server/utils/logger.js";
import yaml from "js-yaml";

const logger = createLogger("BlueprintSchemaValidator");

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
}

export interface ValidationError {
    path: string;
    message: string;
    line?: number;
    severity: "error" | "critical";
}

export interface ValidationWarning {
    path: string;
    message: string;
    line?: number;
}

export class BlueprintSchemaValidator {
    /**
     * Validate a YAML manifest string
     */
    static validate(yamlContent: string): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];

        try {
            const manifest = yaml.load(yamlContent) as any;
            
            if (!manifest) {
                errors.push({
                    path: "root",
                    message: "YAML content is empty or invalid",
                    severity: "critical"
                });
                return { valid: false, errors, warnings };
            }

            // Validate required top-level fields
            this.validateTopLevelFields(manifest, errors, warnings);
            
            // Validate guardrails
            this.validateGuardrails(manifest, errors, warnings);
            
            // Validate tech stack
            this.validateTechStack(manifest, errors, warnings);
            
            // Validate integrations
            this.validateIntegrations(manifest, errors, warnings);
            
            // Validate agents
            this.validateAgents(manifest, errors, warnings);
            
            // Validate missions
            this.validateMissions(manifest, errors, warnings);
            
            // Validate templates
            this.validateTemplates(manifest, errors, warnings);
            
            // Validate forms
            this.validateForms(manifest, errors, warnings);
            
            // Validate schedules
            this.validateSchedules(manifest, errors, warnings);
            
            // Validate escalations
            this.validateEscalations(manifest, errors, warnings);
            
            // Validate new configuration sections
            this.validateAIProvider(manifest, errors, warnings);
            this.validateKnowledgeGraph(manifest, errors, warnings);
            this.validateMCPServers(manifest, errors, warnings);
            this.validateObservability(manifest, errors, warnings);
            this.validateQualityGates(manifest, errors, warnings);
            this.validateDeployment(manifest, errors, warnings);
            this.validateNotifications(manifest, errors, warnings);
            this.validateHumanRoles(manifest, errors, warnings);
            this.validateApps(manifest, errors, warnings);
            this.validateOrgCustomizations(manifest, errors, warnings);
            this.validateChaining(manifest, errors, warnings);

        } catch (e: any) {
            errors.push({
                path: "yaml",
                message: `YAML parsing failed: ${e.message}`,
                severity: "critical"
            });
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    private static validateTopLevelFields(manifest: any, errors: ValidationError[], warnings: ValidationWarning[]) {
        if (!manifest.name) {
            errors.push({
                path: "name",
                message: "Required field 'name' is missing",
                severity: "error"
            });
        }

        if (!manifest.version) {
            warnings.push({
                path: "version",
                message: "Field 'version' is missing, defaulting to '1.0.0'"
            });
        }

        if (!manifest.description) {
            warnings.push({
                path: "description",
                message: "Field 'description' is missing"
            });
        }
    }

    private static validateGuardrails(manifest: any, errors: ValidationError[], warnings: ValidationWarning[]) {
        if (!manifest.guardrails) return;

        const guardrails = manifest.guardrails;
        
        if (guardrails.token_budget_per_ticket !== undefined) {
            if (typeof guardrails.token_budget_per_ticket !== "number" || guardrails.token_budget_per_ticket <= 0) {
                errors.push({
                    path: "guardrails.token_budget_per_ticket",
                    message: "token_budget_per_ticket must be a positive number",
                    severity: "error"
                });
            }
        }

        // Also accept token_budget_per_launch (used by non-SDLC cycles like Product Launch)
        if (guardrails.token_budget_per_launch !== undefined) {
            if (typeof guardrails.token_budget_per_launch !== "number" || guardrails.token_budget_per_launch <= 0) {
                errors.push({
                    path: "guardrails.token_budget_per_launch",
                    message: "token_budget_per_launch must be a positive number",
                    severity: "error"
                });
            }
        }

        if (guardrails.max_thrashing_iterations !== undefined) {
            if (typeof guardrails.max_thrashing_iterations !== "number" || guardrails.max_thrashing_iterations < 0) {
                errors.push({
                    path: "guardrails.max_thrashing_iterations",
                    message: "max_thrashing_iterations must be a non-negative number",
                    severity: "error"
                });
            }
        }
    }

    private static validateTechStack(manifest: any, errors: ValidationError[], warnings: ValidationWarning[]) {
        if (!manifest.tech_stack) {
            warnings.push({
                path: "tech_stack",
                message: "tech_stack section is missing"
            });
            return;
        }

        const requiredFields = ["backend_language", "frontend_framework"];
        for (const field of requiredFields) {
            if (!manifest.tech_stack[field]) {
                errors.push({
                    path: `tech_stack.${field}`,
                    message: `Required field '${field}' is missing`,
                    severity: "error"
                });
            }
        }
    }

    private static validateIntegrations(manifest: any, errors: ValidationError[], warnings: ValidationWarning[]) {
        if (!manifest.integrations) return;

        const requiredIntegrations = ["source_control", "database", "jira", "slack"];
        
        for (const integrationName of requiredIntegrations) {
            const integration = manifest.integrations[integrationName];
            if (!integration) {
                errors.push({
                    path: `integrations.${integrationName}`,
                    message: `Required integration '${integrationName}' is missing`,
                    severity: "error"
                });
            } else if (integration.required === true) {
                // Required integrations must reference at least one ${ENV.X} secret — never inline
                const hasEnvVar = Object.values(integration).some(
                    (val: any) => typeof val === "string" && /\$\{ENV\.[A-Z_][A-Z0-9_]*\}/.test(val)
                );
                if (!hasEnvVar) {
                    errors.push({
                        path: `integrations.${integrationName}`,
                        message: `Required integration '${integrationName}' must reference at least one \${ENV.X} secret — inline credentials are not permitted`,
                        severity: "error"
                    });
                }
                // Explicitly reject hardcoded secret patterns in known sensitive fields
                const sensitiveFields = ["api_token", "api_key", "auth_token", "secret", "password", "client_secret"];
                for (const field of sensitiveFields) {
                    const value = (integration as any)[field];
                    if (typeof value === "string" && value.length > 0 && !/^\$\{ENV\.[A-Z_][A-Z0-9_]*\}$/.test(value)) {
                        errors.push({
                            path: `integrations.${integrationName}.${field}`,
                            message: `Field '${field}' must be a \${ENV.X} reference, not a literal value`,
                            severity: "error"
                        });
                    }
                }
            }
        }
    }

    private static validateAgents(manifest: any, errors: ValidationError[], warnings: ValidationWarning[]) {
        if (!manifest.agents || !Array.isArray(manifest.agents)) {
            errors.push({
                path: "agents",
                message: "agents section is missing or not an array",
                severity: "error"
            });
            return;
        }

        const agentIds = new Set<string>();
        
        for (let i = 0; i < manifest.agents.length; i++) {
            const agent = manifest.agents[i];
            
            if (!agent.id) {
                errors.push({
                    path: `agents[${i}].id`,
                    message: "Agent id is required",
                    severity: "error"
                });
            } else if (agentIds.has(agent.id)) {
                errors.push({
                    path: `agents[${i}].id`,
                    message: `Duplicate agent id: ${agent.id}`,
                    severity: "error"
                });
            } else {
                agentIds.add(agent.id);
            }

            if (!agent.name) {
                errors.push({
                    path: `agents[${i}].name`,
                    message: "Agent name is required",
                    severity: "error"
                });
            }

            if (!agent.system_prompt) {
                errors.push({
                    path: `agents[${i}].system_prompt`,
                    message: "Agent system_prompt is required",
                    severity: "error"
                });
            } else if (typeof agent.system_prompt === "string" && agent.system_prompt.startsWith("file://")) {
                // File path validation - warn but don't error (will be checked during provisioning)
                warnings.push({
                    path: `agents[${i}].system_prompt`,
                    message: `System prompt references file: ${agent.system_prompt}`
                });
            }

            if (!agent.model) {
                warnings.push({
                    path: `agents[${i}].model`,
                    message: "Agent model is not specified, will use default"
                });
            }

            if (agent.tools && !Array.isArray(agent.tools)) {
                errors.push({
                    path: `agents[${i}].tools`,
                    message: "Agent tools must be an array",
                    severity: "error"
                });
            }

            // intake_form must name a declared forms[] entry — the deployment
            // form manifest serves it on first contact
            if (agent.intake_form !== undefined && agent.intake_form !== null && agent.intake_form !== "") {
                const formIds = new Set((Array.isArray(manifest.forms) ? manifest.forms : []).map((f: any) => f?.id));
                if (!formIds.has(agent.intake_form)) {
                    warnings.push({
                        path: `agents[${i}].intake_form`,
                        message: `intake_form "${agent.intake_form}" does not match any forms[].id — the agent will deploy without an intake form`
                    });
                }
            }

            // publish_as_public_agent declares a standalone agentDeployments surface
            if (agent.publish_as_public_agent !== undefined && agent.publish_as_public_agent !== null) {
                const pub = agent.publish_as_public_agent;
                if (typeof pub !== "object") {
                    errors.push({
                        path: `agents[${i}].publish_as_public_agent`,
                        message: "publish_as_public_agent must be an object with slug and title",
                        severity: "error"
                    });
                } else {
                    if (typeof pub.slug !== "string" || !/^[a-z0-9-]{3,}$/.test(pub.slug)) {
                        errors.push({
                            path: `agents[${i}].publish_as_public_agent.slug`,
                            message: "publish_as_public_agent.slug must be lowercase alphanumeric with hyphens (min 3 chars)",
                            severity: "error"
                        });
                    }
                    if (pub.access_policy !== undefined && !["public", "password", "internal_only"].includes(pub.access_policy)) {
                        errors.push({
                            path: `agents[${i}].publish_as_public_agent.access_policy`,
                            message: "access_policy must be one of: public, password, internal_only",
                            severity: "error"
                        });
                    }
                }
            }

            // Validate per-agent max_iterations override
            if (agent.max_iterations !== undefined) {
                if (typeof agent.max_iterations !== "number" || agent.max_iterations < 1 || agent.max_iterations > 100) {
                    errors.push({
                        path: `agents[${i}].max_iterations`,
                        message: "Agent max_iterations must be a number between 1 and 100",
                        severity: "error"
                    });
                }
            }

            // Validate per-agent token_budget override
            if (agent.token_budget !== undefined) {
                if (typeof agent.token_budget !== "number" || agent.token_budget <= 0) {
                    errors.push({
                        path: `agents[${i}].token_budget`,
                        message: "Agent token_budget must be a positive number",
                        severity: "error"
                    });
                }
            }

            // Validate execution_strategy if present
            if (agent.execution_strategy) {
                const strategy = agent.execution_strategy;
                const validStrategies = ["plan_then_execute", "execute_and_verify", "iterative"];
                if (strategy.iteration_strategy && !validStrategies.includes(strategy.iteration_strategy)) {
                    warnings.push({
                        path: `agents[${i}].execution_strategy.iteration_strategy`,
                        message: `Unknown iteration strategy '${strategy.iteration_strategy}', expected one of: ${validStrategies.join(", ")}`
                    });
                }
                if (strategy.max_consecutive_failures !== undefined && (typeof strategy.max_consecutive_failures !== "number" || strategy.max_consecutive_failures < 1)) {
                    errors.push({
                        path: `agents[${i}].execution_strategy.max_consecutive_failures`,
                        message: "max_consecutive_failures must be a positive number",
                        severity: "error"
                    });
                }
            }
        }
    }

    private static validateMissions(manifest: any, errors: ValidationError[], warnings: ValidationWarning[]) {
        if (!manifest.missions || !Array.isArray(manifest.missions)) {
            errors.push({
                path: "missions",
                message: "missions section is missing or not an array",
                severity: "error"
            });
            return;
        }

        const missionIds = new Set<string>();
        
        for (let i = 0; i < manifest.missions.length; i++) {
            const mission = manifest.missions[i];
            
            if (!mission.id) {
                errors.push({
                    path: `missions[${i}].id`,
                    message: "Mission id is required",
                    severity: "error"
                });
            } else if (missionIds.has(mission.id)) {
                errors.push({
                    path: `missions[${i}].id`,
                    message: `Duplicate mission id: ${mission.id}`,
                    severity: "error"
                });
            } else {
                missionIds.add(mission.id);
            }

            if (!mission.name) {
                errors.push({
                    path: `missions[${i}].name`,
                    message: "Mission name is required",
                    severity: "error"
                });
            }

            if (!mission.primary_agent) {
                errors.push({
                    path: `missions[${i}].primary_agent`,
                    message: "Mission primary_agent is required",
                    severity: "error"
                });
            }

            // Validate trigger
            if (!mission.trigger) {
                errors.push({
                    path: `missions[${i}].trigger`,
                    message: "Mission trigger is required",
                    severity: "error"
                });
            } else if (typeof mission.trigger === "string" && mission.trigger.startsWith("on_success(")) {
                const match = mission.trigger.match(/^on_success\(([^)]+)\)$/);
                if (match) {
                    const upstreamId = match[1].trim();
                    if (!missionIds.has(upstreamId)) {
                        warnings.push({
                            path: `missions[${i}].trigger`,
                            message: `Trigger references mission '${upstreamId}' which may not exist yet`
                        });
                    }
                }
            }

            // Validate sequence
            if (mission.sequence && !Array.isArray(mission.sequence)) {
                errors.push({
                    path: `missions[${i}].sequence`,
                    message: "Mission sequence must be an array",
                    severity: "error"
                });
            }
        }
    }

    private static validateTemplates(manifest: any, errors: ValidationError[], warnings: ValidationWarning[]) {
        if (!manifest.templates || !Array.isArray(manifest.templates)) return;

        const templateIds = new Set<string>();
        
        for (let i = 0; i < manifest.templates.length; i++) {
            const template = manifest.templates[i];
            
            if (!template.id) {
                errors.push({
                    path: `templates[${i}].id`,
                    message: "Template id is required",
                    severity: "error"
                });
            } else if (templateIds.has(template.id)) {
                errors.push({
                    path: `templates[${i}].id`,
                    message: `Duplicate template id: ${template.id}`,
                    severity: "error"
                });
            } else {
                templateIds.add(template.id);
            }

            if (!template.path) {
                errors.push({
                    path: `templates[${i}].path`,
                    message: "Template path is required",
                    severity: "error"
                });
            }
        }
    }

    private static validateForms(manifest: any, errors: ValidationError[], warnings: ValidationWarning[]) {
        if (!manifest.forms || !Array.isArray(manifest.forms)) return;

        const formIds = new Set<string>();
        
        for (let i = 0; i < manifest.forms.length; i++) {
            const form = manifest.forms[i];
            
            if (!form.id) {
                errors.push({
                    path: `forms[${i}].id`,
                    message: "Form id is required",
                    severity: "error"
                });
            } else if (formIds.has(form.id)) {
                errors.push({
                    path: `forms[${i}].id`,
                    message: `Duplicate form id: ${form.id}`,
                    severity: "error"
                });
            } else {
                formIds.add(form.id);
            }

            if (!form.name) {
                errors.push({
                    path: `forms[${i}].name`,
                    message: "Form name is required",
                    severity: "error"
                });
            }

            if (!form.fields || !Array.isArray(form.fields)) {
                errors.push({
                    path: `forms[${i}].fields`,
                    message: "Form fields must be an array",
                    severity: "error"
                });
            }
        }
    }

    private static validateSchedules(manifest: any, errors: ValidationError[], warnings: ValidationWarning[]) {
        if (!manifest.schedules || !Array.isArray(manifest.schedules)) return;

        const scheduleIds = new Set<string>();
        
        for (let i = 0; i < manifest.schedules.length; i++) {
            const schedule = manifest.schedules[i];
            
            if (!schedule.id) {
                errors.push({
                    path: `schedules[${i}].id`,
                    message: "Schedule id is required",
                    severity: "error"
                });
            } else if (scheduleIds.has(schedule.id)) {
                errors.push({
                    path: `schedules[${i}].id`,
                    message: `Duplicate schedule id: ${schedule.id}`,
                    severity: "error"
                });
            } else {
                scheduleIds.add(schedule.id);
            }

            if (!schedule.cron) {
                errors.push({
                    path: `schedules[${i}].cron`,
                    message: "Schedule cron expression is required",
                    severity: "error"
                });
            }
        }
    }

    private static validateEscalations(manifest: any, errors: ValidationError[], warnings: ValidationWarning[]) {
        if (!manifest.escalations || !Array.isArray(manifest.escalations)) return;

        for (let i = 0; i < manifest.escalations.length; i++) {
            const escalation = manifest.escalations[i];
            
            if (!escalation.mission_ref) {
                errors.push({
                    path: `escalations[${i}].mission_ref`,
                    message: "Escalation mission_ref is required",
                    severity: "error"
                });
            }

            if (!escalation.alert_channels || !Array.isArray(escalation.alert_channels)) {
                errors.push({
                    path: `escalations[${i}].alert_channels`,
                    message: "Escalation alert_channels must be an array",
                    severity: "error"
                });
            }

            if (escalation.warning_threshold_minutes !== undefined && escalation.warning_threshold_minutes < 0) {
                errors.push({
                    path: `escalations[${i}].warning_threshold_minutes`,
                    message: "warning_threshold_minutes must be non-negative",
                    severity: "error"
                });
            }

            if (escalation.critical_threshold_minutes !== undefined && escalation.critical_threshold_minutes < 0) {
                errors.push({
                    path: `escalations[${i}].critical_threshold_minutes`,
                    message: "critical_threshold_minutes must be non-negative",
                    severity: "error"
                });
            }
        }
    }

    private static validateAIProvider(manifest: any, errors: ValidationError[], warnings: ValidationWarning[]) {
        if (!manifest.ai_provider) return;

        const aiProvider = manifest.ai_provider;
        
        if (!aiProvider.provider) {
            errors.push({
                path: "ai_provider.provider",
                message: "AI provider is required",
                severity: "error"
            });
        }

        const validProviders = ["anthropic", "openai", "google"];
        if (aiProvider.provider && !validProviders.includes(aiProvider.provider)) {
            warnings.push({
                path: "ai_provider.provider",
                message: `Unknown provider '${aiProvider.provider}', expected one of: ${validProviders.join(", ")}`
            });
        }

        if (!aiProvider.api_key) {
            errors.push({
                path: "ai_provider.api_key",
                message: "AI provider API key is required",
                severity: "error"
            });
        } else if (!/^\$\{ENV\.[A-Z_][A-Z0-9_]*\}$/.test(String(aiProvider.api_key))) {
            errors.push({
                path: "ai_provider.api_key",
                message: "AI provider API key must be a ${ENV.X} reference, not a literal value",
                severity: "error"
            });
        }
    }

    private static validateKnowledgeGraph(manifest: any, errors: ValidationError[], warnings: ValidationWarning[]) {
        if (!manifest.knowledge_graph) return;

        const kg = manifest.knowledge_graph;
        
        if (kg.vector_db && !kg.vector_db.provider) {
            errors.push({
                path: "knowledge_graph.vector_db.provider",
                message: "Vector DB provider is required",
                severity: "error"
            });
        }

        if (kg.embedding && !kg.embedding.model) {
            errors.push({
                path: "knowledge_graph.embedding.model",
                message: "Embedding model is required",
                severity: "error"
            });
        }
    }

    private static validateMCPServers(manifest: any, errors: ValidationError[], warnings: ValidationWarning[]) {
        if (!manifest.mcp_servers) return;

        for (const [serverName, serverConfig] of Object.entries(manifest.mcp_servers as Record<string, any>)) {
            if (!serverConfig.endpoint) {
                errors.push({
                    path: `mcp_servers.${serverName}.endpoint`,
                    message: "MCP server endpoint is required",
                    severity: "error"
                });
            }

            if (!serverConfig.tools || !Array.isArray(serverConfig.tools)) {
                errors.push({
                    path: `mcp_servers.${serverName}.tools`,
                    message: "MCP server tools must be an array",
                    severity: "error"
                });
            }
        }
    }

    private static validateObservability(manifest: any, errors: ValidationError[], warnings: ValidationWarning[]) {
        if (!manifest.observability) return;

        const obs = manifest.observability;
        
        if (obs.logging) {
            const validLevels = ["debug", "info", "warn", "error"];
            if (obs.logging.level && !validLevels.includes(obs.logging.level)) {
                errors.push({
                    path: "observability.logging.level",
                    message: `Invalid log level '${obs.logging.level}', expected one of: ${validLevels.join(", ")}`,
                    severity: "error"
                });
            }
        }

        if (obs.metrics && obs.metrics.enabled === true && !obs.metrics.endpoint) {
            warnings.push({
                path: "observability.metrics.endpoint",
                message: "Metrics are enabled but no endpoint is specified"
            });
        }
    }

    private static validateQualityGates(manifest: any, errors: ValidationError[], warnings: ValidationWarning[]) {
        if (!manifest.quality_gates) return;

        const qg = manifest.quality_gates;
        
        if (qg.test_coverage && qg.test_coverage.minimum !== undefined) {
            if (qg.test_coverage.minimum < 0 || qg.test_coverage.minimum > 100) {
                errors.push({
                    path: "quality_gates.test_coverage.minimum",
                    message: "Test coverage minimum must be between 0 and 100",
                    severity: "error"
                });
            }
        }
    }

    private static validateDeployment(manifest: any, errors: ValidationError[], warnings: ValidationWarning[]) {
        if (!manifest.deployment) return;

        const deploy = manifest.deployment;
        
        if (deploy.environments) {
            const requiredEnvs = ["staging", "production"];
            for (const env of requiredEnvs) {
                if (!deploy.environments[env]) {
                    warnings.push({
                        path: `deployment.environments.${env}`,
                        message: `Required environment '${env}' is missing`
                    });
                }
            }
        }
    }

    private static validateNotifications(manifest: any, errors: ValidationError[], warnings: ValidationWarning[]) {
        if (!manifest.notifications) return;

        const notif = manifest.notifications;
        
        if (notif.email && notif.email.enabled === true && !notif.email.from_address) {
            warnings.push({
                path: "notifications.email.from_address",
                message: "Email notifications are enabled but from_address is not specified"
            });
        }
    }

    private static validateHumanRoles(manifest: any, errors: ValidationError[], warnings: ValidationWarning[]) {
        if (!manifest.human_roles) return;

        const hr = manifest.human_roles;
        
        if (!hr.team) {
            warnings.push({
                path: "human_roles.team",
                message: "Team name is not specified, will use 'Default Team'"
            });
        }

        if (hr.members && !Array.isArray(hr.members)) {
            errors.push({
                path: "human_roles.members",
                message: "Members must be an array",
                severity: "error"
            });
        } else if (hr.members && Array.isArray(hr.members)) {
            for (let i = 0; i < hr.members.length; i++) {
                const member = hr.members[i];
                
                if (!member.user_id) {
                    errors.push({
                        path: `human_roles.members[${i}].user_id`,
                        message: "user_id is required",
                        severity: "error"
                    });
                }

                if (!member.role) {
                    errors.push({
                        path: `human_roles.members[${i}].role`,
                        message: "role is required",
                        severity: "error"
                    });
                }

                if (member.permissions && !Array.isArray(member.permissions)) {
                    errors.push({
                        path: `human_roles.members[${i}].permissions`,
                        message: "permissions must be an array",
                        severity: "error"
                    });
                }
            }
        }
    }

    private static validateApps(manifest: any, errors: ValidationError[], warnings: ValidationWarning[]) {
        if (!manifest.apps) return;

        if (!Array.isArray(manifest.apps)) {
            errors.push({
                path: "apps",
                message: "Apps must be an array",
                severity: "error"
            });
            return;
        }

        for (let i = 0; i < manifest.apps.length; i++) {
            const app = manifest.apps[i];
            
            if (!app.id) {
                errors.push({
                    path: `apps[${i}].id`,
                    message: "App id is required",
                    severity: "error"
                });
            }

            if (!app.path && !app.schema) {
                errors.push({
                    path: `apps[${i}]`,
                    message: "App must have either 'path' or 'schema'",
                    severity: "error"
                });
            }

            if (app.path && typeof app.path !== "string") {
                errors.push({
                    path: `apps[${i}].path`,
                    message: "App path must be a string",
                    severity: "error"
                });
            }

            if (app.schema && typeof app.schema !== "string" && typeof app.schema !== "object") {
                errors.push({
                    path: `apps[${i}].schema`,
                    message: "App schema must be a string or object",
                    severity: "error"
                });
            }

            if (app.enabled !== undefined && typeof app.enabled !== "boolean") {
                errors.push({
                    path: `apps[${i}].enabled`,
                    message: "App enabled must be a boolean",
                    severity: "error"
                });
            }

            // Mission bindings (Phase 1 of mission-first SDLC apps)
            // Accepts:  ["mission-id"]
            //        OR [{ mission: "...", role?: "primary|reference|oversight", label?, openMode? }]
            if (app.bindings !== undefined) {
                if (!Array.isArray(app.bindings)) {
                    errors.push({
                        path: `apps[${i}].bindings`,
                        message: "App bindings must be an array",
                        severity: "error"
                    });
                } else {
                    app.bindings.forEach((b: unknown, j: number) => {
                        if (typeof b === "string") return;
                        if (b && typeof b === "object" && typeof (b as any).mission === "string") {
                            const r = (b as any).role;
                            if (r !== undefined && !["primary", "reference", "oversight"].includes(r)) {
                                errors.push({
                                    path: `apps[${i}].bindings[${j}].role`,
                                    message: "binding role must be one of: primary, reference, oversight",
                                    severity: "error"
                                });
                            }
                            const om = (b as any).openMode;
                            if (om !== undefined && !["modal", "page"].includes(om)) {
                                errors.push({
                                    path: `apps[${i}].bindings[${j}].openMode`,
                                    message: "binding openMode must be 'modal' or 'page'",
                                    severity: "error"
                                });
                            }
                            return;
                        }
                        errors.push({
                            path: `apps[${i}].bindings[${j}]`,
                            message: "Each binding must be a string (mission id/name) or { mission, role?, label?, openMode? }",
                            severity: "error"
                        });
                    });
                }
            }
            if (app.bindingRole !== undefined && !["primary", "reference", "oversight"].includes(app.bindingRole)) {
                errors.push({
                    path: `apps[${i}].bindingRole`,
                    message: "bindingRole must be one of: primary, reference, oversight",
                    severity: "error"
                });
            }
            if (app.openMode !== undefined && !["modal", "page"].includes(app.openMode)) {
                errors.push({
                    path: `apps[${i}].openMode`,
                    message: "openMode must be 'modal' or 'page'",
                    severity: "error"
                });
            }

            if (app.required_roles && !Array.isArray(app.required_roles)) {
                errors.push({
                    path: `apps[${i}].required_roles`,
                    message: "App required_roles must be an array",
                    severity: "error"
                });
            }

            if (app.environment_variables && typeof app.environment_variables !== "object") {
                errors.push({
                    path: `apps[${i}].environment_variables`,
                    message: "App environment_variables must be an object",
                    severity: "error"
                });
            }

            if (app.customizations && typeof app.customizations !== "object") {
                errors.push({
                    path: `apps[${i}].customizations`,
                    message: "App customizations must be an object",
                    severity: "error"
                });
            }
        }
    }

    private static validateOrgCustomizations(manifest: any, errors: ValidationError[], warnings: ValidationWarning[]) {
        if (!manifest.org_customizations) return;

        const customizations = manifest.org_customizations;
        
        if (typeof customizations !== "object") {
            errors.push({
                path: "org_customizations",
                message: "org_customizations must be an object",
                severity: "error"
            });
            return;
        }

        // Validate ui customizations
        if (customizations.ui && typeof customizations.ui !== "object") {
            errors.push({
                path: "org_customizations.ui",
                message: "ui customizations must be an object",
                severity: "error"
            });
        }

        // Validate workflow customizations
        if (customizations.workflow && typeof customizations.workflow !== "object") {
            errors.push({
                path: "org_customizations.workflow",
                message: "workflow customizations must be an object",
                severity: "error"
            });
        }

        // Validate security customizations
        if (customizations.security && typeof customizations.security !== "object") {
            errors.push({
                path: "org_customizations.security",
                message: "security customizations must be an object",
                severity: "error"
            });
        }

        // Validate notifications customizations
        if (customizations.notifications && typeof customizations.notifications !== "object") {
            errors.push({
                path: "org_customizations.notifications",
                message: "notifications customizations must be an object",
                severity: "error"
            });
        }
    }

    private static validateChaining(manifest: any, errors: ValidationError[], warnings: ValidationWarning[]) {
        if (manifest.follow_up_cycle_template_id !== undefined) {
            if (typeof manifest.follow_up_cycle_template_id !== "number" && typeof manifest.follow_up_cycle_template_id !== "string") {
                errors.push({
                    path: "follow_up_cycle_template_id",
                    message: "follow_up_cycle_template_id must be a number or string",
                    severity: "error"
                });
            }
        }

        if (manifest.follow_up_cycle !== undefined) {
            const fc = manifest.follow_up_cycle;
            if (typeof fc !== "object" || fc === null) {
                errors.push({
                    path: "follow_up_cycle",
                    message: "follow_up_cycle must be an object",
                    severity: "error"
                });
                return;
            }

            if (!fc.name) {
                errors.push({
                    path: "follow_up_cycle.name",
                    message: "Required field 'name' in follow_up_cycle is missing",
                    severity: "error"
                });
            }

            if (!fc.objective) {
                errors.push({
                    path: "follow_up_cycle.objective",
                    message: "Required field 'objective' in follow_up_cycle is missing",
                    severity: "error"
                });
            }

            if (!fc.blueprints || !Array.isArray(fc.blueprints) || fc.blueprints.length === 0) {
                errors.push({
                    path: "follow_up_cycle.blueprints",
                    message: "follow_up_cycle.blueprints must be a non-empty array",
                    severity: "error"
                });
            } else {
                for (let i = 0; i < fc.blueprints.length; i++) {
                    const bp = fc.blueprints[i];
                    if (!bp.name) {
                        errors.push({
                            path: `follow_up_cycle.blueprints[${i}].name`,
                            message: "Blueprint name is required",
                            severity: "error"
                        });
                    }
                    if (!bp.objective) {
                        errors.push({
                            path: `follow_up_cycle.blueprints[${i}].objective`,
                            message: "Blueprint objective is required",
                            severity: "error"
                        });
                    }
                }
            }
        }
    }
}
