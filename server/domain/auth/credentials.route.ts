import { Router, type Request, type Response } from "express";
import { requireAuth } from "./core/security.service.js";
import { getUserOrgContext } from "../../utils/auth-context.js";
import { asyncHandler } from "../../middleware/error-handler.js";
import { UnauthorizedError } from "@server/utils/errors.js";
import { credentialsService } from "./core/credentials-service.js";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

const router = Router();

router.get("/", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const creds = await credentialsService.list(orgContext.organizationId, orgContext.isSuperAdmin);
    res.json(creds);
}));

router.post("/", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req.session as any)?.userId;
    if (!userId) throw new UnauthorizedError("Not authenticated");
    const orgContext = await getUserOrgContext(req);

    const cred = await credentialsService.create(req.body, orgContext.organizationId, userId);
    res.json(cred);
}));

// Edit a credential or rotate its secret. The response never carries the secret.
router.patch("/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const cred = await credentialsService.update(parseInt(req.params.id), req.body, orgContext.organizationId, orgContext.isSuperAdmin);
    res.json(cred);
}));

router.delete("/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    await credentialsService.delete(parseInt(req.params.id), orgContext.organizationId, orgContext.isSuperAdmin);
    res.status(204).send();
}));

router.post("/:id/test", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const result = await credentialsService.testConnection(parseInt(req.params.id), orgContext.organizationId, orgContext.isSuperAdmin);
    res.json(result);
}));

router.get("/:id/schema", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const credential = await credentialsService.getById(parseInt(req.params.id), orgContext.organizationId, orgContext.isSuperAdmin);
    
    const metadata = credential.metadata as any;
    const engine = metadata.engine || 'postgres';
    const password = (await resolveCredentialSecret(credential));
    if (!password) {
        return res.status(500).send("Database password not configured in env");
    }

    let tables: { name: string, columns: string[] }[] = [];
    let ddl = '';

    if (engine === 'postgres') {
        const pg = await import('pg');
        const client = new pg.default.Client({
            host: metadata.host,
            port: metadata.port,
            database: metadata.database,
            user: metadata.user,
            password: password,
            ssl: metadata.ssl ?? false
        });
        await client.connect();
        try {
            const { SqlExecutor } = await import("../jobs/core/executors/sql-executor.js");
            const executor = new SqlExecutor();
            const rawSchema = await executor.inspectSchema(credential);
            tables = rawSchema.tables.map(t => ({ name: t.name, columns: t.columns ?? [] }));

            const { generatePostgresDdl } = await import("../../utils/schema-ddl-generator.js");
            ddl = await generatePostgresDdl(client);
        } finally {
            await client.end();
        }
    } else if (engine === 'mysql') {
        const mysql = await import('mysql2/promise');
        const connection = await mysql.createConnection({
            host: metadata.host,
            port: metadata.port,
            user: metadata.user,
            password: password,
            database: metadata.database,
            ssl: metadata.ssl ? { rejectUnauthorized: false } : undefined
        });
        try {
            const { SqlExecutor } = await import("../jobs/core/executors/sql-executor.js");
            const executor = new SqlExecutor();
            const rawSchema = await executor.inspectSchema(credential);
            tables = rawSchema.tables.map(t => ({ name: t.name, columns: t.columns ?? [] }));

            const { generateMysqlDdl } = await import("../../utils/schema-ddl-generator.js");
            ddl = await generateMysqlDdl(connection);
        } finally {
            await connection.end();
        }
    }

    res.json({ tables, ddl });
}));

export default router;


