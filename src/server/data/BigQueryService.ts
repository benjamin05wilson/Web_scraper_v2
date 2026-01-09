// ============================================================================
// BIGQUERY SERVICE - Product data persistence
// ============================================================================

import { BigQuery } from '@google-cloud/bigquery';
import * as fs from 'fs';
import * as path from 'path';
import type { Product, ProductStats, ProductsResponse } from '../../shared/types.js';

// ============================================================================
// TYPES
// ============================================================================

// Input type for inserting products (more flexible than Product)
export interface ProductInput {
  item_name: string;
  brand?: string | null;
  price?: number | null;
  price_raw?: string | null;
  original_price?: number | null;
  currency?: string | null;
  domain?: string | null;
  category?: string | null;
  country?: string | null;
  competitor_type?: string | null;
  product_url?: string | null;
  image_url?: string | null;
  source_url?: string | null;
  scraped_at: string;
}

export interface ProductQueryFilters {
  page?: number;
  pageSize?: number;
  country?: string;
  domain?: string;
  category?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
}

interface BigQueryCredentials {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
  universe_domain: string;
}

// ============================================================================
// SCHEMA DEFINITION
// ============================================================================

const PRODUCTS_SCHEMA = [
  { name: 'id', type: 'INT64', mode: 'REQUIRED' as const },
  { name: 'item_name', type: 'STRING', mode: 'REQUIRED' as const },
  { name: 'brand', type: 'STRING', mode: 'NULLABLE' as const },
  { name: 'price', type: 'FLOAT64', mode: 'NULLABLE' as const },
  { name: 'price_raw', type: 'STRING', mode: 'NULLABLE' as const },
  { name: 'original_price', type: 'FLOAT64', mode: 'NULLABLE' as const },
  { name: 'currency', type: 'STRING', mode: 'NULLABLE' as const },
  { name: 'domain', type: 'STRING', mode: 'NULLABLE' as const },
  { name: 'category', type: 'STRING', mode: 'NULLABLE' as const },
  { name: 'country', type: 'STRING', mode: 'NULLABLE' as const },
  { name: 'competitor_type', type: 'STRING', mode: 'NULLABLE' as const },
  { name: 'product_url', type: 'STRING', mode: 'NULLABLE' as const },
  { name: 'image_url', type: 'STRING', mode: 'NULLABLE' as const },
  { name: 'source_url', type: 'STRING', mode: 'NULLABLE' as const },
  { name: 'scraped_at', type: 'TIMESTAMP', mode: 'REQUIRED' as const },
];

// ============================================================================
// BIGQUERY SERVICE CLASS
// ============================================================================

export class BigQueryService {
  private client: BigQuery;
  private datasetId: string;
  private tableId: string;
  private projectId: string;
  private initialized: boolean = false;
  public readonly isEnabled: boolean;

  constructor() {
    // Load credentials from JSON file
    const credentialsPath = path.join(process.cwd(), 'ai-commerce-lab-27bbf11522d0.json');

    if (!fs.existsSync(credentialsPath)) {
      console.warn('[BigQuery] Credentials file not found:', credentialsPath);
      this.isEnabled = false;
      this.client = null as unknown as BigQuery;
      this.datasetId = '';
      this.tableId = '';
      this.projectId = '';
      return;
    }

    try {
      const credentialsJson = fs.readFileSync(credentialsPath, 'utf-8');
      const credentials: BigQueryCredentials = JSON.parse(credentialsJson);

      this.projectId = credentials.project_id;
      this.datasetId = process.env.BIGQUERY_DATASET || 'web_scraper';
      this.tableId = process.env.BIGQUERY_TABLE || 'products';

      this.client = new BigQuery({
        projectId: this.projectId,
        credentials: credentials,
      });

      this.isEnabled = true;
      console.log(`[BigQuery] Service initialized for project: ${this.projectId}`);
    } catch (error) {
      console.error('[BigQuery] Failed to initialize:', error);
      this.isEnabled = false;
      this.client = null as unknown as BigQuery;
      this.datasetId = '';
      this.tableId = '';
      this.projectId = '';
    }
  }

