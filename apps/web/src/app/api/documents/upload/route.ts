import { NextRequest, NextResponse } from "next/server";
import { processPDFDocument } from "../../../lib/rag/pdf-processor";

export async function POST(req: NextRequest) {
  try {
    // Check Content-Type
    const contentType = req.headers.get("content-type") || "";
    if (
      !contentType.includes("multipart/form-data") &&
      !contentType.includes("application/x-www-form-urlencoded")
    ) {
      return NextResponse.json(
        {
          error:
            "Content-Type must be multipart/form-data or application/x-www-form-urlencoded",
        },
        { status: 400 }
      );
    }

    // Get all files from form data (supports single or multiple uploads)
    const formData = await req.formData();
    const files = formData.getAll("file") as File[];

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    // Process all files in parallel for better performance
    const maxSize = 10 * 1024 * 1024; // 10MB

    const processingPromises = files.map(async (file) => {
      try {
        // Validate file type - ONLY PDFs allowed
        if (file.type !== "application/pdf") {
          return {
            filename: file.name,
            success: false,
            error: "Only PDF files are supported",
          };
        }

        // Validate file size
        if (file.size > maxSize) {
          return {
            filename: file.name,
            success: false,
            error: "File size exceeds 10MB limit",
          };
        }

        // Process PDF
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const result = await processPDFDocument(buffer, {
          filename: file.name,
          uploadedAt: new Date().toISOString(),
          type: "pdf",
        });

        return {
          filename: file.name,
          success: true,
          chunksProcessed: result.chunksProcessed,
        };
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Failed to process PDF";

        return {
          filename: file.name,
          success: false,
          error:
            errorMessage === "DUPLICATE_DOCUMENT"
              ? "This PDF content has already been uploaded"
              : errorMessage,
        };
      }
    });

    // Wait for all files to process in parallel
    const results = await Promise.all(processingPromises);

    const successCount = results.filter((r) => r.success).length;
    const totalChunks = results.reduce(
      (sum, r) => sum + (r.chunksProcessed || 0),
      0
    );

    return NextResponse.json(
      {
        success: successCount > 0,
        message: `Processed ${successCount} of ${files.length} PDF(s), ${totalChunks} total chunks`,
        results,
        summary: {
          total: files.length,
          successful: successCount,
          failed: files.length - successCount,
          totalChunks,
        },
      },
      { status: successCount > 0 ? 201 : 400 }
    );
  } catch (error: unknown) {
    console.error("Document upload error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to process documents";

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
