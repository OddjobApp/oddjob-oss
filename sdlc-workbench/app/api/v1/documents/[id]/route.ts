import { NextRequest, NextResponse } from 'next/server';
import { getDocumentService } from '@/lib/documents';

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

export async function GET(
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

    const documentId = params.id;
    const documentService = getDocumentService();
    const document = await documentService.getDocumentById(documentId);

    if (!document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    const fileBuffer = await documentService.downloadDocument(documentId);
    
    if (!fileBuffer) {
      return NextResponse.json(
        { error: 'Failed to download document' },
        { status: 500 }
      );
    }

    return new NextResponse(fileBuffer as any, {
      headers: {
        'Content-Type': document.mime_type,
        'Content-Disposition': `attachment; filename="${document.filename}"`,
      },
    });
    
  } catch (error) {
    logError('document-download', error);
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

    const documentId = params.id;
    const documentService = getDocumentService();
    const success = await documentService.deleteDocument(documentId);

    if (!success) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Document deleted successfully'
    });
    
  } catch (error) {
    logError('document-delete', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
