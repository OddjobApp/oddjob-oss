import { Router, type Request, type Response } from "express";
import { requireAuth } from "../domain/auth/core/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { pool } from "../database_service.js";
import { generatePostgresDdl, generateDatasetsDdl } from "../utils/schema-ddl-generator.js";
import { credentialsService } from "../domain/auth/core/credentials-service.js";
import pg from 'pg';
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

const router = Router();

router.get("/schema", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const source = req.query.source as string;

    if (source === 'oddjob') {
        const client = await pool.connect();
        try {
            const ddl = await generatePostgresDdl(client);
            return res.json({ ddl });
        } finally {
            client.release();
        }
    }

    if (source === 'datasets') {
        if (orgContext.organizationId == null) {
            return res.status(400).send("organization context required");
        }
        const ddl = await generateDatasetsDdl(orgContext.organizationId);
        return res.json({ ddl });
    }

    if (source === 'credential') {
        const credentialIdStr = req.query.credentialId as string;
        if (!credentialIdStr) {
            return res.status(400).send("credentialId query parameter required");
        }
        const credentialId = parseInt(credentialIdStr);
        const credential = await credentialsService.getById(credentialId, orgContext.organizationId, orgContext.isSuperAdmin);
        
        const metadata = credential.metadata as any;
        const engine = metadata.engine || 'postgres';
        const password = (await resolveCredentialSecret(credential));
        if (!password) {
            return res.status(500).send("Database password not configured in env");
        }

        let ddl = '';
        if (engine === 'postgres') {
            const client = new pg.Client({
                host: metadata.host,
                port: metadata.port,
                database: metadata.database,
                user: metadata.user,
                password: password,
                ssl: metadata.ssl ?? false
            });
            await client.connect();
            try {
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
                const { generateMysqlDdl } = await import('../utils/schema-ddl-generator.js');
                ddl = await generateMysqlDdl(connection);
            } finally {
                await connection.end();
            }
        }
        return res.json({ ddl });
    }

    return res.status(400).send("Invalid source parameter");
}));

export default router;
