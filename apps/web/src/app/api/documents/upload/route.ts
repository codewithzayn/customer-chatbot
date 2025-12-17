import { NextRequest, NextResponse } from 'next/server';
import { processPDFDocument, processText } from '../../../lib/rag/pdf-processor';

export async function POST(req: NextRequest) {
  try {
    // Breakpoint for debugging
    console.log("Starting document upload request");

    // Check Content-Type
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data') && !contentType.includes('application/x-www-form-urlencoded')) {
        return NextResponse.json(
            { error: 'Content-Type must be multipart/form-data or application/x-www-form-urlencoded' },
            { status: 400 }
        );
    }

    // Get file from form data
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file type
    if (file.type !== 'application/pdf' && file.type !== 'text/plain') {
      return NextResponse.json(
        { error: 'Only PDF and Text files are supported' },
        { status: 400 }
      );
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File size exceeds 10MB limit' },
        { status: 400 }
      );
    }

    // Process file based on type
    let result;
    if (file.type === 'application/pdf') {
       // Convert file to buffer for PDF processing
       const arrayBuffer = await file.arrayBuffer();
       const buffer = Buffer.from(arrayBuffer);
       
       result = await processPDFDocument(buffer, {
        filename: file.name,
        uploadedAt: new Date().toISOString(),
        type: 'pdf'
      });
    } else {
      // Text processing
      const text = await file.text();
      result = await processText(text, {
        filename: file.name,
        uploadedAt: new Date().toISOString(),
        type: 'text'
      });
    }

    return NextResponse.json({
      success: true,
      message: `Successfully processed ${result.chunksProcessed} chunks from document`,
      chunksProcessed: result.chunksProcessed,
    }, { status: 201 });

  } catch (error: unknown) {
    console.error('Document upload error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to process document';
    
    if (errorMessage === 'DUPLICATE_DOCUMENT') {
      return NextResponse.json(
        { error: 'Document with this filename already exists' },
        { status: 409 }
      );
    }
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
