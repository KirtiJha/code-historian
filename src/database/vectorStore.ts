/**
 * LanceDB Vector Store for Code Historian
 * Handles vector embeddings storage and similarity search
 */

import * as path from 'path';
import * as fs from 'fs';
import * as lancedb from '@lancedb/lancedb';
import type { Table, Connection } from '@lancedb/lancedb';
import type { VectorRecord, VectorSearchResult, SearchFilters } from '../types';
import { VECTOR_DB_DIR } from '../constants';
import { logger } from '../utils/logger';
import { generateId } from '../utils';

const VECTORS_TABLE = 'change_vectors';

export class VectorStore {
  private connection: Connection | null = null;
  private table: Table | null = null;
  private storagePath: string;
  private dbPath: string;
  private dimensions: number;

  constructor(storagePath: string, dimensions: number = 768) {
    this.storagePath = storagePath;
    this.dbPath = path.join(storagePath, VECTOR_DB_DIR);
    this.dimensions = dimensions;
  }

  /**
   * Initialize the vector store connection
   */
  async initialize(): Promise<void> {
    try {
      // Ensure storage directory exists
      if (!fs.existsSync(this.storagePath)) {
        fs.mkdirSync(this.storagePath, { recursive: true });
      }

      this.connection = await lancedb.connect(this.dbPath);
      
      // Check if table exists
      const tables = await this.connection.tableNames();
      
      if (tables.includes(VECTORS_TABLE)) {
        this.table = await this.connection.openTable(VECTORS_TABLE);
        logger.info(`Opened existing vector table: ${VECTORS_TABLE}`);
      } else {
        // Create table with initial schema
        await this.createTable();
        logger.info(`Created new vector table: ${VECTORS_TABLE}`);
      }
      
      logger.info(`Vector store initialized at ${this.dbPath}`);
    } catch (error) {
      logger.error('Failed to initialize vector store', error as Error);
      throw error;
    }
  }

  /**
   * Create the vectors table with schema
   */
  private async createTable(): Promise<void> {
    if (!this.connection) {throw new Error('Vector store not initialized');}

    // Create a sample record to define schema
    const sampleRecord = {
      id: 'sample',
      changeId: 'sample',
      vector: new Array(this.dimensions).fill(0),
      timestamp: Date.now(),
      filePath: '',
      eventType: 'modify',
      language: '',
      symbols: '',
      searchableText: '',
      summary: '',
    };

    this.table = await this.connection.createTable(VECTORS_TABLE, [sampleRecord], {
      mode: 'overwrite',
    });

    // Delete the sample record
    await this.table.delete('id = "sample"');
  }

  /**
   * Add a vector record to the store
   */
  async addVector(record: VectorRecord): Promise<string> {
    if (!this.table) {throw new Error('Vector store not initialized');}

    const id = generateId();
    
    const row = {
      id,
      changeId: record.changeId,
      vector: record.vector,
      timestamp: record.timestamp,
      filePath: record.filePath,
      eventType: record.eventType,
      language: record.language,
      symbols: record.symbols.join(','),
      searchableText: record.searchableText,
      summary: record.summary || '',
    };

    await this.table.add([row]);
    
    return id;
  }

  /**
   * Add multiple vector records in batch
   */
  async addVectors(records: VectorRecord[]): Promise<string[]> {
    if (!this.table) {throw new Error('Vector store not initialized');}

    const ids: string[] = [];
    const rows = records.map(record => {
      const id = generateId();
      ids.push(id);
      
      return {
        id,
        changeId: record.changeId,
        vector: record.vector,
        timestamp: record.timestamp,
        filePath: record.filePath,
        eventType: record.eventType,
        language: record.language,
        symbols: record.symbols.join(','),
        searchableText: record.searchableText,
        summary: record.summary || '',
      };
    });

    await this.table.add(rows);
    
    return ids;
  }

