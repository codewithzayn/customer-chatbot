import { NextRequest, NextResponse } from "next/server";
import {
  retrieveContext,
  buildContextString,
} from "../../../lib/rag/orchestrator";
import { searchSemanticCache } from "../../../lib/redis/semantic-cache";
import { generateEmbedding } from "../../../lib/openai/client";
import { cacheQueryResponse } from "../../../lib/rag/orchestrator";
import { chatRateLimiter } from "../../../lib/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const ip =
      req.headers.get("x-forwarded-for") ||
      req.headers.get("x-real-ip") ||
      "anonymous";
    const allowed = await chatRateLimiter.check(ip);

    if (!allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    const { query, topK = 3, similarityThreshold = 0.7 } = await req.json();

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "Query is required and must be a string" },
        { status: 400 }
      );
    }
    const queryEmbedding = await generateEmbedding(query);
    const cachedResponse = await searchSemanticCache(queryEmbedding, 0.7);
    if (cachedResponse) {
      console.log("[Knowledge Search] Cache HIT");
      return NextResponse.json({
        success: true,
        cached: true,
        response: cachedResponse,
        documents: [],
      });
    }
    // Step 3: Vector search in Supabase
    const ragContext = await retrieveContext(
      query,
      topK,
      similarityThreshold,
      queryEmbedding
    );

    // Step 4: Build context string
    const contextString = buildContextString(ragContext.relevantDocs);
    await cacheQueryResponse(query, queryEmbedding, contextString);
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
