import "dotenv/config";
import { db } from "./server/db.js";
console.log("DB instance type:", typeof db);
console.log("Testing connection...");
import { checkDatabaseConnection } from "./server/db.js";
const result = await checkDatabaseConnection();
console.log("Connection result:", result);
process.exit(0);