  /**
   * Search for similar vectors
   */
  async search(
    queryVector: number[],
    topK: number = 20,
    filters?: SearchFilters
  ): Promise<VectorSearchResult[]> {
    if (!this.table) {throw new Error('Vector store not initialized');}

    let query = this.table.vectorSearch(queryVector).limit(topK);

    // Apply filters using where clause
    const whereConditions: string[] = [];
    
    if (filters?.timeRange) {
      whereConditions.push(
        `timestamp >= ${filters.timeRange.start} AND timestamp <= ${filters.timeRange.end}`
      );
    }

    if (filters?.languages && filters.languages.length > 0) {
      const langs = filters.languages.map(l => `"${l}"`).join(', ');
      whereConditions.push(`language IN (${langs})`);
    }

    if (filters?.eventTypes && filters.eventTypes.length > 0) {
      const types = filters.eventTypes.map(t => `"${t}"`).join(', ');
      whereConditions.push(`eventType IN (${types})`);
    }

    if (whereConditions.length > 0) {
      query = query.where(whereConditions.join(' AND '));
    }

    const results = await query.toArray();
    
    return results.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      changeId: row.changeId as string,
      score: 1 - (row._distance as number), // Convert distance to similarity score
      distance: row._distance as number,
    }));
  }

  /**
   * Get a vector by ID
   */
  async getVector(id: string): Promise<VectorRecord | null> {
    if (!this.table) {throw new Error('Vector store not initialized');}

    const results = await this.table
      .query()
      .where(`id = "${id}"`)
      .limit(1)
      .toArray();

    if (results.length === 0) {
      return null;
    }

    const row = results[0] as Record<string, unknown>;
    return {
      id: row.id as string,
      changeId: row.changeId as string,
      vector: row.vector as number[],
      timestamp: row.timestamp as number,
      filePath: row.filePath as string,
      eventType: row.eventType as string,
      language: row.language as string,
      symbols: (row.symbols as string).split(',').filter(Boolean),
      searchableText: row.searchableText as string,
      summary: row.summary as string,
    };
  }

  /**
   * Get vector by change ID
   */
  async getVectorByChangeId(changeId: string): Promise<VectorRecord | null> {
    if (!this.table) {throw new Error('Vector store not initialized');}

    const results = await this.table
      .query()
      .where(`changeId = "${changeId}"`)
      .limit(1)
      .toArray();

    if (results.length === 0) {
      return null;
    }

    const row = results[0] as Record<string, unknown>;
    return {
      id: row.id as string,
      changeId: row.changeId as string,
      vector: row.vector as number[],
      timestamp: row.timestamp as number,
      filePath: row.filePath as string,
      eventType: row.eventType as string,
      language: row.language as string,
      symbols: (row.symbols as string).split(',').filter(Boolean),
      searchableText: row.searchableText as string,
      summary: row.summary as string,
    };
  }

  /**
   * Delete a vector by ID
   */
  async deleteVector(id: string): Promise<void> {
    if (!this.table) {throw new Error('Vector store not initialized');}
    await this.table.delete(`id = "${id}"`);
  }

  /**
   * Delete vectors by change IDs
   */
  async deleteVectorsByChangeIds(changeIds: string[]): Promise<void> {
    if (!this.table) {throw new Error('Vector store not initialized');}
    
    const ids = changeIds.map(id => `"${id}"`).join(', ');
    await this.table.delete(`changeId IN (${ids})`);
  }

  /**
   * Delete vectors older than specified timestamp
   */
  async deleteOldVectors(beforeTimestamp: number): Promise<number> {
    if (!this.table) {throw new Error('Vector store not initialized');}
    
    const countBefore = await this.table.countRows();
    await this.table.delete(`timestamp < ${beforeTimestamp}`);
    const countAfter = await this.table.countRows();
    
    return countBefore - countAfter;
  }

  /**
   * Get total count of vectors
   */
  async count(): Promise<number> {
    if (!this.table) {throw new Error('Vector store not initialized');}
    return await this.table.countRows();
  }

  /**
   * Create index for faster searches
   */
  async createIndex(): Promise<void> {
    if (!this.table) {throw new Error('Vector store not initialized');}

    const count = await this.count();
    
    // Only create IVF_PQ index if we have enough vectors
    if (count >= 256) {
      await this.table.createIndex('vector', {
        config: lancedb.Index.ivfPq({
          numPartitions: Math.min(Math.floor(Math.sqrt(count)), 256),
          numSubVectors: Math.min(Math.floor(this.dimensions / 8), 96),
        }),
      });
      logger.info(`Created IVF_PQ index with ${count} vectors`);
    }
  }

  /**
   * Optimize the vector store
   */
  async optimize(): Promise<void> {
    if (!this.table) {throw new Error('Vector store not initialized');}
    
    await this.table.optimize();
    logger.info('Vector store optimized');
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{
    vectorCount: number;
    storageSizeMB: number;
  }> {
    const vectorCount = await this.count();
    
    // Calculate storage size
    let storageSizeMB = 0;
    if (fs.existsSync(this.dbPath)) {
      const calculateSize = (dir: string): number => {
        let size = 0;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            size += calculateSize(fullPath);
          } else {
            size += fs.statSync(fullPath).size;
          }
        }
        return size;
      };
      storageSizeMB = calculateSize(this.dbPath) / (1024 * 1024);
    }

    return {
      vectorCount,
      storageSizeMB: Math.round(storageSizeMB * 100) / 100,
    };
  }

  /**
   * Clear all vectors
   */
  async clear(): Promise<void> {
    if (!this.connection) {throw new Error('Vector store not initialized');}
    
    await this.connection.dropTable(VECTORS_TABLE);
    await this.createTable();
    logger.info('Vector store cleared');
  }

  /**
   * Close the vector store connection
   */
  async close(): Promise<void> {
    this.table = null;
    this.connection = null;
    logger.info('Vector store connection closed');
  }
}
