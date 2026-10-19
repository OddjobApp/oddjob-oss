import { NextRequest, NextResponse } from 'next/server';
import { getAuditService, AuditFilter, extractAuditInfo } from '@/lib/audit';

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

    const { searchParams } = new URL(request.url);
    const filter: AuditFilter = {
      user_id: searchParams.get('user_id') || undefined,
      action: searchParams.get('action') || undefined,
      entity_type: searchParams.get('entity_type') || undefined,
      entity_id: searchParams.get('entity_id') || undefined,
      start_date: searchParams.get('start_date') || undefined,
      end_date: searchParams.get('end_date') || undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : undefined,
    };

    const auditService = getAuditService();
    const logs = await auditService.getLogs(filter);

    return NextResponse.json({
      success: true,
      data: logs,
      count: logs.length
    });
    
  } catch (error) {
    logError('audit-logs-get', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: 'No authentication token provided' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const auditInfo = extractAuditInfo(request);

    const auditService = getAuditService();
    const logId = await auditService.createLog({
      user_id: auditInfo.userId,
      ...body,
      ip_address: auditInfo.ipAddress,
      user_agent: auditInfo.userAgent,
    });

    return NextResponse.json({
      success: true,
      logId,
      message: 'Audit log created successfully'
    });
    
  } catch (error) {
    logError('audit-log-create', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
