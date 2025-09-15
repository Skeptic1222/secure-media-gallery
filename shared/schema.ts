import { sql, relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  text,
  integer,
  boolean,
  uuid,
  customType,
  unique,
} from "drizzle-orm/pg-core";

// Custom bytea type for binary data storage
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return 'bytea';
  },
  toDriver(value: Buffer) {
    return value;
  },
  fromDriver(value: unknown) {
    return value as Buffer;
  },
});
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table (mandatory for Replit Auth)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table (mandatory for Replit Auth)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: varchar("role").default("user"), // user, admin
  vaultPassphrase: varchar("vault_passphrase"), // encrypted vault access
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Categories table for hierarchical organization
export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).unique().notNull(),
  description: text("description"),
  parentId: uuid("parent_id"),
  icon: varchar("icon", { length: 50 }),
  isVault: boolean("is_vault").default(false),
  sortOrder: integer("sort_order").default(0),
  // Enhanced metadata fields
  location: varchar("location", { length: 500 }), // e.g., "Germany", "Berlin, Germany"
  eventDate: timestamp("event_date"), // Date of the event/trip
  dateRange: varchar("date_range", { length: 100 }), // e.g., "July 2023" or "2023-07-01 to 2023-07-14"
  tags: text("tags").array(), // Additional tags like ["vacation", "family", "europe"]
  metadata: jsonb("metadata"), // Flexible JSON storage for additional details
  color: varchar("color", { length: 7 }).default("#6b7280"), // Hex color for UI organization
  folderPath: varchar("folder_path", { length: 1000 }), // Original folder path from import
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Media files table with binary storage
export const mediaFiles = pgTable("media_files", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  filename: varchar("filename", { length: 500 }).notNull(),
  originalName: varchar("original_name", { length: 500 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  fileSize: integer("file_size").notNull(),
  sha256Hash: varchar("sha256_hash", { length: 64 }).notNull(),
  binaryData: bytea("binary_data").notNull(),
  width: integer("width"),
  height: integer("height"),
  duration: integer("duration"), // for videos in seconds
  thumbnailData: bytea("thumbnail_data"),
  metadata: jsonb("metadata"), // EXIF, location, etc.
  isEncrypted: boolean("is_encrypted").default(false),
  encryptionKey: varchar("encryption_key"), // encrypted with vault passphrase
  categoryId: uuid("category_id"),
  uploadedBy: varchar("uploaded_by").notNull(),
  importSource: varchar("import_source"), // google_photos, manual, etc.
  tags: text("tags").array(),
  isFavorite: boolean("is_favorite").default(false),
  isDeleted: boolean("is_deleted").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_media_files_sha256").on(table.sha256Hash),
  index("idx_media_files_category").on(table.categoryId),
  index("idx_media_files_uploaded_by").on(table.uploadedBy),
  index("idx_media_files_created_at").on(table.createdAt),
  unique("unique_media_files_sha256_uploaded_by").on(table.sha256Hash, table.uploadedBy),
]);

// Import batches for tracking Google Photos imports
export const importBatches = pgTable("import_batches", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  source: varchar("source", { length: 50 }).notNull(), // google_photos, manual
  status: varchar("status", { length: 20 }).default("pending"), // pending, processing, completed, failed
  totalFiles: integer("total_files").default(0),
  processedFiles: integer("processed_files").default(0),
  duplicatesFound: integer("duplicates_found").default(0),
  errors: jsonb("errors"),
  settings: jsonb("settings"), // import configuration
  userId: varchar("user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User activity logs for security auditing
export const activityLogs = pgTable("activity_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  action: varchar("action", { length: 100 }).notNull(),
  resource: varchar("resource", { length: 100 }),
  resourceId: varchar("resource_id"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  mediaFiles: many(mediaFiles),
  importBatches: many(importBatches),
  activityLogs: many(activityLogs),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
  }),
  children: many(categories),
  mediaFiles: many(mediaFiles),
}));

export const mediaFilesRelations = relations(mediaFiles, ({ one }) => ({
  category: one(categories, {
    fields: [mediaFiles.categoryId],
    references: [categories.id],
  }),
  uploader: one(users, {
    fields: [mediaFiles.uploadedBy],
    references: [users.id],
  }),
}));

export const importBatchesRelations = relations(importBatches, ({ one }) => ({
  user: one(users, {
    fields: [importBatches.userId],
    references: [users.id],
  }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  user: one(users, {
    fields: [activityLogs.userId],
    references: [users.id],
  }),
}));

// Zod schemas
export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  firstName: true,
  lastName: true,
  profileImageUrl: true,
  role: true,
  vaultPassphrase: true,
});

export const insertCategorySchema = createInsertSchema(categories).pick({
  name: true,
  slug: true,
  description: true,
  parentId: true,
  icon: true,
  isVault: true,
  sortOrder: true,
  location: true,
  eventDate: true,
  dateRange: true,
  tags: true,
  metadata: true,
  color: true,
  folderPath: true,
});

export const insertMediaFileSchema = createInsertSchema(mediaFiles).pick({
  filename: true,
  originalName: true,
  mimeType: true,
  fileSize: true,
  sha256Hash: true,
  binaryData: true,
  width: true,
  height: true,
  duration: true,
  thumbnailData: true,
  metadata: true,
  isEncrypted: true,
  encryptionKey: true,
  categoryId: true,
  uploadedBy: true,
  importSource: true,
  tags: true,
});

export const insertImportBatchSchema = createInsertSchema(importBatches).pick({
  source: true,
  totalFiles: true,
  settings: true,
});

export const insertActivityLogSchema = createInsertSchema(activityLogs).pick({
  action: true,
  resource: true,
  resourceId: true,
  ipAddress: true,
  userAgent: true,
  metadata: true,
});

// Types
export type UpsertUser = z.infer<typeof insertUserSchema> & { id: string };
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Category = typeof categories.$inferSelect;
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type MediaFile = typeof mediaFiles.$inferSelect;
export type InsertMediaFile = z.infer<typeof insertMediaFileSchema>;
export type ImportBatch = typeof importBatches.$inferSelect;
export type InsertImportBatch = z.infer<typeof insertImportBatchSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
