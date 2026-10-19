import { db } from "./server/db.js";
import { users } from "./shared/schema/index.js";

async function queryUsers() {
  const allUsers = await db.select().from(users);
  console.log("Users in DB:");
  allUsers.forEach(u => {
    console.log(`- ID: ${u.id}, Username: ${u.username}, Email: ${u.email}`);
  });
  process.exit(0);
}

queryUsers().catch(err => {
  console.error(err);
  process.exit(1);
});
