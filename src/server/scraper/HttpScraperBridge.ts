/**
 * Node.js bridge to Python HTTP scraper.
 * Provides async interface for batch processing with HTTP-first approach.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface HttpScrapeInput {
  url: string;
  selectors: Record<string, unknown>;
  targetCount: number;
}

export interface HttpScrapeResult {
  success: boolean;
  items: unknown[];
  count: number;
  needs_browser: boolean;
  reason: string | null;
}

export class HttpScraperBridge {
  private pythonPath: string;
  private scriptPath: string;

  constructor() {
    this.pythonPath = process.env.PYTHON_PATH || 'python3';
    this.scriptPath = path.join(__dirname, 'http_scraper.py');
  }

  /**
   * Scrape a single URL using HTTP + BeautifulSoup4.
   * Returns result indicating if browser fallback is needed.
   */
  async scrape(input: HttpScrapeInput): Promise<HttpScrapeResult> {
    return new Promise((resolve) => {
      const inputJson = JSON.stringify(input);

      let proc: ChildProcess;
      try {
        proc = spawn(this.pythonPath, [this.scriptPath, inputJson], {
          timeout: 15000, // 15s max
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        resolve({
          success: false,
          items: [],
          count: 0,
          needs_browser: true,
          reason: `spawn_error: ${(err as Error).message}`,
        });
        return;
      }

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        resolve({
          success: false,
          items: [],
          count: 0,
          needs_browser: true,
          reason: 'timeout_15s',
        });
      }, 15000);

      proc.on('close', (code: number | null) => {
        clearTimeout(timeout);

        if (code !== 0 || !stdout) {
          resolve({
            success: false,
            items: [],
            count: 0,
            needs_browser: true,
            reason: `process_error: code=${code}, stderr=${stderr || 'no output'}`,
          });
          return;
        }

        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch {
          resolve({
            success: false,
            items: [],
            count: 0,
            needs_browser: true,
            reason: `parse_error: ${stdout.substring(0, 200)}`,
          });
        }
      });

      proc.on('error', (err: Error) => {
        clearTimeout(timeout);
        resolve({
          success: false,
          items: [],
          count: 0,
          needs_browser: true,
          reason: `spawn_error: ${err.message}`,
        });
      });
    });
  }

  /**
   * Batch scrape multiple URLs with concurrency control.
   * Useful for pre-processing all jobs with HTTP before browser fallback.
   */
  async scrapeBatch(
    inputs: HttpScrapeInput[],
    concurrency = 20,
    onProgress?: (completed: number, total: number, result: HttpScrapeResult) => void
  ): Promise<Map<string, HttpScrapeResult>> {
    const results = new Map<string, HttpScrapeResult>();
    const queue = [...inputs];
    let completed = 0;
    const total = inputs.length;

    const workers = Array(Math.min(concurrency, queue.length))
      .fill(null)
      .map(async () => {
        while (queue.length > 0) {
          const input = queue.shift();
          if (!input) break;

          const result = await this.scrape(input);
          results.set(input.url, result);
          completed++;

          if (onProgress) {
            onProgress(completed, total, result);
          }
        }
      });

    await Promise.all(workers);
    return results;
  }

  /**
   * Test if Python and dependencies are available.
   */
  async testConnection(): Promise<{ available: boolean; error?: string }> {
    return new Promise((resolve) => {
      const proc = spawn(this.pythonPath, ['-c', 'import requests; import bs4; print("ok")'], {
        timeout: 5000,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code: number | null) => {
        if (code === 0 && stdout.includes('ok')) {
          resolve({ available: true });
        } else {
          resolve({
            available: false,
            error: stderr || 'Python dependencies not available. Run: pip install requests beautifulsoup4',
          });
        }
      });

      proc.on('error', (err: Error) => {
        resolve({
          available: false,
          error: `Python not found: ${err.message}`,
        });
      });
    });
  }
}

// Singleton instance for reuse
let httpScraperInstance: HttpScraperBridge | null = null;

export function getHttpScraper(): HttpScraperBridge {
  if (!httpScraperInstance) {
    httpScraperInstance = new HttpScraperBridge();
  }
  return httpScraperInstance;
}
