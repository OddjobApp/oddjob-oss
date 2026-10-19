import { NextRequest, NextResponse } from 'next/server';
import { userRegistrationSchema } from '@/lib/validation';
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
  const userId = `USER-${Date.now()}`;
  
  try {
    const body = await request.json();
    
    // Validate with Zod schema
    const validationResult = userRegistrationSchema.safeParse(body);
    if (!validationResult.success) {
      logError('user-registration-validation', validationResult.error, { userId, body });
      return NextResponse.json(
        { error: 'Validation failed', details: validationResult.error.errors },
        { status: 400 }
      );
    }
    
    const validatedData = validationResult.data;

    // Check if user already exists
    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      const existingUser = await client.query('SELECT * FROM users WHERE email = $1', [validatedData.email]);
      if (existingUser.rows.length > 0) {
        return NextResponse.json(
          { error: 'User with this email already exists' },
          { status: 409 }
        );
      }

      // Hash password
      const passwordHash = crypto.createHash('sha256').update(validatedData.password).digest('hex');

      // Create user
      const newUser = await client.query(
        `INSERT INTO users (user_id, email, password_hash, name, department, role, permissions, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING user_id, email, name, department, role, created_at`,
        [userId, validatedData.email, passwordHash, validatedData.name, validatedData.department, 'user', ['read'], new Date()]
      );

      return NextResponse.json({
        success: true,
        userId,
        message: 'User registered successfully',
        data: newUser.rows[0]
      });
    } finally {
      client.release();
    }
    
  } catch (error) {
    logError('user-registration-processing', error, { userId });
    return NextResponse.json(
      { error: 'Internal server error', userId },
      { status: 500 }
    );
  }
}