  /**
   * Ensure the dataset and table exist, creating them if necessary
   */
  async ensureTableExists(): Promise<void> {
    if (!this.isEnabled || this.initialized) return;

    try {
      // Check/create dataset
      const dataset = this.client.dataset(this.datasetId);
      const [datasetExists] = await dataset.exists();

      if (!datasetExists) {
        console.log(`[BigQuery] Creating dataset: ${this.datasetId}`);
        await this.client.createDataset(this.datasetId, {
          location: 'EU', // Use EU for GDPR compliance
        });
      }

      // Check/create table
      const table = dataset.table(this.tableId);
      const [tableExists] = await table.exists();

      if (!tableExists) {
        console.log(`[BigQuery] Creating table: ${this.tableId}`);
        await dataset.createTable(this.tableId, {
          schema: PRODUCTS_SCHEMA,
        });
      }

      this.initialized = true;
      console.log(`[BigQuery] Table ready: ${this.projectId}.${this.datasetId}.${this.tableId}`);
    } catch (error) {
      console.error('[BigQuery] Failed to ensure table exists:', error);
      throw error;
    }
  }

  /**
   * Get the fully qualified table name
   */
  private getTableRef(): string {
    return `\`${this.projectId}.${this.datasetId}.${this.tableId}\``;
  }

  /**
   * Insert products into BigQuery
   */
  async insertProducts(products: ProductInput[]): Promise<{ count: number }> {
    if (!this.isEnabled) {
      throw new Error('BigQuery service is not enabled');
    }

    await this.ensureTableExists();

    if (products.length === 0) {
      return { count: 0 };
    }

    try {
      // Generate unique IDs based on timestamp and random component
      const baseId = Date.now();
      const rows = products.map((product, index) => ({
        id: baseId + index,
        item_name: product.item_name || '',
        brand: product.brand || null,
        price: product.price ?? null,
        price_raw: product.price_raw || null,
        original_price: product.original_price ?? null,
        currency: product.currency || null,
        domain: product.domain || null,
        category: product.category || null,
        country: product.country || null,
        competitor_type: product.competitor_type || null,
        product_url: product.product_url || null,
        image_url: product.image_url || null,
        source_url: product.source_url || null,
        scraped_at: product.scraped_at || new Date().toISOString(),
      }));

      const table = this.client.dataset(this.datasetId).table(this.tableId);
      await table.insert(rows);

      console.log(`[BigQuery] Inserted ${rows.length} products`);
      return { count: rows.length };
    } catch (error: any) {
      // Handle partial insert errors
      if (error.name === 'PartialFailureError') {
        const insertedCount = products.length - (error.errors?.length || 0);
        console.warn(`[BigQuery] Partial insert: ${insertedCount}/${products.length} succeeded`);
        console.error('[BigQuery] Insert errors:', JSON.stringify(error.errors, null, 2));
        return { count: insertedCount };
      }
      console.error('[BigQuery] Insert failed:', error);
      throw error;
    }
  }

  /**
   * Query products with filters and pagination
   */
  async queryProducts(filters: ProductQueryFilters): Promise<ProductsResponse> {
    if (!this.isEnabled) {
      return { products: [], total: 0, page: 1, pageSize: 50, hasMore: false };
    }

    await this.ensureTableExists();

    const page = filters.page || 1;
    const pageSize = Math.min(filters.pageSize || 50, 200);
    const offset = (page - 1) * pageSize;

    try {
      // Build WHERE clauses
      const conditions: string[] = ['1=1'];
      const params: Record<string, any> = {};

      if (filters.country) {
        conditions.push('country = @country');
        params.country = filters.country;
      }

      if (filters.domain) {
        conditions.push('domain = @domain');
        params.domain = filters.domain;
      }

      if (filters.category) {
        conditions.push('category = @category');
        params.category = filters.category;
      }

      if (filters.search) {
        conditions.push('LOWER(item_name) LIKE @search');
        params.search = `%${filters.search.toLowerCase()}%`;
      }

      if (filters.startDate) {
        conditions.push('scraped_at >= @startDate');
        params.startDate = filters.startDate;
      }

      if (filters.endDate) {
        conditions.push('scraped_at <= @endDate');
        params.endDate = filters.endDate;
      }

      const whereClause = conditions.join(' AND ');

      // Get total count
      const countQuery = `SELECT COUNT(*) as total FROM ${this.getTableRef()} WHERE ${whereClause}`;
      const [countResult] = await this.client.query({ query: countQuery, params });
      const total = parseInt(countResult[0]?.total || '0', 10);

      // Get paginated results
      const dataQuery = `
        SELECT * FROM ${this.getTableRef()}
        WHERE ${whereClause}
        ORDER BY scraped_at DESC
        LIMIT @limit OFFSET @offset
      `;

      const [rows] = await this.client.query({
        query: dataQuery,
        params: { ...params, limit: pageSize, offset },
      });

      // Transform BigQuery rows to Product type
      const products: Product[] = rows.map((row: any) => ({
        id: row.id,
        item_name: row.item_name,
        brand: row.brand,
        price: row.price,
        price_raw: row.price_raw,
        original_price: row.original_price,
        currency: row.currency,
        domain: row.domain,
        category: row.category,
        country: row.country,
        competitor_type: row.competitor_type,
        product_url: row.product_url,
        image_url: row.image_url,
        source_url: row.source_url,
        scraped_at: row.scraped_at?.value || row.scraped_at,
      }));

      return {
        products,
        total,
        page,
        pageSize,
        hasMore: offset + products.length < total,
      };
    } catch (error) {
      console.error('[BigQuery] Query failed:', error);
      throw error;
    }
  }

