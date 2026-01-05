/**
 * In-memory Config Cache for Batch Processing.
 * Pre-loads all config JSON files on batch start to eliminate disk I/O during scraping.
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

export interface ScraperConfig {
  name: string;
  url?: string;
  country?: string;
  selectors: Record<string, unknown>;
  pagination?: unknown;
  scroll?: unknown;
  preActions?: unknown[];
  [key: string]: unknown;
}

export class ConfigCache extends EventEmitter {
  private cache: Map<string, ScraperConfig> = new Map();
  private domainIndex: Map<string, string[]> = new Map(); // domain -> config names
  private countryDomainIndex: Map<string, string[]> = new Map(); // "domain:country" -> config names
  private lastLoadTime = 0;
  private configsDir: string;

  constructor(configsDir?: string) {
    super();
    this.configsDir = configsDir || path.join(process.cwd(), 'configs');
  }

  /**
   * Pre-load all configs into memory.
   */
  async preload(): Promise<{ loaded: number; errors: string[] }> {
    const startTime = Date.now();
    const errors: string[] = [];

    this.cache.clear();
    this.domainIndex.clear();
    this.countryDomainIndex.clear();

    try {
      if (!fs.existsSync(this.configsDir)) {
        errors.push(`Config directory not found: ${this.configsDir}`);
        return { loaded: 0, errors };
      }

      const files = fs.readdirSync(this.configsDir).filter((f) => f.endsWith('.json'));

      for (const file of files) {
        try {
          const filePath = path.join(this.configsDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const config = JSON.parse(content) as ScraperConfig;
          const name = file.replace('.json', '');

          config.name = name;
          this.cache.set(name, config);

          // Build domain indexes for fast lookup
          if (config.url) {
            const domain = this.extractDomain(config.url);

            // Add to domain index
            if (!this.domainIndex.has(domain)) {
              this.domainIndex.set(domain, []);
            }
            this.domainIndex.get(domain)!.push(name);

            // Add to country+domain index if country specified
            if (config.country) {
              const key = `${domain}:${config.country.toLowerCase()}`;
              if (!this.countryDomainIndex.has(key)) {
                this.countryDomainIndex.set(key, []);
              }
              this.countryDomainIndex.get(key)!.push(name);
            }
          }
        } catch (err) {
          errors.push(`${file}: ${(err as Error).message}`);
        }
      }

      this.lastLoadTime = Date.now();
      const loadTime = Date.now() - startTime;
      console.log(`[ConfigCache] Loaded ${this.cache.size} configs in ${loadTime}ms`);

      this.emit('cache:loaded', { count: this.cache.size, loadTime });
    } catch (err) {
      errors.push(`Directory read failed: ${(err as Error).message}`);
    }

    return { loaded: this.cache.size, errors };
  }

  /**
   * Get config by exact name (instant, from cache).
   */
  get(name: string): ScraperConfig | undefined {
    return this.cache.get(name);
  }

  /**
   * Get config by domain and optional country.
   * Prioritizes exact country match, then falls back to domain-only.
   */
  getByDomain(domain: string, country?: string): ScraperConfig | undefined {
    const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');

    // Try exact domain:country match first
    if (country) {
      const key = `${normalizedDomain}:${country.toLowerCase()}`;
      const names = this.countryDomainIndex.get(key);
      if (names && names.length > 0) {
        return this.cache.get(names[0]);
      }
    }

    // Fall back to domain-only match
    const domainNames = this.domainIndex.get(normalizedDomain);
    if (domainNames && domainNames.length > 0) {
      // If country specified but no country match, try to find a config without country
      // (generic config for domain)
      if (country) {
        for (const name of domainNames) {
          const config = this.cache.get(name);
          if (config && !config.country) {
            return config;
          }
        }
      }
      // Return first match
      return this.cache.get(domainNames[0]);
    }

    return undefined;
  }

  /**
   * Find config by matching a URL's domain.
   */
  getByUrl(url: string, country?: string): ScraperConfig | undefined {
    const domain = this.extractDomain(url);
    return this.getByDomain(domain, country);
  }

  /**
   * Get all cached configs.
   */
  getAll(): ScraperConfig[] {
    return Array.from(this.cache.values());
  }

  /**
   * Get all unique domains in cache.
   */
  getDomains(): string[] {
    return Array.from(this.domainIndex.keys());
  }

  /**
   * Check if a config exists for a domain.
   */
  hasDomain(domain: string): boolean {
    const normalized = domain.toLowerCase().replace(/^www\./, '');
    return this.domainIndex.has(normalized);
  }

  /**
   * Extract domain from URL.
   */
  private extractDomain(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      // Try to extract domain from partial URL
      const match = url.match(/(?:https?:\/\/)?(?:www\.)?([^\/\s]+)/i);
      return match ? match[1].toLowerCase() : url.toLowerCase();
    }
  }

  /**
   * Get cache statistics.
   */
  getStats(): {
    cached: number;
    domains: number;
    lastLoadMs: number;
  } {
    return {
      cached: this.cache.size,
      domains: this.domainIndex.size,
      lastLoadMs: this.lastLoadTime > 0 ? Date.now() - this.lastLoadTime : 0,
    };
  }

  /**
   * Clear the cache.
   */
  clear(): void {
    this.cache.clear();
    this.domainIndex.clear();
    this.countryDomainIndex.clear();
    this.lastLoadTime = 0;
  }
}

// Singleton instance
let configCacheInstance: ConfigCache | null = null;

export function getConfigCache(configsDir?: string): ConfigCache {
  if (!configCacheInstance) {
    configCacheInstance = new ConfigCache(configsDir);
  }
  return configCacheInstance;
}

export function resetConfigCache(): void {
  if (configCacheInstance) {
    configCacheInstance.clear();
    configCacheInstance = null;
  }
}
