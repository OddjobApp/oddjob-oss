/**
 * Script to list all required environment variable names from credentials
 * 
 * Usage: tsx scripts/list-required-secrets.ts
 */

import "dotenv/config";
import { db } from "../server/db/index.js";
import { credentials } from "@shared/schema";

async function listRequiredSecrets() {
  console.log("🔐 Required Environment Variables for Credentials\n");
  console.log("=" .repeat(60));
  
  const allCredentials = await db.select().from(credentials);
  
  if (allCredentials.length === 0) {
    console.log("No credentials found in database.");
    console.log("\nTo create credentials, go to: http://localhost:5000/credentials/new");
    process.exit(0);
  }
  
  console.log(`\nFound ${allCredentials.length} credential(s):\n`);
  
  const envVars = new Set<string>();
  const missing: string[] = [];
  const present: string[] = [];
  
  for (const cred of allCredentials) {
    const envVarName = cred.envVarName;
    envVars.add(envVarName);
    
    const exists = !!process.env[envVarName];
    const status = exists ? "✅" : "❌";
    
    console.log(`${status} ${cred.name} (${cred.type})`);
    console.log(`   Environment Variable: ${envVarName}`);
    if (cred.description) {
      console.log(`   Description: ${cred.description}`);
    }
    console.log("");
    
    if (exists) {
      present.push(envVarName);
    } else {
      missing.push(envVarName);
    }
  }
  
  console.log("=" .repeat(60));
  console.log("\n📋 Summary:\n");
  console.log(`Total credentials: ${allCredentials.length}`);
  console.log(`Environment variables configured: ${present.length}`);
  console.log(`Environment variables missing: ${missing.length}`);
  
  if (missing.length > 0) {
    console.log("\n⚠️  Missing Environment Variables:\n");
    missing.forEach(envVar => {
      console.log(`   ${envVar}`);
    });
    console.log("\n💡 To add these to your .env file:");
    console.log("   1. Open .env file in the project root");
    console.log("   2. Add each variable with its value:");
    missing.forEach(envVar => {
      console.log(`      ${envVar}=your_secret_value_here`);
    });
  }
  
  if (present.length > 0) {
    console.log("\n✅ Configured Environment Variables:\n");
    present.forEach(envVar => {
      console.log(`   ${envVar}`);
    });
  }
  
  console.log("\n" + "=" .repeat(60));
  console.log("\n📝 Example .env file format:\n");
  console.log("DATABASE_URL=postgresql://user:password@localhost:5432/oddjob");
  missing.forEach(envVar => {
    console.log(`${envVar}=your_secret_value`);
  });
  
  process.exit(0);
}

listRequiredSecrets().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

