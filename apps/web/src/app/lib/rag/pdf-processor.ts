import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { generateBatchEmbeddings } from "../openai/client";
import { insertDocument, checkDocumentExists } from "../supabase/client";
import crypto from "crypto";

/**
 * Extract text from PDF buffer using LangChain PDFLoader
 */
export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  try {
    // Create a Blob from the buffer for PDFLoader
    const uint8Array = new Uint8Array(buffer);
    const blob = new Blob([uint8Array], { type: "application/pdf" });
    const loader = new PDFLoader(blob);
    const docs = await loader.load();

    // Combine all page contents
    const text = docs.map((doc) => doc.pageContent).join("\n\n");
    return text;
  } catch (error) {
    console.error("PDF extraction error:", error);
    throw new Error("Failed to extract text from PDF");
  }
}

/**
 * Split text into chunks for embedding using LangChain's RecursiveCharacterTextSplitter
 * This is smarter than simple sentence-based chunking
 */
export async function chunkText(
  text: string,
  chunkSize: number = 500,
  chunkOverlap: number = 50
): Promise<string[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
  });
  const chunks = await splitter.splitText(text);
  return chunks;
}

/**
 * Process text and store in vector database
 */
export async function processText(
  text: string,
  metadata: Record<string, unknown> = {}
): Promise<{ success: boolean; chunksProcessed: number }> {
  if (!text || text.trim().length === 0) {
    throw new Error("No text to process");
  }
  const source_hash = crypto.createHash("sha256").update(text).digest("hex");
  const exists = await checkDocumentExists(source_hash);
  if (exists) {
    throw new Error("DUPLICATE_DOCUMENT");
  }
  const chunks = await chunkText(text);
  console.log(`[Document Processing] Extracted ${chunks.length} chunks`);

  const embeddings = await generateBatchEmbeddings(chunks);
  const insertPromises = chunks.map((chunk, index) =>
    insertDocument(chunk, embeddings[index], {
      ...metadata,
      source_hash,
      chunkIndex: index,
      totalChunks: chunks.length,
    })
  );
  await Promise.all(insertPromises);
  console.log(
    `[Document Processing] Stored ${chunks.length} chunks in database`
  );
  return {
    success: true,
    chunksProcessed: chunks.length,
  };
}

/**
 * Process PDF and store in vector database
 */
export async function processPDFDocument(
  buffer: Buffer,
  metadata: Record<string, unknown> = {}
): Promise<{ success: boolean; chunksProcessed: number }> {
  try {
    const text = await extractTextFromPDF(buffer);
    return processText(text, metadata);
  } catch (error) {
    console.error("PDF processing error:", error);
    throw error;
  }
}
