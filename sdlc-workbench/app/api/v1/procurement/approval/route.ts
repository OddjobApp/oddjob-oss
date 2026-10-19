import { NextRequest, NextResponse } from 'next/server';
import { procurementApprovalSchema } from '@/lib/validation';
import { executeBlueprintMission } from '@/lib/blueprint-execution';

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

// Simple rate limiting (in production, use Redis or similar)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 10; // requests per minute
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute

function checkRateLimit(identifier: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(identifier);
  
  if (!record || now > record.resetTime) {
    rateLimitMap.set(identifier, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (record.count >= RATE_LIMIT) {
    return false;
  }
  
  record.count++;
  return true;
}

export async function POST(request: NextRequest) {
  const approvalId = `PA-${Date.now()}`;
  
  // Rate limiting
  const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (!checkRateLimit(clientIp)) {
    logError('rate-limit-exceeded', null, { approvalId, clientIp });
    return NextResponse.json(
      { error: 'Rate limit exceeded', approvalId },
      { status: 429 }
    );
  }
  
  try {
    const body = await request.json();
    
    // Validate with Zod schema
    const validationResult = procurementApprovalSchema.safeParse(body);
    if (!validationResult.success) {
      logError('procurement-approval-validation', validationResult.error, { approvalId, body });
      return NextResponse.json(
        { error: 'Validation failed', details: validationResult.error.errors },
        { status: 400 }
      );
    }
    
    const validatedData = validationResult.data;

    // Execute blueprint mission
    const blueprintResult = await executeBlueprintMission('procurement-approval', validatedData);
    
    if (!blueprintResult.success) {
      logError('blueprint-execution-failed', blueprintResult.error, { approvalId, blueprintResult });
      return NextResponse.json(
        { error: 'Blueprint execution failed', details: blueprintResult.error, approvalId },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      success: true,
      approvalId,
      executionId: blueprintResult.executionId,
      message: 'Procurement approval submitted successfully',
      data: {
        ...validatedData,
        status: 'Processed',
        submitted_at: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logError('procurement-approval-processing', error, { approvalId });
    return NextResponse.json(
      { error: 'Internal server error', approvalId },
      { status: 500 }
    );
  }
}
