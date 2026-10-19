import { NextRequest, NextResponse } from 'next/server';
import { userUpdateSchema } from '@/lib/validation';
import { getDatabase } from '@/lib/db';

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

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: 'No authentication token provided' },
        { status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    
    // Get user from session token
    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      const session = await client.query('SELECT * FROM user_sessions WHERE token = $1 AND expires_at > NOW()', [token]);
      if (session.rows.length === 0) {
        return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
      }
      const user = await client.query('SELECT user_id, email, name, department, role, permissions, created_at, last_login FROM users WHERE user_id = $1', [session.rows[0].user_id]);
      
      return NextResponse.json({
        success: true,
        data: user.rows[0]
      });
    } finally {
      client.release();
    }
    
  } catch (error) {
    logError('user-profile-get', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: 'No authentication token provided' },
        { status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const body = await request.json();
    
    // Validate with Zod schema
    const validationResult = userUpdateSchema.safeParse(body);
    if (!validationResult.success) {
      logError('user-profile-update-validation', validationResult.error, { body });
      return NextResponse.json(
        { error: 'Validation failed', details: validationResult.error.errors },
        { status: 400 }
      );
    }
    
    const validatedData = validationResult.data;

    // Update user profile
    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      const session = await client.query('SELECT * FROM user_sessions WHERE token = $1 AND expires_at > NOW()', [token]);
      if (session.rows.length === 0) {
        return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
      }
      const updatedUser = await client.query(
        'UPDATE users SET name = COALESCE($1, name), department = COALESCE($2, department), role = COALESCE($3, role), permissions = COALESCE($4, permissions), updated_at = NOW() WHERE user_id = $5 RETURNING user_id, email, name, department, role, permissions, updated_at',
        [validatedData.name, validatedData.department, validatedData.role, validatedData.permissions, session.rows[0].user_id]
      );

      return NextResponse.json({
        success: true,
        message: 'Profile updated successfully',
        data: updatedUser.rows[0]
      });
    } finally {
      client.release();
    }
    
  } catch (error) {
    logError('user-profile-update', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
