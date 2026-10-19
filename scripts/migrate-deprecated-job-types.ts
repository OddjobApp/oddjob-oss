import { db } from '../server/database_service.js';
import { jobs } from '@shared/schema/index.js';
import { eq } from 'drizzle-orm';

async function migrateDeprecatedJobTypes() {
  const deprecatedJobs = await db.select().from(jobs)
    .where(eq(jobs.type, 'api'));
  
  console.log(`Found ${deprecatedJobs.length} deprecated jobs`);
  
  for (const job of deprecatedJobs) {
    const config = typeof job.config === 'string' 
      ? JSON.parse(job.config) 
      : job.config;
    
    // Migrate to curl type
    await db.update(jobs)
      .set({
        type: 'curl',
        config: {
          ...config,
          // Ensure curl-specific fields
          url: config.url,
          method: config.method || 'GET',
        },
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, job.id));
    
    console.log(`Migrated job ${job.id}: ${job.name}`);
  }
  
  console.log('Migration complete');
}

migrateDeprecatedJobTypes().catch(console.error);
