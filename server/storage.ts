import {
  users,
  categories,
  mediaFiles,
  importBatches,
  activityLogs,
  type User,
  type UpsertUser,
  type Category,
  type InsertCategory,
  type MediaFile,
  type InsertMediaFile,
  type ImportBatch,
  type InsertImportBatch,
  type ActivityLog,
  type InsertActivityLog,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, asc, like, and, or, isNull, sql, count } from "drizzle-orm";

// Interface for storage operations
export interface IStorage {
  // User operations (mandatory for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Category operations
  getCategories(): Promise<Category[]>;
  getCategoryTree(): Promise<Category[]>;
  createCategory(category: InsertCategory): Promise<Category>;
  updateCategory(id: string, updates: Partial<Category>): Promise<Category | undefined>;
  deleteCategory(id: string): Promise<boolean>;
  
  // Media file operations
  getMediaFiles(options?: {
    categoryId?: string;
    isVault?: boolean;
    userId?: string;
    limit?: number;
    offset?: number;
    search?: string;
    sortBy?: 'created_at' | 'filename' | 'file_size';
    sortOrder?: 'asc' | 'desc';
  }): Promise<{ files: MediaFile[]; total: number }>;
  getMediaFile(id: string): Promise<MediaFile | undefined>;
  getMediaFileByHash(hash: string, userId: string): Promise<MediaFile | undefined>;
  createMediaFile(file: InsertMediaFile & { uploadedBy: string; sha256Hash: string }): Promise<MediaFile>;
  updateMediaFile(id: string, updates: Partial<MediaFile>): Promise<MediaFile | undefined>;
  deleteMediaFile(id: string): Promise<boolean>;
  getMediaStats(userId?: string): Promise<{
    totalItems: number;
    images: number;
    videos: number;
    vaultItems: number;
    storageUsed: number;
    duplicatesFound: number;
  }>;
  
  // Import batch operations
  createImportBatch(batch: InsertImportBatch & { userId: string }): Promise<ImportBatch>;
  updateImportBatch(id: string, updates: Partial<ImportBatch>): Promise<ImportBatch | undefined>;
  getImportBatch(id: string): Promise<ImportBatch | undefined>;
  getImportBatches(userId: string): Promise<ImportBatch[]>;
  
  // Activity log operations
  logActivity(log: InsertActivityLog & { userId: string }): Promise<ActivityLog>;
  getActivityLogs(userId: string, limit?: number): Promise<ActivityLog[]>;
}

export class DatabaseStorage implements IStorage {
  // User operations (mandatory for Replit Auth)
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Category validation helper
  private async validateCategoryData(categoryData: Partial<Category>, categoryId?: string): Promise<void> {
    // Check for self-parenting
    if (categoryData.parentId && categoryData.parentId === categoryId) {
      throw new Error("A category cannot be its own parent");
    }

    // Check if parent exists (if parentId is provided)
    if (categoryData.parentId) {
      const parent = await db.select().from(categories).where(eq(categories.id, categoryData.parentId));
      if (parent.length === 0) {
        throw new Error(`Parent category with id "${categoryData.parentId}" does not exist`);
      }
    }

    // Check for cycles if we're updating an existing category's parent
    if (categoryData.parentId && categoryId) {
      await this.checkForCycles(categoryId, categoryData.parentId);
    }
  }

  // Cycle detection helper
  private async checkForCycles(categoryId: string, newParentId: string): Promise<void> {
    const visited = new Set<string>();
    let currentId: string | null = newParentId;

    while (currentId) {
      if (visited.has(currentId)) {
        throw new Error("Circular reference detected: this parent assignment would create a cycle");
      }
      
      if (currentId === categoryId) {
        throw new Error("Circular reference detected: the proposed parent is a descendant of this category");
      }

      visited.add(currentId);

      // Get the parent of the current category
      const [parent] = await db.select({ parentId: categories.parentId })
        .from(categories)
        .where(eq(categories.id, currentId));
      
      currentId = parent?.parentId || null;
    }
  }

