/**
 * First-run setup: bring the schema up to date, then create the first
 * organization and its super-admin if the database has none.
 *
 *   npm run setup                 # migrate + create the first admin (prompts for details)
 *   npm run setup -- --dry-run    # report what would happen; connects read-only
 *   npm run setup -- --skip-migrate
 *   node dist/setup.js            # the same, inside the production image
 *
 * Non-interactive (CI, containers): set ODDJOB_ADMIN_EMAIL, ODDJOB_ADMIN_PASSWORD,
 * and optionally ODDJOB_ADMIN_USERNAME and ODDJOB_ORG_NAME.
 *
 * Safe to run on a database that already has data: it never deletes, truncates
 * or updates existing rows. Migrations apply only what is pending, in one
 * transaction, and the admin step does nothing once any super-admin exists.
 */
import dotenv from "dotenv";
dotenv.config();

import readline from "node:readline";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema/index.js";
import {
    bootstrapFirstAdmin,
    defaultUsernameFor,
    hasSuperAdmin,
    MIN_ADMIN_PASSWORD_LENGTH,
    validateFirstAdminInput,
    type FirstAdminInput,
} from "./domain/auth/core/first-admin.service.js";
import { describeMigrationError, pendingMigrations, runMigrations } from "./migration-runner.js";

function describeTarget(url: string): string {
    try {
        const u = new URL(url);
        return `${u.hostname}:${u.port || 5432}${u.pathname}`;
    } catch {
        return "(unparseable DATABASE_URL)";
    }
}

/** A super-admin check that treats "no tables yet" as "no super-admin". */
async function superAdminExists(pool: Pool): Promise<boolean> {
    try {
        return await hasSuperAdmin(drizzle(pool, { schema }));
    } catch (err: any) {
        if ((err?.code ?? err?.cause?.code) === "42P01") return false; // undefined_table
        throw err;
    }
}

function ask(rl: readline.Interface, question: string, hidden = false): Promise<string> {
    return new Promise((resolve) => {
        const output = (rl as any).output as NodeJS.WritableStream;
        if (hidden) {
            output.write(question);
            (rl as any)._writeToOutput = () => {};
        }
        rl.question(hidden ? "" : question, (answer) => {
            if (hidden) {
                (rl as any)._writeToOutput = (s: string) => output.write(s);
                output.write("\n");
            }
            resolve(answer.trim());
        });
    });
}

async function gatherInput(): Promise<FirstAdminInput> {
    const fromEnv: Partial<FirstAdminInput> = {
        email: process.env.ODDJOB_ADMIN_EMAIL?.trim(),
        password: process.env.ODDJOB_ADMIN_PASSWORD,
        username: process.env.ODDJOB_ADMIN_USERNAME?.trim(),
        organizationName: process.env.ODDJOB_ORG_NAME?.trim(),
    };

    if (!process.stdin.isTTY) {
        const input = {
            email: fromEnv.email ?? "",
            password: fromEnv.password ?? "",
            username: fromEnv.username || defaultUsernameFor(fromEnv.email ?? ""),
            organizationName: fromEnv.organizationName || "My Organization",
        };
        const problems = validateFirstAdminInput(input);
        if (problems.length) {
            throw new Error(
                `No terminal to prompt on, and ${problems.join("; ")}. ` +
                "Set ODDJOB_ADMIN_EMAIL and ODDJOB_ADMIN_PASSWORD (and optionally ODDJOB_ADMIN_USERNAME, ODDJOB_ORG_NAME).",
            );
        }
        return input;
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        console.log("\nCreate the first organization and its super-admin.\n");
        const organizationName = fromEnv.organizationName || (await ask(rl, "Organization name [My Organization]: ")) || "My Organization";
        const email = fromEnv.email || (await ask(rl, "Admin email: "));
        const suggested = defaultUsernameFor(email);
        const username = fromEnv.username || (await ask(rl, `Admin username [${suggested}]: `)) || suggested;
        let password = fromEnv.password ?? "";
        while (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
            password = await ask(rl, `Admin password (${MIN_ADMIN_PASSWORD_LENGTH}+ characters): `, true);
            if (password.length < MIN_ADMIN_PASSWORD_LENGTH) continue;
            const again = await ask(rl, "Repeat password: ", true);
            if (again !== password) {
                console.log("Passwords did not match.");
                password = "";
            }
        }
        return { email, password, username, organizationName };
    } finally {
        rl.close();
    }
}

async function main() {
    const args = new Set(process.argv.slice(2));
    const dryRun = args.has("--dry-run");
    const skipMigrate = args.has("--skip-migrate");

    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    console.log(`Database: ${describeTarget(url)}${dryRun ? "  (dry run, read-only connection)" : ""}`);

    // The dry run cannot write even by mistake: Postgres rejects writes on it.
    const pool = new Pool({
        connectionString: url,
        max: 1,
        ...(dryRun ? { options: "-c default_transaction_read_only=on" } : {}),
    });

    try {
        const pending = await pendingMigrations(pool);
        if (dryRun) {
            console.log(pending.length ? `${pending.length} pending migration(s) would be applied:` : "Schema is up to date; no migrations would run.");
            for (const tag of pending.slice(0, 15)) console.log(`  ${tag}`);
            if (pending.length > 15) console.log(`  … and ${pending.length - 15} more`);
            const exists = pending.length === 0 && (await superAdminExists(pool));
            console.log(exists
                ? "A super-admin exists; no account would be created."
                : "No super-admin yet; setup would create the first organization and super-admin.");
            console.log("Nothing was changed.");
            return;
        }

        if (!skipMigrate) {
            if (pending.length) {
                console.log(`⏳ Applying ${pending.length} pending migration(s)...`);
                try {
                    await runMigrations(url);
                } catch (err) {
                    for (const line of describeMigrationError(err)) console.error(line);
                    process.exitCode = 1;
                    return;
                }
                console.log("✅ Migrations applied.");
            } else {
                console.log("✅ Schema is up to date.");
            }
        }

        if (await superAdminExists(pool)) {
            console.log("✅ A super-admin already exists; no account created. Setup is complete.");
            return;
        }

        const input = await gatherInput();
        const result = await bootstrapFirstAdmin(drizzle(pool, { schema }), input);
        if (!result.created) {
            console.log("✅ A super-admin was created concurrently; nothing to do.");
            return;
        }
        console.log(`\n✅ Created organization "${input.organizationName.trim()}" (id ${result.organizationId}) and super-admin ${input.email.trim().toLowerCase()}.`);
        console.log("   Start the server (npm run dev, or the container) and sign in with that email and password.");
    } finally {
        await pool.end();
    }
}

main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((err) => {
        console.error(`❌ ${err instanceof Error ? err.message : err}`);
        process.exit(1);
    });
