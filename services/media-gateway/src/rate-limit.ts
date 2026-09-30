export class WindowLimiter {
  private readonly hits = new Map<string, number[]>();

  allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    const fresh = (this.hits.get(key) ?? []).filter((at) => now - at < windowMs);
    if (fresh.length >= limit) {
      this.hits.set(key, fresh);
      return false;
    }
    fresh.push(now);
    this.hits.set(key, fresh);
    return true;
  }
}