  // Category operations
  async getCategories(): Promise<Category[]> {
    return await db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name));
  }

  async getCategoryTree(): Promise<Category[]> {
    const allCategories = await this.getCategories();
    
    // Build tree structure
    const categoryMap = new Map<string, Category & { children?: Category[] }>();
    const rootCategories: (Category & { children?: Category[] })[] = [];
    
    // Initialize map
    allCategories.forEach(cat => {
      categoryMap.set(cat.id, { ...cat, children: [] });
    });
    
    // Build tree
    allCategories.forEach(cat => {
      const category = categoryMap.get(cat.id)!;
      if (cat.parentId) {
        const parent = categoryMap.get(cat.parentId);
        if (parent) {
          parent.children!.push(category);
        }
      } else {
        rootCategories.push(category);
      }
    });
    
    return rootCategories as Category[];
  }

  async createCategory(category: InsertCategory): Promise<Category> {
    // Validate the category data
    await this.validateCategoryData(category, undefined);
    
    const [newCategory] = await db.insert(categories).values(category).returning();
    return newCategory;
  }

  async updateCategory(id: string, updates: Partial<Category>): Promise<Category | undefined> {
    // Validate the update data
    await this.validateCategoryData(updates, id);
    
    const [updated] = await db
      .update(categories)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(categories.id, id))
      .returning();
    return updated;
  }

  async deleteCategory(id: string): Promise<boolean> {
    // Check if category has children
    const children = await db.select().from(categories).where(eq(categories.parentId, id));
    if (children.length > 0) {
      throw new Error(`Cannot delete category: it has ${children.length} child categories. Please move or delete child categories first.`);
    }
    
    // Check if category has media files
    const [mediaCount] = await db.select({ count: count() })
      .from(mediaFiles)
      .where(and(eq(mediaFiles.categoryId, id), eq(mediaFiles.isDeleted, false)));
    
    if (mediaCount.count > 0) {
      throw new Error(`Cannot delete category: it contains ${mediaCount.count} media files. Please move or delete the files first.`);
    }
    
    const result = await db.delete(categories).where(eq(categories.id, id));
    return result.rowCount! > 0;
  }

  // Media file operations
  async getMediaFiles(options: {
    categoryId?: string;
    isVault?: boolean;
    userId?: string;
    limit?: number;
    offset?: number;
    search?: string;
    sortBy?: 'created_at' | 'filename' | 'file_size';
    sortOrder?: 'asc' | 'desc';
  } = {}): Promise<{ files: MediaFile[]; total: number }> {
    const {
      categoryId,
      isVault = false,
      userId,
      limit = 20,
      offset = 0,
      search,
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = options;

    let query = db.select().from(mediaFiles);
    let countQuery = db.select({ count: count() }).from(mediaFiles);

    const conditions = [eq(mediaFiles.isDeleted, false)];

    if (categoryId) {
      conditions.push(eq(mediaFiles.categoryId, categoryId));
    }

    if (isVault) {
      conditions.push(eq(mediaFiles.isEncrypted, true));
    }

    if (userId) {
      conditions.push(eq(mediaFiles.uploadedBy, userId));
    }

    if (search) {
      conditions.push(
        or(
          like(mediaFiles.originalName, `%${search}%`),
          like(mediaFiles.filename, `%${search}%`),
          sql`${mediaFiles.tags} && ARRAY[${search}]`
        )!
      );
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
      countQuery = countQuery.where(and(...conditions));
    }

    // Apply sorting
    const sortColumn = sortBy === 'created_at' ? mediaFiles.createdAt 
                     : sortBy === 'filename' ? mediaFiles.filename 
                     : mediaFiles.fileSize;
    
    query = query.orderBy(sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn));

    // Apply pagination
    query = query.limit(limit).offset(offset);

    const [files, [{ count: total }]] = await Promise.all([
      query,
      countQuery
    ]);

    return { files, total };
  }

  async getMediaFile(id: string): Promise<MediaFile | undefined> {
    const [file] = await db.select().from(mediaFiles).where(eq(mediaFiles.id, id));
    return file;
  }

  async getMediaFileByHash(hash: string, userId: string): Promise<MediaFile | undefined> {
    const [file] = await db.select().from(mediaFiles).where(
      and(
        eq(mediaFiles.sha256Hash, hash),
        eq(mediaFiles.uploadedBy, userId),
        eq(mediaFiles.isDeleted, false)
      )
    );
    return file;
  }

  async createMediaFile(file: InsertMediaFile & { uploadedBy: string; sha256Hash: string }): Promise<MediaFile> {
    const [newFile] = await db.insert(mediaFiles).values(file).returning();
    return newFile;
  }

  async updateMediaFile(id: string, updates: Partial<MediaFile>): Promise<MediaFile | undefined> {
    const [updated] = await db
      .update(mediaFiles)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(mediaFiles.id, id))
      .returning();
    return updated;
  }

  async deleteMediaFile(id: string): Promise<boolean> {
    const [updated] = await db
      .update(mediaFiles)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(eq(mediaFiles.id, id))
      .returning();
    return !!updated;
  }

  async getMediaStats(userId?: string): Promise<{
    totalItems: number;
    images: number;
    videos: number;
    vaultItems: number;
    storageUsed: number;
    duplicatesFound: number;
  }> {
    const conditions = [eq(mediaFiles.isDeleted, false)];
    if (userId) {
      conditions.push(eq(mediaFiles.uploadedBy, userId));
    }

    const baseQuery = db.select().from(mediaFiles).where(and(...conditions));

    const [
      totalResult,
      imageResult,
      videoResult,
      vaultResult,
      storageSumResult,
      duplicatesResult,
    ] = await Promise.all([
      db.select({ count: count() }).from(mediaFiles).where(and(...conditions)),
      db.select({ count: count() }).from(mediaFiles).where(and(...conditions, like(mediaFiles.mimeType, 'image/%'))),
      db.select({ count: count() }).from(mediaFiles).where(and(...conditions, like(mediaFiles.mimeType, 'video/%'))),
      db.select({ count: count() }).from(mediaFiles).where(and(...conditions, eq(mediaFiles.isEncrypted, true))),
      db.select({ sum: sql<number>`sum(${mediaFiles.fileSize})` }).from(mediaFiles).where(and(...conditions)),
      db.select({ count: count() }).from(mediaFiles)
        .where(and(...conditions))
        .groupBy(mediaFiles.sha256Hash)
        .having(sql`count(*) > 1`)
    ]);

    return {
      totalItems: totalResult[0]?.count || 0,
      images: imageResult[0]?.count || 0,
      videos: videoResult[0]?.count || 0,
      vaultItems: vaultResult[0]?.count || 0,
      storageUsed: storageSumResult[0]?.sum || 0,
      duplicatesFound: duplicatesResult.length,
    };
  }

  // Import batch operations
  async createImportBatch(batch: InsertImportBatch & { userId: string }): Promise<ImportBatch> {
    const [newBatch] = await db.insert(importBatches).values(batch).returning();
    return newBatch;
  }

  async updateImportBatch(id: string, updates: Partial<ImportBatch>): Promise<ImportBatch | undefined> {
    const [updated] = await db
      .update(importBatches)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(importBatches.id, id))
      .returning();
    return updated;
  }

  async getImportBatch(id: string): Promise<ImportBatch | undefined> {
    const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, id));
    return batch;
  }

  async getImportBatches(userId: string): Promise<ImportBatch[]> {
    return await db
      .select()
      .from(importBatches)
      .where(eq(importBatches.userId, userId))
      .orderBy(desc(importBatches.createdAt));
  }

  // Activity log operations
  async logActivity(log: InsertActivityLog & { userId: string }): Promise<ActivityLog> {
    const [newLog] = await db.insert(activityLogs).values(log).returning();
    return newLog;
  }

  async getActivityLogs(userId: string, limit: number = 50): Promise<ActivityLog[]> {
    return await db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.userId, userId))
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit);
  }
}

export const storage = new DatabaseStorage();
