import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        const creds = await pool.query("SELECT id, name, type FROM credentials WHERE type = 'ai_provider' ORDER BY id");
        console.log('AI Provider Credentials:');
        if (creds.rows.length === 0) {
            console.log('  ⚠️  No AI credentials configured');
            console.log('\nTo enable knowledge extraction, you need to configure at least one AI provider.');
        } else {
            creds.rows.forEach((c: any) => console.log('  ✅ ID:', c.id, '| Name:', c.name));
        }

        // Check if API keys are set in environment
        console.log('\nEnvironment Variables:');
        console.log('  OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Not set');
        console.log('  ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? '✅ Set' : '❌ Not set');
        console.log('  GOOGLE_API_KEY:', process.env.GOOGLE_API_KEY ? '✅ Set' : '❌ Not set');
        console.log('  GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? '✅ Set' : '❌ Not set');

    } finally {
        await pool.end();
    }
}

main();
