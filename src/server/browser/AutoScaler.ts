/**
 * Auto-Scaler - Dynamically adjusts browser pool size based on load and resources.
 */

import os from 'os';
import { BrowserPool } from './BrowserPool.js';
import { EventEmitter } from 'events';

export interface ScalerConfig {
  scaleUpThreshold: number;     // Scale up if >X% busy
  scaleDownThreshold: number;   // Scale down if <X% busy
  scaleCooldownMs: number;      // Wait between scale ops
  memoryPerBrowserMb: number;   // Estimated per browser
  minAvailableMemoryMb: number; // Keep this much free
  checkIntervalMs: number;      // Check every X ms
  maxScaleUpPerCycle: number;   // Max browsers to add at once
  maxScaleDownPerCycle: number; // Max browsers to remove at once
}

const DEFAULT_CONFIG: ScalerConfig = {
  scaleUpThreshold: 0.8,
  scaleDownThreshold: 0.3,
  scaleCooldownMs: 10000,
  memoryPerBrowserMb: 500,
  minAvailableMemoryMb: 2000,
  checkIntervalMs: 5000,
  maxScaleUpPerCycle: 5,
  maxScaleDownPerCycle: 3,
};

export class AutoScaler extends EventEmitter {
  private pool: BrowserPool;
  private config: ScalerConfig;
  private lastScaleTime = 0;
  private checkTimer?: NodeJS.Timeout;
  private queueDepth = 0;
  private isRunning = false;
  private isScaling = false;  // Lock to prevent concurrent scaling

  constructor(pool: BrowserPool, config: Partial<ScalerConfig> = {}) {
    super();
    this.pool = pool;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the auto-scaler.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.checkTimer = setInterval(() => this.evaluate(), this.config.checkIntervalMs);
    console.log('[AutoScaler] Started');
    this.emit('scaler:started');
  }

  /**
   * Stop the auto-scaler.
   */
  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }
    console.log('[AutoScaler] Stopped');
    this.emit('scaler:stopped');
  }

  /**
   * Update queue depth (called by batch controller).
   */
  setQueueDepth(depth: number): void {
    this.queueDepth = depth;
  }

  /**
   * Get current queue depth.
   */
  getQueueDepth(): number {
    return this.queueDepth;
  }

  /**
   * Force an immediate scaling evaluation.
   */
  async forceEvaluate(): Promise<void> {
    this.lastScaleTime = 0; // Reset cooldown
    await this.evaluate();
  }

  /**
   * Evaluate and scale the pool based on current conditions.
   */
  private async evaluate(): Promise<void> {
    // Prevent concurrent scaling operations
    if (this.isScaling) {
      return;
    }

    // Cooldown check
    if (Date.now() - this.lastScaleTime < this.config.scaleCooldownMs) {
      return;
    }

    this.isScaling = true;

    try {
      await this.doEvaluate();
    } finally {
      this.isScaling = false;
    }
  }

  /**
   * Internal evaluation logic.
   */
  private async doEvaluate(): Promise<void> {
    const stats = this.pool.getStats();
    const poolConfig = this.pool.getConfig();

    // Avoid division by zero
    if (stats.total === 0) {
      return;
    }

    const busyRatio = stats.busy / stats.total;
    const availableMemory = this.getAvailableMemoryMb();

    // Calculate target size
    let targetSize = stats.total;
    let reason = '';

    // Scale up logic
    if (busyRatio > this.config.scaleUpThreshold && this.queueDepth > 0) {
      // Check memory constraint
      if (availableMemory < this.config.minAvailableMemoryMb) {
        console.log(
          `[AutoScaler] Low memory (${availableMemory}MB), not scaling up`
        );
        this.emit('scaler:memoryConstrained', { available: availableMemory });
        return;
      }

      // Calculate how many to add based on queue depth
      const demandBasedAdd = Math.ceil(this.queueDepth / 5); // 1 browser per 5 queued jobs
      const toAdd = Math.min(demandBasedAdd, this.config.maxScaleUpPerCycle);

      // Apply memory constraint
      const memoryConstrainedMax = Math.floor(
        (availableMemory - this.config.minAvailableMemoryMb) / this.config.memoryPerBrowserMb
      );

      const actualAdd = Math.min(toAdd, memoryConstrainedMax);

      if (actualAdd > 0) {
        targetSize = Math.min(stats.total + actualAdd, poolConfig.maxSize);
        reason = `scale_up: queue=${this.queueDepth}, busy=${Math.round(busyRatio * 100)}%`;
      }
    }
    // Scale down logic
    else if (busyRatio < this.config.scaleDownThreshold && this.queueDepth === 0) {
      // Only scale down if no pending work
      const idleCount = stats.idle;
      if (idleCount > 1) {
        // Keep at least 1 idle browser
        const toRemove = Math.min(
          Math.floor(idleCount * 0.3), // Remove 30% of idle
          this.config.maxScaleDownPerCycle
        );
        targetSize = Math.max(stats.total - toRemove, poolConfig.minSize);
        reason = `scale_down: idle=${idleCount}, busy=${Math.round(busyRatio * 100)}%`;
      }
    }

    // Apply scaling if needed
    if (targetSize !== stats.total) {
      console.log(
        `[AutoScaler] Scaling: ${stats.total} → ${targetSize} (${reason})`
      );

      await this.pool.scaleTo(targetSize);
      this.lastScaleTime = Date.now();

      this.emit('scaler:scaled', {
        from: stats.total,
        to: targetSize,
        reason,
        queueDepth: this.queueDepth,
        busyRatio,
        availableMemory,
      });
    }
  }

  /**
   * Get available system memory in MB.
   */
  private getAvailableMemoryMb(): number {
    const freeMemory = os.freemem();
    return Math.floor(freeMemory / (1024 * 1024));
  }

  /**
   * Get total system memory in MB.
   */
  getTotalMemoryMb(): number {
    return Math.floor(os.totalmem() / (1024 * 1024));
  }

  /**
   * Get current scaler status.
   */
  getStatus(): {
    isRunning: boolean;
    queueDepth: number;
    availableMemoryMb: number;
    lastScaleTime: number;
    poolStats: { total: number; idle: number; busy: number; unhealthy: number };
  } {
    return {
      isRunning: this.isRunning,
      queueDepth: this.queueDepth,
      availableMemoryMb: this.getAvailableMemoryMb(),
      lastScaleTime: this.lastScaleTime,
      poolStats: this.pool.getStats(),
    };
  }

  /**
   * Get recommended pool size based on system resources.
   */
  getRecommendedPoolSize(): number {
    const totalMemory = this.getTotalMemoryMb();
    const cpuCount = os.cpus().length;

    // Memory-based limit: reserve 4GB for system, rest for browsers
    const memoryBasedLimit = Math.floor(
      (totalMemory - 4000) / this.config.memoryPerBrowserMb
    );

    // CPU-based limit: 2 browsers per core
    const cpuBasedLimit = cpuCount * 2;

    // Use the more conservative limit
    return Math.max(5, Math.min(memoryBasedLimit, cpuBasedLimit, 50));
  }
}
