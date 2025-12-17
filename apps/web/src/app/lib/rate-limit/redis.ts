import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const redis = new Redis(redisUrl);

/**
 * Redis-based rate limiter using INCR and TTL
 */
export class RedisRateLimiter {
  constructor(
    private keyPrefix: string,
    private maxRequests: number = 2,
    private windowSec: number = 60 // Redis expire() expects seconds, not milliseconds
  ) {}

  async check(key: string): Promise<boolean> {
    const redisKey = `${this.keyPrefix}:${key}`;
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, this.windowSec);
    }
    return count <= this.maxRequests;
  }
}

// Singleton instances for production
export const redisChatLimiter = new RedisRateLimiter("chat", 3, 60); // 3 requests per 60 seconds
