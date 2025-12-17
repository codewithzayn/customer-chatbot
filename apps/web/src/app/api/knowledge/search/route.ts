import { NextRequest, NextResponse } from "next/server";
import {
  retrieveContext,
  buildContextString,
} from "../../../lib/rag/orchestrator";
import { searchSemanticCache } from "../../../lib/redis/semantic-cache";
import { generateEmbedding } from "../../../lib/openai/client";

export async function POST(req: NextRequest) {
  try {
    const { query, topK = 3, similarityThreshold = 0.7 } = await req.json();

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "Query is required and must be a string" },
        { status: 400 }
      );
    }

    console.log(`[Knowledge Search] Query: "${query}"`);

    // Step 1: Generate embedding
    const queryEmbedding = await generateEmbedding(query);

    // Step 2: Check semantic cache
    const cachedResponse = await searchSemanticCache(queryEmbedding, 0.88);
    if (cachedResponse) {
      console.log("[Knowledge Search] Cache HIT");
      return NextResponse.json({
        success: true,
        cached: true,
        response: cachedResponse,
        documents: [],
      });
    }

    console.log("[Knowledge Search] Cache MISS - searching vector DB");

    // Step 3: Vector search in Supabase
    const ragContext = await retrieveContext(
      query,
      topK,
      similarityThreshold,
      queryEmbedding
    );

    // Step 4: Build context string
    const contextString = buildContextString(ragContext.relevantDocs);

    return NextResponse.json({
      success: true,
      cached: false,
      documents: ragContext.relevantDocs,
      contextString,
      foundDocuments: ragContext.relevantDocs.length > 0,
    });
  } catch (error) {
    console.error("[Knowledge Search] Error:", error);
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Failed to search knowledge base";

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
