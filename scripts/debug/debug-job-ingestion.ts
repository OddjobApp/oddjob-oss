import pg from 'pg';
const { Pool } = pg;
import "dotenv/config";

const DB_URL = process.env.DATABASE_URL;

// --- INLINED UTILS (Simplified) ---
function flattenObject(data: any, prefix = ''): Record<string, any> {
    const result: Record<string, any> = {};
    for (const key in data) {
        const value = data[key];
        const newKey = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)) {
            Object.assign(result, flattenObject(value, newKey));
        } else {
            result[newKey] = value;
        }
    }
    return result;
}

async function debugIngestion() {
    console.log("🐞 Debugging Job Ingestion Logic (Standalone) -> Job 29");

    const pool = new Pool({ connectionString: DB_URL });
    const client = await pool.connect();

    try {
        // 1. Fetch Job & Dataset
        const jobRes = await client.query('SELECT * FROM jobs WHERE id = 29');
        if (jobRes.rows.length === 0) throw new Error("Job 29 not found");
        const job = jobRes.rows[0];

        const datasetId = job.config.outputDatasetId || job.output_dataset_id; // Check both legacy/new locations
        console.log(`Job 29 Config Output Dataset ID: ${datasetId}`);

        if (!datasetId) throw new Error("No output dataset ID found on job!");

        const dsRes = await client.query('SELECT * FROM datasets WHERE id = $1', [datasetId]);
        if (dsRes.rows.length === 0) throw new Error(`Dataset ${datasetId} not found`);
        const dataset = dsRes.rows[0];

        // 2. Resolve Settings
        let settings = job.output_storage_settings || {
            storeOnStatus: 'success',
            requireNonEmpty: true
        };

        console.log("Initial Job Settings:", JSON.stringify(settings, null, 2));

        if (!settings.schemaMapping) {
            console.log("⚠️ No schemaMapping in job settings. Inheriting from Dataset...");
            settings.schemaMapping = dataset.schema_mapping; // Note snake_case from raw query
        }

        console.log("Effective Schema Mapping:", JSON.stringify(settings.schemaMapping, null, 2));

        // 3. Simulate Data

        const simulatedRow: Record<string, any> = { id: 1, name: 'North America', country: 'USA' };

        console.log("\n--- Simulating Logic on Single Row ---");
        console.log("Row Input:", JSON.stringify(simulatedRow));

        // 4. Check against Schema Mapping
        const mapping = settings.schemaMapping;
        let finalData: Record<string, any> = {};

        if (mapping && mapping.columns && mapping.columns.length > 0) {
            console.log("✅ Columns defined. Extracting...");
            mapping.columns.forEach((col: any) => {
                const val = simulatedRow[col.jsonPath];
                console.log(`   Extracting '${col.datasetKey}' from '${col.jsonPath}': ${val} (Type: ${typeof val})`);
                if (val !== undefined) {
                    finalData[col.datasetKey] = val;
                }
            });
        } else {
            console.log("ℹ️ No specific columns defined. Auto-flattening.");
            finalData = flattenObject(simulatedRow);
        }

        console.log("\nFinal Data Object to Insert:", JSON.stringify(finalData, null, 2));

        if (Object.keys(finalData).length === 0) {
            console.error("❌ ERROR: Final data object is empty! Ingestion will likely drop this row.");
        } else {
            console.log("✅ Success: Data object is populated.");
        }

    } finally {
        client.release();
        await pool.end();
    }
}


debugIngestion().catch((err) => console.error("Error:", err instanceof Error ? err.message : String(err)));

