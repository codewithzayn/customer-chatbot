import { createClient } from "@supabase/supabase-js";

// Supabase client with service role key (server-side only)
// NEVER expose this to the frontend
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing Supabase environment variables");
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Type for document with embedding
export interface Document {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
  source_hash?: string;
  created_at: string;
  updated_at: string;
}

// Type for similarity search result
export interface SearchResult {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

/**
 * Insert a document with its embedding into Supabase
 */
export async function insertDocument(
  content: string,
  embedding: number[],
  metadata: Record<string, unknown> = {}
): Promise<Document> {
  const source_hash = metadata.source_hash as string | undefined;

  const { data, error } = await supabase
    .from("documents")
    .insert({
      content,
      embedding,
      metadata,
      source_hash,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to insert document: ${error.message}`);
  }

  return data;
}

/**
 * Search for similar documents using vector similarity
 */
export async function searchSimilarDocuments(
  queryEmbedding: number[],
  matchThreshold: number = 0.7,
  matchCount: number = 5
): Promise<SearchResult[]> {
  const { data, error } = await supabase.rpc("match_documents", {
    query_embedding: queryEmbedding,
    match_threshold: matchThreshold,
    match_count: matchCount,
  });

  if (error) {
    throw new Error(`Failed to search documents: ${error.message}`);
  }

  return data || [];
}


/**
 * Check if a document with the given content hash already exists
 */
export async function checkDocumentExists(hash: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("documents")
    .select("id")
    .eq("source_hash", hash)
    .limit(1);

  if (error) {
    console.warn("Error checking document existence:", error);
    return false;
  }

  return data && data.length > 0;
}
