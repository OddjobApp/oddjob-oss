#!/usr/bin/env ts-node
import "dotenv/config";
import { Command } from "commander";
import { db } from "../../server/db/index.js";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";

const program = new Command();

program
    .name("users")
    .description("A CLI for managing users")
    .version("1.0.0");

program
    .command("create <username> <password>")
    .description("Create a new user")
    .option("-e, --email <email>", "The user's email address")
    .option("-f, --first-name <firstName>", "The user's first name")
    .option("-l, --last-name <lastName>", "The user's last name")
    .action(async (username, password, options) => {
        const scryptAsync = promisify(scrypt);

        async function hashPassword(password: string): Promise<string> {
            const salt = randomBytes(16).toString("hex");
            const buf = (await scryptAsync(password, salt, 64)) as Buffer;
            return `${buf.toString("hex")}.${salt}`;
        }

        try {
            console.log(`Creating user: ${username}...`);

            const hashedPassword = await hashPassword(password);

            const [newUser] = await db.insert(users).values({
                username,
                password: hashedPassword,
                email: options.email || `${username}@example.com`,
                firstName: options.firstName || "User",
                lastName: options.lastName || "Name",
            }).returning();

            console.log("✅ User created successfully!");
            console.log(`   Username: ${newUser.username}`);
            console.log(`   Email: ${newUser.email}`);
            console.log(`   ID: ${newUser.id}`);
            console.log("\nYou can now login with:");
            console.log(`   Username: ${username}`);
            console.log(`   Password: ${password}`);

            process.exit(0);
        } catch (error: any) {
            if (error.code === "23505") {
                console.error(`❌ Error: User "${username}" already exists`);
            } else {
                console.error("❌ Error creating user:", error.message);
            }
            process.exit(1);
        }
    });

program
    .command("list")
    .description("List all users")
    .action(async () => {
        try {
            console.log("Listing all users...");

            const allUsers = await db.select().from(users);

            if (allUsers.length === 0) {
                console.log("No users found.");
            } else {
                console.table(allUsers.map(u => ({
                    id: u.id,
                    username: u.username,
                    email: u.email,
                    firstName: u.firstName,
                    lastName: u.lastName,
                })));
            }

            process.exit(0);
        } catch (error: any) {
            console.error("❌ Error listing users:", error.message);
            process.exit(1);
        }
    });

program
    .command("reset-password <username> <newPassword>")
    .description("Reset a user's password")
    .action(async (username, newPassword) => {
        const scryptAsync = promisify(scrypt);

        async function hashPassword(password: string): Promise<string> {
            const salt = randomBytes(16).toString("hex");
            const buf = (await scryptAsync(password, salt, 64)) as Buffer;
            return `${buf.toString("hex")}.${salt}`;
        }

        try {
            console.log(`Resetting password for user: ${username}...`);

            const hashedPassword = await hashPassword(newPassword);

            const [user] = await db.select().from(users).where(eq(users.username, username));

            if (!user) {
                console.error(`User '${username}' not found!`);
                process.exit(1);
            }

            console.log(`Found user '${username}' (ID: ${user.id}). Updating password...`);

            await db.update(users)
                .set({ password: hashedPassword })
                .where(eq(users.id, user.id));

            console.log("Password updated successfully.");
            console.log(`New credentials: ${username} / ${newPassword}`);
            console.log(`Email: ${user.email}`);

            process.exit(0);
        } catch (error: any) {
            console.error("❌ Error resetting password:", error.message);
            process.exit(1);
        }
    });

program.parse();
