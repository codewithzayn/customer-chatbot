import { isProduction } from "../env";
import { memoryUploadLimiter, memoryChatLimiter } from "./memory";
import { redisUploadLimiter, redisChatLimiter } from "./redis";

/**
 * Export singletons depending on environment
 */
export const uploadRateLimiter = isProduction ? redisUploadLimiter : memoryUploadLimiter;
export const chatRateLimiter = isProduction ? redisChatLimiter : memoryChatLimiter;
