// ============================================================================
// PROFILE MANAGER - Persistent Browser Profile & Cookie Management
// ============================================================================

import { promises as fs } from 'fs';
import path from 'path';
import type { BrowserContext, Cookie } from 'playwright';

export interface ProfileInfo {
  domain: string;
  profilePath: string;
  cookiesPath: string;
  lastUpdated: Date | null;
  hasClearance: boolean;
}

export class ProfileManager {
  private profilesDir: string;

  constructor(baseDir = './browser-profiles') {
    this.profilesDir = path.resolve(baseDir);
  }

  /**
   * Ensures the profiles directory exists
   */
  async init(): Promise<void> {
    await fs.mkdir(this.profilesDir, { recursive: true });
  }

  /**
   * Gets the user data directory path for a domain
   */
  getProfilePath(domain: string): string {
    const sanitizedDomain = this.sanitizeDomain(domain);
    return path.join(this.profilesDir, sanitizedDomain);
  }

  /**
   * Gets the cookies file path for a domain
   */
  getCookiesPath(domain: string): string {
    const sanitizedDomain = this.sanitizeDomain(domain);
    return path.join(this.profilesDir, sanitizedDomain, 'cookies.json');
  }

  /**
   * Sanitize domain name for filesystem
   */
  private sanitizeDomain(domain: string): string {
    // Extract domain from URL if full URL provided
    try {
      const url = new URL(domain.startsWith('http') ? domain : `https://${domain}`);
      domain = url.hostname;
    } catch {
      // Keep as-is if not a valid URL
    }
    // Remove www. prefix and replace invalid chars
    return domain.replace(/^www\./, '').replace(/[^a-zA-Z0-9.-]/g, '_');
  }

  /**
   * Extract domain from URL
   */
  extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  /**
   * Ensures profile directory exists for a domain
   */
  async ensureProfileDir(domain: string): Promise<string> {
    const profilePath = this.getProfilePath(domain);
    await fs.mkdir(profilePath, { recursive: true });
    return profilePath;
  }

  /**
   * Export cookies from a browser context to file
   */
  async exportCookies(context: BrowserContext, domain: string): Promise<Cookie[]> {
    const cookies = await context.cookies();
    const cookiesPath = this.getCookiesPath(domain);

    // Ensure directory exists
    await this.ensureProfileDir(domain);

    // Save all cookies (Cloudflare needs multiple cookies to work)
    await fs.writeFile(cookiesPath, JSON.stringify(cookies, null, 2));

    console.log(`[ProfileManager] Exported ${cookies.length} cookies for ${domain}`);
    return cookies;
  }

  /**
   * Export only Cloudflare-related cookies
   */
  async exportCloudflareCookies(context: BrowserContext, domain: string): Promise<Cookie[]> {
    const allCookies = await context.cookies();

    // Filter Cloudflare cookies
    const cfCookies = allCookies.filter(c =>
      c.name === 'cf_clearance' ||
      c.name === '__cf_bm' ||
      c.name.startsWith('cf_') ||
      c.name.startsWith('__cf')
    );

    if (cfCookies.length === 0) {
      console.log(`[ProfileManager] No Cloudflare cookies found for ${domain}`);
      return [];
    }

    const cookiesPath = this.getCookiesPath(domain);
    await this.ensureProfileDir(domain);
    await fs.writeFile(cookiesPath, JSON.stringify(cfCookies, null, 2));

    console.log(`[ProfileManager] Exported ${cfCookies.length} Cloudflare cookies for ${domain}`);
    return cfCookies;
  }

  /**
   * Import cookies from file to a browser context
   */
  async importCookies(context: BrowserContext, domain: string): Promise<boolean> {
    const cookiesPath = this.getCookiesPath(domain);

    try {
      const data = await fs.readFile(cookiesPath, 'utf-8');
      const cookies: Cookie[] = JSON.parse(data);

      if (cookies.length === 0) {
        console.log(`[ProfileManager] No cookies to import for ${domain}`);
        return false;
      }

      // Filter out expired cookies
      const now = Date.now() / 1000;
      const validCookies = cookies.filter(c => !c.expires || c.expires > now);

      if (validCookies.length === 0) {
        console.log(`[ProfileManager] All cookies expired for ${domain}`);
        return false;
      }

      await context.addCookies(validCookies);
      console.log(`[ProfileManager] Imported ${validCookies.length} cookies for ${domain}`);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.log(`[ProfileManager] No saved cookies for ${domain}`);
      } else {
        console.error(`[ProfileManager] Error importing cookies:`, error);
      }
      return false;
    }
  }

  /**
   * Check if valid Cloudflare clearance exists
   */
  async hasClearance(domain: string): Promise<boolean> {
    const cookiesPath = this.getCookiesPath(domain);

    try {
      const data = await fs.readFile(cookiesPath, 'utf-8');
      const cookies: Cookie[] = JSON.parse(data);
      const now = Date.now() / 1000;

      // Look for cf_clearance that hasn't expired
      const clearance = cookies.find(c =>
        c.name === 'cf_clearance' &&
        (!c.expires || c.expires > now)
      );

      return !!clearance;
    } catch {
      return false;
    }
  }

  /**
   * Get profile info for a domain
   */
  async getProfileInfo(domain: string): Promise<ProfileInfo> {
    const profilePath = this.getProfilePath(domain);
    const cookiesPath = this.getCookiesPath(domain);

    let lastUpdated: Date | null = null;
    let hasClearance = false;

    try {
      const stat = await fs.stat(cookiesPath);
      lastUpdated = stat.mtime;
      hasClearance = await this.hasClearance(domain);
    } catch {
      // File doesn't exist
    }

    return {
      domain: this.sanitizeDomain(domain),
      profilePath,
      cookiesPath,
      lastUpdated,
      hasClearance,
    };
  }

  /**
   * List all domains with saved profiles
   */
  async listProfiles(): Promise<ProfileInfo[]> {
    try {
      const entries = await fs.readdir(this.profilesDir, { withFileTypes: true });
      const profiles: ProfileInfo[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const info = await this.getProfileInfo(entry.name);
          profiles.push(info);
        }
      }

      return profiles;
    } catch {
      return [];
    }
  }

  /**
   * Clear profile for a domain
   */
  async clearProfile(domain: string): Promise<void> {
    const profilePath = this.getProfilePath(domain);
    try {
      await fs.rm(profilePath, { recursive: true, force: true });
      console.log(`[ProfileManager] Cleared profile for ${domain}`);
    } catch (error) {
      console.error(`[ProfileManager] Error clearing profile:`, error);
    }
  }
}

// Singleton instance
export const profileManager = new ProfileManager();
