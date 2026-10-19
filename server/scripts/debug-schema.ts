
import * as schema from "@shared/schema/index.js";

for (const [key, value] of Object.entries(schema)) {
  if (key === "missionDeliverables") {
    console.log(`Found missionDeliverables. Key: ${key}`);
    // Unfortunately, Drizzle objects don't easily tell you which file they came from,
    // but we can try to inspect the object.
    const table = value as any;
    if (table[Symbol.for('drizzle:Name')]) {
        console.log(`Table Name: ${table[Symbol.for('drizzle:Name')]}`);
    }
  }
}

