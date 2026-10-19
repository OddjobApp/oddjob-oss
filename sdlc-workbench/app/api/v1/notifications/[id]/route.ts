import { NextRequest, NextResponse } from 'next/server';
import { getNotificationService } from '@/lib/notifications';

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

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: 'No authentication token provided' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const notificationId = params.id;

    const notificationService = getNotificationService();

    if (body.action === 'mark_read') {
      await notificationService.markAsRead(notificationId);
      return NextResponse.json({
        success: true,
        message: 'Notification marked as read'
      });
    }

    return NextResponse.json(
      { error: 'Invalid action' },
      { status: 400 }
    );
    
  } catch (error) {
    logError('notification-update', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: 'No authentication token provided' },
        { status: 401 }
      );
    }

    const notificationId = params.id;
    const notificationService = getNotificationService();
    await notificationService.deleteNotification(notificationId);

    return NextResponse.json({
      success: true,
      message: 'Notification deleted successfully'
    });
    
  } catch (error) {
    logError('notification-delete', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
