import { db } from '../database_service.js';
import { users } from '../../shared/schema/index.js';
import { eq } from 'drizzle-orm';

async function check() {
  try {
    const [admin] = await db.select().from(users).where(eq(users.username, 'admin'));
    console.log(`\n--- Admin User ---`);
    if (admin) {
      console.log(`Username: ${admin.username}`);
      console.log(`Email: ${admin.email}`);
      console.log(`ID: ${admin.id}`);
    } else {
      console.log("Admin user not found.");
    }
  } catch (err) {
    console.error('Check failed:', err);
  }
  process.exit(0);
}

check();

