import { NextRequest, NextResponse } from 'next/server';
import { getNotificationService, NotificationFilter } from '@/lib/notifications';

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
    const filter: NotificationFilter = {
      user_id: searchParams.get('user_id') || undefined,
      type: searchParams.get('type') || undefined,
      is_read: searchParams.get('is_read') === 'true' ? true : searchParams.get('is_read') === 'false' ? false : undefined,
      priority: searchParams.get('priority') || undefined,
      start_date: searchParams.get('start_date') || undefined,
      end_date: searchParams.get('end_date') || undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : undefined,
    };

    const notificationService = getNotificationService();
    const notifications = await notificationService.getNotifications(filter);

    return NextResponse.json({
      success: true,
      data: notifications,
      count: notifications.length
    });
    
  } catch (error) {
    logError('notifications-get', error);
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

    const notificationService = getNotificationService();
    const notificationId = await notificationService.createNotification(body);

    return NextResponse.json({
      success: true,
      notificationId,
      message: 'Notification created successfully'
    });
    
  } catch (error) {
    logError('notification-create', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
