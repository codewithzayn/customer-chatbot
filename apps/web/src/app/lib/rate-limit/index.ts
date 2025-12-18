import { memoryChatLimiter } from "./memory";
import { redisChatLimiter } from "./redis";
/**
 * - Production (Vercel): Redis-based (distributed)
 * - Development (local): Memory-based (in-process)
 */
const USE_REDIS = process.env.REDIS_URL !== undefined;

export const chatRateLimiter = USE_REDIS ? redisChatLimiter : memoryChatLimiter;
console.log(
  `[Rate Limiter] Using ${USE_REDIS ? "Redis" : "Memory"} rate limiter`
);
