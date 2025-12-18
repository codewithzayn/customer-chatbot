import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const redis = new Redis(redisUrl);

// Redis-based rate limiter
export class RedisRateLimiter {
  constructor(
    private keyPrefix: string,
    private maxRequests: number = 10,
    private windowSec: number = 60
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
export const redisChatLimiter = new RedisRateLimiter("chat", 10, 60);
