import { NextRequest, NextResponse } from 'next/server';
import { getDocumentService, DocumentFilter, validateFileType, validateFileSize, AllowedFileTypes, FileSizeLimits } from '@/lib/documents';

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
    const filter: DocumentFilter = {
      user_id: searchParams.get('user_id') || undefined,
      entity_type: searchParams.get('entity_type') || undefined,
      entity_id: searchParams.get('entity_id') || undefined,
      mime_type: searchParams.get('mime_type') || undefined,
      is_current: searchParams.get('is_current') === 'true' ? true : searchParams.get('is_current') === 'false' ? false : undefined,
      start_date: searchParams.get('start_date') || undefined,
      end_date: searchParams.get('end_date') || undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : undefined,
    };

    const documentService = getDocumentService();
    const documents = await documentService.getDocuments(filter);

    return NextResponse.json({
      success: true,
      data: documents,
      count: documents.length
    });
    
  } catch (error) {
    logError('documents-get', error);
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

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const user_id = formData.get('user_id') as string;
    const entity_type = formData.get('entity_type') as string;
    const entity_id = formData.get('entity_id') as string;
    const workflow_execution_id = formData.get('workflow_execution_id') as string;
    const workflow_step_id = formData.get('workflow_step_id') as string;

    if (!file || !user_id || !entity_type || !entity_id) {
      return NextResponse.json(
        { error: 'Missing required fields: file, user_id, entity_type, entity_id' },
        { status: 400 }
      );
    }

    // Validate file type
    const allowedTypes = [...AllowedFileTypes.IMAGES, ...AllowedFileTypes.DOCUMENTS, ...AllowedFileTypes.SPREADSHEETS];
    if (!validateFileType(file.type, allowedTypes)) {
      return NextResponse.json(
        { error: 'Invalid file type. Allowed types: ' + allowedTypes.join(', ') },
        { status: 400 }
      );
    }

    // Validate file size
    if (!validateFileSize(file.size, FileSizeLimits.MEDIUM)) {
      return NextResponse.json(
        { error: `File size exceeds maximum limit of ${FileSizeLimits.MEDIUM / (1024 * 1024)}MB` },
        { status: 400 }
      );
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    const documentService = getDocumentService();
    const result = await documentService.uploadDocument({
      user_id,
      entity_type,
      entity_id,
      filename: file.name,
      file_buffer: fileBuffer,
      mime_type: file.type,
      workflow_execution_id: workflow_execution_id || undefined,
      workflow_step_id: workflow_step_id || undefined,
    });

    return NextResponse.json({
      success: true,
      data: result,
      message: 'Document uploaded successfully'
    });
    
  } catch (error) {
    logError('document-upload', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
