/**
 * Domain Scheduler - Groups jobs by domain and provides domain-aware scheduling.
 * Improves performance through domain affinity (reusing browser state, cookies, etc.)
 */

import type { BatchJob } from '../../shared/types';

export interface DomainQueue {
  domain: string;
  jobs: BatchJob[];
  priority: number;
  activeSlots: Set<number>;
  httpSuccessCount: number;  // Jobs completed via HTTP (no browser)
  browserFallbackCount: number;  // Jobs that needed browser
  httpAttempts: number;  // Total HTTP attempts
  avgHttpTimeMs: number;  // Average HTTP response time
  avgBrowserTimeMs: number;  // Average browser scrape time
}

export interface DomainStats {
  domain: string;
  pending: number;
  active: number;
  httpSuccessRate: number;
}

export class DomainScheduler {
  private queues: Map<string, DomainQueue> = new Map();
  private slotDomainMap: Map<number, string> = new Map();  // slot → current domain
  private totalJobs = 0;
  private completedJobs = 0;
  private httpSuccessTotal = 0;
  private browserFallbackTotal = 0;

  /**
   * Group jobs by domain on initialization.
   */
  initialize(jobs: BatchJob[]): void {
    this.queues.clear();
    this.slotDomainMap.clear();
    this.totalJobs = jobs.length;
    this.completedJobs = 0;
    this.httpSuccessTotal = 0;
    this.browserFallbackTotal = 0;

    for (const job of jobs) {
      if (!this.queues.has(job.domain)) {
        this.queues.set(job.domain, {
          domain: job.domain,
          jobs: [],
          priority: 0,
          activeSlots: new Set(),
          httpSuccessCount: 0,
          browserFallbackCount: 0,
          httpAttempts: 0,
          avgHttpTimeMs: 0,
          avgBrowserTimeMs: 0,
        });
      }
      this.queues.get(job.domain)!.jobs.push(job);
    }

    // Set priority = job count (more jobs = higher priority)
    for (const queue of this.queues.values()) {
      queue.priority = queue.jobs.length;
    }

    console.log(
      `[DomainScheduler] Initialized with ${this.queues.size} domains, ${this.totalJobs} jobs`
    );
  }

  /**
   * Get all jobs grouped by domain (for HTTP batch processing).
   */
  getAllJobsByDomain(): Map<string, BatchJob[]> {
    const result = new Map<string, BatchJob[]>();
    for (const [domain, queue] of this.queues.entries()) {
      result.set(domain, [...queue.jobs]);
    }
    return result;
  }

  /**
   * Get all jobs as a flat array.
   */
  getAllJobs(): BatchJob[] {
    const jobs: BatchJob[] = [];
    for (const queue of this.queues.values()) {
      jobs.push(...queue.jobs);
    }
    return jobs;
  }

  /**
   * Get next job for a slot (domain-aware).
   * Prefers jobs from the same domain the slot was last working on.
   */
  getNextJob(slotId: number): BatchJob | null {
    const currentDomain = this.slotDomainMap.get(slotId);

    // 1. Try to continue with same domain (affinity)
    if (currentDomain) {
      const queue = this.queues.get(currentDomain);
      if (queue && queue.jobs.length > 0) {
        const job = queue.jobs.shift()!;
        queue.activeSlots.add(slotId);
        return job;
      }
    }

    // 2. Find highest priority domain with jobs
    const sortedQueues = [...this.queues.values()]
      .filter((q) => q.jobs.length > 0)
      .sort((a, b) => b.priority - a.priority);

    if (sortedQueues.length === 0) {
      return null;
    }

    const selectedQueue = sortedQueues[0];
    const job = selectedQueue.jobs.shift()!;

    // Update affinity
    this.slotDomainMap.set(slotId, selectedQueue.domain);
    selectedQueue.activeSlots.add(slotId);

    return job;
  }

  /**
   * Get next job for a specific domain (for browser fallback after HTTP fails).
   */
  getNextJobForDomain(domain: string): BatchJob | null {
    const queue = this.queues.get(domain);
    if (!queue || queue.jobs.length === 0) {
      return null;
    }
    return queue.jobs.shift()!;
  }

  /**
   * Re-queue a job (e.g., for retry with browser after HTTP fails).
   */
  requeueJob(job: BatchJob, atFront = false): void {
    const queue = this.queues.get(job.domain);
    if (!queue) {
      // Create queue if it doesn't exist
      this.queues.set(job.domain, {
        domain: job.domain,
        jobs: [job],
        priority: 1,
        activeSlots: new Set(),
        httpSuccessCount: 0,
        browserFallbackCount: 0,
        httpAttempts: 0,
        avgHttpTimeMs: 0,
        avgBrowserTimeMs: 0,
      });
      return;
    }

    if (atFront) {
      queue.jobs.unshift(job);
    } else {
      queue.jobs.push(job);
    }
  }

  /**
   * Mark job completed and update stats.
   */
  markCompleted(slotId: number, usedBrowser: boolean): void {
    this.completedJobs++;

    if (usedBrowser) {
      this.browserFallbackTotal++;
    } else {
      this.httpSuccessTotal++;
    }

    // Update domain-level stats
    const domain = this.slotDomainMap.get(slotId);
    if (domain) {
      const queue = this.queues.get(domain);
      if (queue) {
        if (usedBrowser) {
          queue.browserFallbackCount++;
        } else {
          queue.httpSuccessCount++;
        }

        // Clean up if domain queue is empty
        if (queue.jobs.length === 0) {
          queue.activeSlots.delete(slotId);
        }
      }
    }
  }

  /**
   * Mark a job as completed by URL (for HTTP batch processing).
   */
  markCompletedByUrl(_url: string, usedBrowser: boolean): void {
    this.completedJobs++;

    if (usedBrowser) {
      this.browserFallbackTotal++;
    } else {
      this.httpSuccessTotal++;
    }
  }

