import Redis from "ioredis";
import crypto from "crypto";

/**
 * ============================
 * Redis Client (Server Only)
 * ============================
 */
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});

/**
 * ============================
 * Types
 * ============================
 */
export interface SemanticCacheEntry {
  query: string;
  embedding: number[];
  response: string;
  timestamp: number;
}

/**
 * ============================
 * Constants
 * ============================
 *
 * We store all entries in ONE HASH.
 * This avoids Redis KEYS and keeps lookups bounded.
 */
const SEMANTIC_CACHE_HASH = "semantic_cache:v1";
const MAX_CACHE_ENTRIES = 500; // safety limit

/**
 * ============================
 * Math Utils
 * ============================
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * ============================
 * Search Semantic Cache
 * ============================
 */
export async function searchSemanticCache(
  queryEmbedding: number[],
  similarityThreshold = 0.88
): Promise<string | null> {
  try {
    const entries = await redis.hgetall(SEMANTIC_CACHE_HASH);

    if (!entries || Object.keys(entries).length === 0) {
      return null;
    }

    for (const raw of Object.values(entries)) {
      const entry = JSON.parse(raw) as SemanticCacheEntry;

      const similarity = cosineSimilarity(
        queryEmbedding,
        entry.embedding
      );

      if (similarity >= similarityThreshold) {
        console.log(
          `[Semantic Cache HIT] similarity=${similarity.toFixed(4)}`
        );
        return entry.response;
      }
    }

    return null;
  } catch (error) {
    console.error("[Semantic Cache] search failed:", error);
    return null;
  }
}

/**
 * ============================
 * Store Semantic Cache Entry
 * ============================
 */
export async function storeInSemanticCache(
  query: string,
  embedding: number[],
  response: string,
  ttlSeconds = 3600
): Promise<void> {
  try {
    const id = crypto.randomUUID();

    const entry: SemanticCacheEntry = {
      query,
      embedding,
      response,
      timestamp: Date.now(),
    };

    // Store entry
    await redis.hset(
      SEMANTIC_CACHE_HASH,
      id,
      JSON.stringify(entry)
    );

    // Expire entire hash (sliding TTL)
    await redis.expire(SEMANTIC_CACHE_HASH, ttlSeconds);

    // Enforce size limit
    const size = await redis.hlen(SEMANTIC_CACHE_HASH);
    if (size > MAX_CACHE_ENTRIES) {
      await evictOldestEntries(size - MAX_CACHE_ENTRIES);
    }

    console.log(`[Semantic Cache STORE] id=${id}`);
  } catch (error) {
    console.error("[Semantic Cache] store failed:", error);
  }
}

/**
 * ============================
 * Eviction Policy (Oldest First)
 * ============================
 */
async function evictOldestEntries(count: number) {
  const entries = await redis.hgetall(SEMANTIC_CACHE_HASH);

  const sorted = Object.entries(entries)
    .map(([key, value]) => ({
      key,
      timestamp: JSON.parse(value).timestamp,
    }))
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(0, count);

  if (sorted.length > 0) {
    await redis.hdel(
      SEMANTIC_CACHE_HASH,
      ...sorted.map(e => e.key)
    );

    console.log(
      `[Semantic Cache] Evicted ${sorted.length} old entries`
    );
  }
}
