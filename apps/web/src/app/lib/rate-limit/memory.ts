export class MemoryRateLimiter {
  private limitMap = new Map<string, { count: number; resetTime: number }>();
  constructor(private maxRequests: number = 10, private windowMs: number = 60000) {}

  check(key: string): boolean {
    const now = Date.now();
    const record = this.limitMap.get(key);

    if (!record || now > record.resetTime) {
      this.limitMap.set(key, { count: 1, resetTime: now + this.windowMs });
      return true;
    }

    if (record.count >= this.maxRequests) return false;

    record.count++;
    return true;
  }

  cleanup() {
    const now = Date.now();
    for (const [key, record] of this.limitMap.entries()) {
      if (now > record.resetTime) this.limitMap.delete(key);
    }
  }
}

// Singleton instances for local/dev
export const memoryUploadLimiter = new MemoryRateLimiter(10, 60000);
export const memoryChatLimiter = new MemoryRateLimiter(30, 60000);