  /**
   * Get aggregate statistics for products
   */
  async getProductStats(): Promise<ProductStats> {
    if (!this.isEnabled) {
      return {
        total_products: 0,
        country_count: 0,
        domain_count: 0,
        category_count: 0,
        countries: [],
        domains: [],
        categories: [],
      };
    }

    await this.ensureTableExists();

    try {
      const query = `
        SELECT
          COUNT(*) as total_products,
          COUNT(DISTINCT country) as country_count,
          COUNT(DISTINCT domain) as domain_count,
          COUNT(DISTINCT category) as category_count,
          AVG(price) as avg_price
        FROM ${this.getTableRef()}
      `;

      const [statsResult] = await this.client.query({ query });
      const stats = statsResult[0] || {};

      // Get distinct values for filters
      const [countriesResult] = await this.client.query({
        query: `SELECT DISTINCT country FROM ${this.getTableRef()} WHERE country IS NOT NULL ORDER BY country`,
      });
      const [domainsResult] = await this.client.query({
        query: `SELECT DISTINCT domain FROM ${this.getTableRef()} WHERE domain IS NOT NULL ORDER BY domain`,
      });
      const [categoriesResult] = await this.client.query({
        query: `SELECT DISTINCT category FROM ${this.getTableRef()} WHERE category IS NOT NULL ORDER BY category`,
      });

      return {
        total_products: parseInt(stats.total_products || '0', 10),
        country_count: parseInt(stats.country_count || '0', 10),
        domain_count: parseInt(stats.domain_count || '0', 10),
        category_count: parseInt(stats.category_count || '0', 10),
        avg_price: stats.avg_price ? parseFloat(stats.avg_price) : undefined,
        countries: countriesResult.map((r: any) => r.country),
        domains: domainsResult.map((r: any) => r.domain),
        categories: categoriesResult.map((r: any) => r.category),
      };
    } catch (error) {
      console.error('[BigQuery] Stats query failed:', error);
      throw error;
    }
  }

  /**
   * Delete products with optional filters
   */
  async deleteProducts(filters?: { country?: string; domain?: string }): Promise<{ deleted: number }> {
    if (!this.isEnabled) {
      throw new Error('BigQuery service is not enabled');
    }

    await this.ensureTableExists();

    try {
      // Build WHERE clause
      const conditions: string[] = [];
      const params: Record<string, any> = {};

      if (filters?.country) {
        conditions.push('country = @country');
        params.country = filters.country;
      }

      if (filters?.domain) {
        conditions.push('domain = @domain');
        params.domain = filters.domain;
      }

      // First get count of rows to delete
      // BigQuery requires WHERE clause for DELETE, use WHERE TRUE to delete all
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : 'WHERE TRUE';
      const countQuery = `SELECT COUNT(*) as count FROM ${this.getTableRef()} ${whereClause}`;
      const [countResult] = await this.client.query({ query: countQuery, params });
      const countToDelete = parseInt(countResult[0]?.count || '0', 10);

      if (countToDelete === 0) {
        return { deleted: 0 };
      }

      // Execute delete
      const deleteQuery = `DELETE FROM ${this.getTableRef()} ${whereClause}`;
      await this.client.query({ query: deleteQuery, params });

      console.log(`[BigQuery] Deleted ${countToDelete} products`);
      return { deleted: countToDelete };
    } catch (error) {
      console.error('[BigQuery] Delete failed:', error);
      throw error;
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let instance: BigQueryService | null = null;

export function getBigQueryService(): BigQueryService {
  if (!instance) {
    instance = new BigQueryService();
  }
  return instance;
}
