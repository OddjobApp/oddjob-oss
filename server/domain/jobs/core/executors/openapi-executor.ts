
import { Job, Pipeline, OpenAPIJobConfig, apiSpecs } from "@shared/schema/index.js";
import { credentials } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";
import { db } from "../../../../database_service.js";
import { eq } from "drizzle-orm";
import { AppError, ErrorCode, ConfigurationError, JobExecutionError } from "@server/utils/errors.js";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

interface AuthContext {
    headers: Record<string, string>;
    queryParams: Record<string, string>;
    secret: string;
    credentialType: string;
    securitySchemes: Record<string, any>;
    operationSecurity: Array<Record<string, string[]>>;
}

/**
 * Applies the correct HTTP authentication scheme based on the OpenAPI spec's
 * securitySchemes and the credential type stored in the DB.
 *
 * Resolution order:
 *  1. Walk operationSecurity refs to find the matching scheme in securitySchemes
 *  2. For that scheme, honour its `type` / `scheme` / `in` / `name` fields
 *  3. Fall back to credential type heuristic (basic → Basic, else Bearer)
 */
function applyOpenApiAuth(ctx: AuthContext): void {
    const { headers, queryParams, secret, credentialType, securitySchemes, operationSecurity } = ctx;

    // Try to find the first applicable scheme definition from the spec
    for (const secReq of operationSecurity) {
        for (const schemeName of Object.keys(secReq)) {
            const scheme = securitySchemes[schemeName];
            if (!scheme) continue;

            const schemeType: string    = (scheme.type   || "").toLowerCase();
            const schemeIn: string      = (scheme.in     || "").toLowerCase();
            const bearerFormat: string  = (scheme.scheme || "").toLowerCase();

            if (schemeType === "http") {
                if (bearerFormat === "basic" || credentialType === "password") {
                    // Basic auth: secret expected as "username:password"
                    headers["Authorization"] = `Basic ${Buffer.from(secret).toString("base64")}`;
                } else {
                    // bearer (default for http type)
                    headers["Authorization"] = `Bearer ${secret}`;
                }
                return;
            }

            if (schemeType === "apikey") {
                if (schemeIn === "query") {
                    queryParams[scheme.name || "api_key"] = secret;
                } else if (schemeIn === "cookie") {
                    headers["Cookie"] = `${scheme.name || "api_key"}=${secret}`;
                } else {
                    // header (default)
                    headers[scheme.name || "X-API-Key"] = secret;
                }
                return;
            }

            if (schemeType === "oauth2" || schemeType === "openidconnect") {
                headers["Authorization"] = `Bearer ${secret}`;
                return;
            }
        }
    }

    // Fallback: no matching scheme found — use credential type heuristic
    if (credentialType === "password") {
        headers["Authorization"] = `Basic ${Buffer.from(secret).toString("base64")}`;
    } else {
        headers["Authorization"] = `Bearer ${secret}`;
    }
}

export class OpenApiExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "openapi";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as OpenAPIJobConfig;
        const [spec] = await db.select().from(apiSpecs).where(eq(apiSpecs.id, config.specId)).limit(1);

        if (!spec) throw new AppError(`OpenAPI Spec ${config.specId} not found`, 404, ErrorCode.NOT_FOUND);

        const specContent = spec.content as unknown;
        const openApiSpec = (typeof specContent === 'string' ? JSON.parse(specContent) : specContent) as any;
        const operationId = config.operationId;

        // Find operation in spec
        let pathName = "";
        let method = "";
        let operationDef: any = null;

        for (const [p, methods] of Object.entries(openApiSpec.paths || {})) {
            for (const [m, op] of Object.entries(methods as any)) {
                if ((op as any).operationId === operationId) {
                    pathName = p;
                    method = m.toUpperCase();
                    operationDef = op;
                    break;
                }
            }
            if (operationDef) break;
        }

        if (!operationDef) {
            throw new ConfigurationError(`Operation ${operationId} not found in API spec`);
        }

        // Resolve Server URL
        let baseUrl = (openApiSpec.servers && openApiSpec.servers[0]?.url) || "";
        if (!baseUrl) throw new ConfigurationError("No server URL found in OpenAPI spec");

        // Resolve Parameters
        const params = config.parameters || {};
        const queryParams: Record<string, string> = {};
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        let body: any = null;
        let finalPath = pathName;

        // Separate body from other parameters if explicitly named "body" or "requestBody"
        if (params.body) {
            body = params.body;
            delete params.body;
        } else if (params.requestBody) {
            body = params.requestBody;
            delete params.requestBody;
        }

        for (const [key, value] of Object.entries(params)) {
            // Basic replacement for path parameters {param}
            if (finalPath.includes(`{${key}}`)) {
                finalPath = finalPath.replace(`{${key}}`, String(value));
            } else {
                // Default to query param for now, unless we want to be smarter about schema introspection
                // Introspection would be better but requires parsing the parameters list from operationDef
                queryParams[key] = String(value);
            }
        }

        // Handle Authentication — introspect securitySchemes from spec
        if (config.credentialId) {
            const [credential] = await db.select().from(credentials).where(eq(credentials.id, config.credentialId)).limit(1);
            if (credential && credential.envVarName) {
                const secret = (await resolveCredentialSecret(credential));
                if (secret) {
                    applyOpenApiAuth({
                        headers,
                        queryParams,
                        secret,
                        credentialType: credential.type,
                        securitySchemes: openApiSpec.components?.securitySchemes ?? openApiSpec.securityDefinitions ?? {},
                        operationSecurity: operationDef.security ?? openApiSpec.security ?? [],
                    });
                } else {
                    console.warn(`[OpenAPI] Credential secret not found for env var: ${credential.envVarName}`);
                }
            }
        }

        // Construct URL
        const url = new URL(finalPath, baseUrl);
        for (const [k, v] of Object.entries(queryParams)) {
            url.searchParams.append(k, v);
        }

        console.log(`[OpenAPI] Executing ${method} ${url.toString()}`);

        const response = await fetch(url.toString(), {
            method: method,
            headers: headers,
            body: body ? JSON.stringify(body) : undefined,
        });

        const responseText = await response.text();

        if (!response.ok) {
            throw new JobExecutionError(job.id, `API call failed: ${response.status} ${response.statusText}`, {
                status: response.status,
                response: responseText
            });
        }

        let output = responseText;
        try {
            // Try to parse JSON output if possible
            output = JSON.parse(responseText);
        } catch {
            // ignore
        }

        return {
            success: true,
            output: output,
            status: "success"
        };
    }
}


