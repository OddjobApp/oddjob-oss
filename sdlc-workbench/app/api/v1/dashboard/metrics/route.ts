import { NextRequest, NextResponse } from 'next/server';
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

    const db = getDatabase();
    const client = await db.getClient();
    
    try {
      // Get total purchase requests (from audit logs for procurement requests)
      const purchaseRequests = await client.query(
        "SELECT COUNT(*) as count FROM audit_logs WHERE action = 'procurement.request_created'"
      );
      
      // Get pending approvals (from audit logs)
      const pendingApprovals = await client.query(
        "SELECT COUNT(*) as count FROM audit_logs WHERE action = 'procurement.approval_needed' AND timestamp > NOW() - INTERVAL '30 days'"
      );
      
      // Get active vendors (from users with vendor role or vendor table)
      const activeVendors = await client.query(
        "SELECT COUNT(*) as count FROM users WHERE role = 'vendor' AND created_at > NOW() - INTERVAL '90 days'"
      );
      
      // Get monthly spend (sum from procurement data or audit logs)
      const monthlySpend = await client.query(
        "SELECT COALESCE(SUM(CAST(new_values->>'estimated_cost' AS NUMERIC)), 0) as total FROM audit_logs WHERE action = 'procurement.request_created' AND timestamp > NOW() - INTERVAL '30 days'"
      );
      
      // Get on-time delivery rate (from audit logs or performance data)
      const onTimeDelivery = await client.query(
        "SELECT COALESCE(AVG(CAST(new_values->>'on_time_delivery' AS NUMERIC)), 94) as rate FROM audit_logs WHERE action = 'procurement.order_delivered' AND timestamp > NOW() - INTERVAL '90 days'"
      );
      
      // Get compliance rate (from audit logs or compliance data)
      const complianceRate = await client.query(
        "SELECT COALESCE(AVG(CAST(new_values->>'compliance_score' AS NUMERIC)), 92) as rate FROM audit_logs WHERE action = 'vendor.compliance_check' AND timestamp > NOW() - INTERVAL '90 days'"
      );

      const metrics = {
        totalPurchaseRequests: parseInt(purchaseRequests.rows[0].count) || 0,
        pendingApprovals: parseInt(pendingApprovals.rows[0].count) || 0,
        activeVendors: parseInt(activeVendors.rows[0].count) || 0,
        monthlySpend: parseFloat(monthlySpend.rows[0].total) || 0,
        onTimeDeliveryRate: Math.round(parseFloat(onTimeDelivery.rows[0].rate) || 94),
        complianceRate: Math.round(parseFloat(complianceRate.rows[0].rate) || 92),
      };

      return NextResponse.json({
        success: true,
        data: metrics
      });
    } finally {
      client.release();
    }
    
  } catch (error) {
    logError('dashboard-metrics-get', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
