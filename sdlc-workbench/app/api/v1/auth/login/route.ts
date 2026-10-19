import { NextRequest, NextResponse } from 'next/server';
import { userLoginSchema } from '@/lib/validation';
import { getDatabase } from '@/lib/db';
import crypto from 'crypto';

function logError(context: string, error: unknown, details?: Record<string, any>) {
  const errorDetails = {
    timestamp: new Date().toISOString(),
    context,
    error: error instanceof Error ? {
      message: error.message,
      stack: error.stack,
      name: error.name
    } : String(error),
    ...details
  };
  console.error('[API Error]', JSON.stringify(errorDetails, null, 2));
}

export async function POST(request: NextRequest) {
  const sessionId = `SESSION-${Date.now()}`;
  const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';
  
  try {
    const body = await request.json();
    
    // Validate with Zod schema
    const validationResult = userLoginSchema.safeParse(body);
    if (!validationResult.success) {
      logError('user-login-validation', validationResult.error, { sessionId, body });
      return NextResponse.json(
        { error: 'Validation failed', details: validationResult.error.errors },
        { status: 400 }
      );
    }
    
    const validatedData = validationResult.data;

    // Hash password for comparison
    const passwordHash = crypto.createHash('sha256').update(validatedData.password).digest('hex');

    // Verify user credentials
    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      const user = await client.query('SELECT * FROM users WHERE email = $1', [validatedData.email]);
      if (user.rows.length === 0 || user.rows[0].password_hash !== passwordHash) {
        return NextResponse.json(
          { error: 'Invalid email or password' },
          { status: 401 }
        );
      }

      const userData = user.rows[0];

      // Generate session token
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Create session
      await client.query(
        `INSERT INTO user_sessions (session_id, user_id, token, expires_at, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sessionId, userData.user_id, sessionToken, expiresAt, clientIp, userAgent]
      );

      // Update last login
      await client.query('UPDATE users SET last_login = $1 WHERE user_id = $2', [new Date(), userData.user_id]);

      return NextResponse.json({
        success: true,
        sessionId,
        message: 'Login successful',
        data: {
          token: sessionToken,
          user_id: userData.user_id,
          email: userData.email,
          name: userData.name,
          role: userData.role,
          expires_at: expiresAt.toISOString()
        }
      });
    } finally {
      client.release();
    }
    
  } catch (error) {
    logError('user-login-processing', error, { sessionId });
    return NextResponse.json(
      { error: 'Internal server error', sessionId },
      { status: 500 }
    );
  }
}
