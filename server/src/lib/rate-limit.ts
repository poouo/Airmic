interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * 简单的进程内滑动窗口限流器，适合单实例部署。
 * 返回 true 表示放行，false 表示触发限流。
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = Date.now) {}

  hit(key: string, limit: number, windowMs: number): boolean {
    const now = this.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= limit;
  }

  /** 剩余可用次数 */
  remaining(key: string, limit: number): number {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= Date.now()) return limit;
    return Math.max(0, limit - bucket.count);
  }

  /** 距离窗口重置的剩余毫秒数（未限流或已重置时为 0） */
  retryAfterMs(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return 0;
    return Math.max(0, bucket.resetAt - this.now());
  }

  sweep(): void {
    const now = this.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  /** 清空所有限流计数（测试或管理用途） */
  reset(): void {
    this.buckets.clear();
  }
}

/** 全局限流器实例，供路由/信令使用 */
export const globalRateLimiter = new RateLimiter();

setInterval(() => globalRateLimiter.sweep(), 60_000).unref?.();