  /**
   * Get remaining jobs count.
   */
  getRemainingCount(): number {
    let count = 0;
    for (const queue of this.queues.values()) {
      count += queue.jobs.length;
    }
    return count;
  }

  /**
   * Get stats by domain.
   */
  getStats(): DomainStats[] {
    return [...this.queues.values()].map((q) => ({
      domain: q.domain,
      pending: q.jobs.length,
      active: q.activeSlots.size,
      httpSuccessRate:
        q.httpSuccessCount + q.browserFallbackCount > 0
          ? q.httpSuccessCount / (q.httpSuccessCount + q.browserFallbackCount)
          : 0,
    }));
  }

  /**
   * Get overall progress stats.
   */
  getProgress(): {
    total: number;
    completed: number;
    remaining: number;
    httpSuccessRate: number;
    domainsRemaining: number;
  } {
    const remaining = this.getRemainingCount();
    const domainsRemaining = [...this.queues.values()].filter(
      (q) => q.jobs.length > 0
    ).length;

    return {
      total: this.totalJobs,
      completed: this.completedJobs,
      remaining,
      httpSuccessRate:
        this.httpSuccessTotal + this.browserFallbackTotal > 0
          ? this.httpSuccessTotal /
            (this.httpSuccessTotal + this.browserFallbackTotal)
          : 0,
      domainsRemaining,
    };
  }

  /**
   * Clear slot affinity (on slot close).
   */
  clearSlot(slotId: number): void {
    const domain = this.slotDomainMap.get(slotId);
    if (domain) {
      this.queues.get(domain)?.activeSlots.delete(slotId);
    }
    this.slotDomainMap.delete(slotId);
  }

  /**
   * Get domains sorted by priority.
   */
  getDomainsByPriority(): string[] {
    return [...this.queues.entries()]
      .filter(([, queue]) => queue.jobs.length > 0)
      .sort((a, b) => b[1].priority - a[1].priority)
      .map(([domain]) => domain);
  }

  /**
   * Check if a domain tends to need browser (based on history).
   */
  domainNeedsBrowser(domain: string, threshold = 0.5): boolean {
    const queue = this.queues.get(domain);
    if (!queue) return false;

    const total = queue.httpSuccessCount + queue.browserFallbackCount;
    if (total < 3) return false; // Not enough data

    const browserRate = queue.browserFallbackCount / total;
    return browserRate > threshold;
  }

  /**
   * Should we skip HTTP and go straight to browser for this domain?
   * Uses domain learning to make smart routing decisions.
   */
  shouldSkipHttp(domain: string): boolean {
    const queue = this.queues.get(domain);
    if (!queue) return false;

    // Need at least 3 attempts to make a decision
    if (queue.httpAttempts < 3) return false;

    const httpSuccessRate = queue.httpSuccessCount / queue.httpAttempts;

    // Skip HTTP if:
    // 1. Less than 20% HTTP success rate, OR
    // 2. Browser is actually faster (rare but possible for some sites)
    if (httpSuccessRate < 0.2) {
      console.log(`[DomainScheduler] Skipping HTTP for ${domain}: ${Math.round(httpSuccessRate * 100)}% success rate`);
      return true;
    }

    // If we have timing data and browser is faster, consider skipping HTTP
    if (queue.avgBrowserTimeMs > 0 && queue.avgHttpTimeMs > 0) {
      if (queue.avgBrowserTimeMs < queue.avgHttpTimeMs && httpSuccessRate < 0.5) {
        console.log(`[DomainScheduler] Skipping HTTP for ${domain}: browser is faster (${queue.avgBrowserTimeMs}ms vs ${queue.avgHttpTimeMs}ms)`);
        return true;
      }
    }

    return false;
  }

  /**
   * Record a scraping result for domain learning.
   */
  recordResult(
    domain: string,
    method: 'http' | 'browser',
    success: boolean,
    timeMs: number
  ): void {
    const queue = this.queues.get(domain);
    if (!queue) return;

    if (method === 'http') {
      queue.httpAttempts++;
      if (success) {
        queue.httpSuccessCount++;
      } else {
        queue.browserFallbackCount++;
      }
      // Update running average
      queue.avgHttpTimeMs = queue.avgHttpTimeMs === 0
        ? timeMs
        : (queue.avgHttpTimeMs * (queue.httpAttempts - 1) + timeMs) / queue.httpAttempts;
    } else {
      // Browser result
      const browserAttempts = queue.browserFallbackCount;
      queue.avgBrowserTimeMs = queue.avgBrowserTimeMs === 0
        ? timeMs
        : (queue.avgBrowserTimeMs * (browserAttempts - 1) + timeMs) / browserAttempts;
    }
  }

  /**
   * Get domains that should skip HTTP based on learning.
   */
  getHttpSkipDomains(): string[] {
    return [...this.queues.entries()]
      .filter(([domain]) => this.shouldSkipHttp(domain))
      .map(([domain]) => domain);
  }

  /**
   * Get domains that likely need browser (based on fallback history).
   */
  getBrowserRequiredDomains(threshold = 0.7): string[] {
    return [...this.queues.entries()]
      .filter(([, queue]) => {
        const total = queue.httpSuccessCount + queue.browserFallbackCount;
        if (total < 3) return false;
        return queue.browserFallbackCount / total > threshold;
      })
      .map(([domain]) => domain);
  }

  /**
   * Reset the scheduler.
   */
  reset(): void {
    this.queues.clear();
    this.slotDomainMap.clear();
    this.totalJobs = 0;
    this.completedJobs = 0;
    this.httpSuccessTotal = 0;
    this.browserFallbackTotal = 0;
  }
}
