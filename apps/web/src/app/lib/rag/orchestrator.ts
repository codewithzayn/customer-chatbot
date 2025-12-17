import { generateEmbedding } from "../openai/client";
import { searchSimilarDocuments } from "../supabase/client";
import {
  storeInSemanticCache,
} from "../redis/semantic-cache";

/**
 * RAG Orchestrator - Coordinates semantic caching, vector search, and LLM generation
 */

export interface RAGContext {
  query: string;
  relevantDocs: Array<{
    content: string;
    similarity: number;
  }>;
  cacheHit: boolean;
}

/**
 * Retrieve relevant context for a query using RAG pipeline
 */
export async function retrieveContext(
  query: string,
  topK: number = 3,
  similarityThreshold: number = 0.7,
  existingEmbedding?: number[]
): Promise<RAGContext> {
  try {
    const queryEmbedding =
      existingEmbedding || (await generateEmbedding(query));
    const results = await searchSimilarDocuments(
      queryEmbedding,
      similarityThreshold,
      topK
    );

    const relevantDocs = results.map((doc) => ({
      content: doc.content,
      similarity: doc.similarity,
    }));

    console.log(`[RAG] Found ${relevantDocs.length} relevant documents`);

    return {
      query,
      relevantDocs,
      cacheHit: false,
    };
  } catch (error) {
    console.error("RAG retrieval error:", error);
    throw error;
  }
}

/**
 * Build context string from relevant documents
 */
export function buildContextString(
  docs: Array<{ content: string; similarity: number }>
): string {
  if (docs.length === 0) {
    return "No relevant information found in the knowledge base.";
  }

  return docs
    .map(
      (doc, index) =>
        `[Document ${index + 1}] (Relevance: ${(doc.similarity * 100).toFixed(
          1
        )}%)\n${doc.content}`
    )
    .join("\n\n---\n\n");
}

/**
 * Cache a query-response pair for future use
 */
export async function cacheQueryResponse(
  query: string,
  response: string
): Promise<void> {
  try {
    const queryEmbedding = await generateEmbedding(query);
    await storeInSemanticCache(query, queryEmbedding, response, 3600); // 1 hour TTL
  } catch (error) {
    console.error("Failed to cache response:", error);
    // Don't throw - caching failure shouldn't break the request
  }
}
