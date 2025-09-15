import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import { promises as fsPromises } from "fs";
import crypto from "crypto";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { mediaService } from "./services/mediaService";
import { cryptoService } from "./services/cryptoService";
import { folderImportService } from "./services/folderImportService";
import { insertCategorySchema, insertMediaFileSchema } from "@shared/schema";
import { z } from "zod";

// In-memory store for vault access tokens (in production, use Redis or similar)
const vaultTokenStore = new Map<string, { userId: string; passphrase: string; expiresAt: number }>();

// Clean up expired tokens every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of Array.from(vaultTokenStore.entries())) {
    if (now > data.expiresAt) {
      vaultTokenStore.delete(token);
    }
  }
}, 5 * 60 * 1000);

// Upload request validation schema
const uploadRequestSchema = z.object({
  categoryId: z.string().uuid("Invalid category ID format").optional(),
  encryptContent: z.enum(['true', 'false']).default('false'),
  preserveDirectoryStructure: z.enum(['true', 'false']).default('false'),
  createCategories: z.enum(['true', 'false']).default('false'),
}).catchall(z.string()); // Allow relativePath_N parameters

// UUID validation helper
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// SECURITY: Filename sanitization to prevent path traversal attacks
function sanitizeFilename(originalname: string): string {
  // First, use path.basename to remove any directory traversal attempts
  let filename = path.basename(originalname);
  
  // Remove any remaining path separators and dangerous characters
  filename = filename.replace(/[\\\/:*?"<>|]/g, '_');
  
  // Remove leading dots to prevent hidden files
  filename = filename.replace(/^\.+/, '');
  
  // Ensure filename is not empty and has reasonable length
  if (!filename || filename.length === 0) {
    filename = 'unnamed_file';
  }
  
  // Truncate if too long (keep extension)
  if (filename.length > 100) {
    const ext = path.extname(filename);
    const name = path.basename(filename, ext);
    filename = name.substring(0, 100 - ext.length) + ext;
  }
  
  return filename;
}

// Helper function to extract vault token from Authorization header
function extractVaultToken(req: any): string | null {
  const authHeader = req.get('Authorization');
  if (!authHeader) return null;
  
  const match = authHeader.match(/^Bearer vault:(.+)$/);
  return match ? match[1] : null;
}

// Helper function to get vault passphrase from token with user binding validation
function getVaultPassphrase(token: string, requestingUserId: string): string | null {
  const tokenData = vaultTokenStore.get(token);
  if (!tokenData || Date.now() > tokenData.expiresAt) {
    if (tokenData) vaultTokenStore.delete(token);
    return null;
  }
  
  // SECURITY: Verify the token belongs to the requesting user
  if (tokenData.userId !== requestingUserId) {
    throw new Error('Vault token does not belong to the requesting user');
  }
  
  return tokenData.passphrase;
}

// Configure multer for file uploads with disk storage to prevent memory exhaustion
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(process.cwd(), 'uploads', 'temp');
      fs.mkdirSync(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      // SECURITY: Sanitize filename to prevent path traversal attacks
      const sanitizedName = sanitizeFilename(file.originalname);
      const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}-${sanitizedName}`;
      cb(null, uniqueName);
    }
  }),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow images and videos, skip other files (don't reject entire upload)
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      // Skip non-media files silently instead of rejecting entire upload
      console.log(`Skipping non-media file: ${file.originalname} (${file.mimetype})`);
      cb(null, false);
    }
  },
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      const err = error as Error;
      console.error("Error fetching user:", err);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Media file routes
  app.get('/api/media', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const {
        categoryId,
        isVault = 'false',
        limit = '20',
        offset = '0',
        search,
        sortBy = 'created_at',
        sortOrder = 'desc'
      } = req.query;

      // Validate categoryId if provided
      if (categoryId && !isValidUUID(categoryId as string)) {
        return res.status(400).json({ message: 'Invalid category ID format' });
      }

      const options = {
        categoryId: categoryId as string,
        isVault: isVault === 'true',
        userId,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        search: search as string,
        sortBy: sortBy as 'created_at' | 'filename' | 'file_size',
        sortOrder: sortOrder as 'asc' | 'desc',
      };

      const result = await storage.getMediaFiles(options);
      
      // Log activity
      await storage.logActivity({
        userId,
        action: 'VIEW_MEDIA',
        resource: 'media_files',
        metadata: { query: req.query },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      res.json(result);
    } catch (error) {
      const err = error as Error;
      console.error("Error fetching media files:", err);
      res.status(500).json({ message: "Failed to fetch media files" });
    }
  });

  app.get('/api/media/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { id } = req.params;
      const { decrypt = 'false' } = req.query;

      // Validate UUID format
      if (!isValidUUID(id)) {
        return res.status(404).json({ message: 'Media file not found' });
      }

      // Get vault passphrase from Authorization header if decryption is requested
      let vaultPassphrase: string | null = null;
      if (decrypt === 'true') {
        const vaultToken = extractVaultToken(req);
        if (!vaultToken) {
          return res.status(401).json({ message: 'Vault authorization token required for encrypted content' });
        }
        
        vaultPassphrase = getVaultPassphrase(vaultToken, userId);
        if (!vaultPassphrase) {
          return res.status(401).json({ message: 'Invalid or expired vault token' });
        }
      }

      const content = await mediaService.getMediaContent(
        id,
        userId,
        decrypt === 'true',
        vaultPassphrase || undefined
      );

      if (!content) {
        return res.status(404).json({ message: 'Media file not found' });
      }

      // Log activity
      await storage.logActivity({
        userId,
        action: 'DOWNLOAD_MEDIA',
        resource: 'media_files',
        resourceId: id,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      res.set({
        'Content-Type': content.mimeType,
        'Content-Disposition': `inline; filename="${content.filename}"`,
        'Content-Length': content.buffer.length.toString(),
      });

      res.send(content.buffer);
    } catch (error) {
      const err = error as Error;
      console.error("Error serving media file:", err);
      if (err.message.includes('Access denied')) {
        res.status(403).json({ message: err.message });
      } else if (err.message.includes('Vault token does not belong')) {
        res.status(403).json({ message: err.message });
      } else if (err.message.includes('decryption')) {
        res.status(403).json({ message: err.message });
      } else if (err.message.includes('invalid input syntax for type uuid')) {
        res.status(404).json({ message: 'Media file not found' });
      } else {
        res.status(500).json({ message: "Failed to serve media file" });
      }
    }
  });

  app.get('/api/media/:id/thumbnail', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { id } = req.params;
      const { decrypt = 'false' } = req.query;

      // Validate UUID format
      if (!isValidUUID(id)) {
        return res.status(404).json({ message: 'Thumbnail not found' });
      }

      // Get vault passphrase from Authorization header if decryption is requested
      let vaultPassphrase: string | null = null;
      if (decrypt === 'true') {
        const vaultToken = extractVaultToken(req);
        if (!vaultToken) {
          return res.status(401).json({ message: 'Vault authorization token required for encrypted content' });
        }
        
        vaultPassphrase = getVaultPassphrase(vaultToken, userId);
        if (!vaultPassphrase) {
          return res.status(401).json({ message: 'Invalid or expired vault token' });
        }
      }

      const thumbnail = await mediaService.getThumbnail(
        id,
        userId,
        decrypt === 'true',
        vaultPassphrase || undefined
      );

      if (!thumbnail) {
        return res.status(404).json({ message: 'Thumbnail not found' });
      }

      res.set({
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
      });

      res.send(thumbnail);
    } catch (error) {
      const err = error as Error;
      console.error("Error serving thumbnail:", err);
      if (err.message.includes('Access denied')) {
        res.status(403).json({ message: err.message });
      } else if (err.message.includes('Vault token does not belong')) {
        res.status(403).json({ message: err.message });
      } else if (err.message.includes('decryption')) {
        res.status(403).json({ message: err.message });
      } else if (err.message.includes('invalid input syntax for type uuid')) {
        res.status(404).json({ message: 'Thumbnail not found' });
      } else {
        res.status(500).json({ message: "Failed to serve thumbnail" });
      }
    }
  });

  app.post('/api/media/upload', isAuthenticated, upload.array('files'), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const files = req.files as Express.Multer.File[];

      if (!files || files.length === 0) {
        return res.status(400).json({ message: 'No files provided' });
      }

      // Validate request body with Zod schema  
      const validationResult = uploadRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid request data", 
          errors: validationResult.error.errors 
        });
      }

      const { categoryId, encryptContent, preserveDirectoryStructure, createCategories } = validationResult.data;

      // Get vault passphrase and auto-generate encryption key if encrypting content
      let vaultPassphrase: string | null = null;
      let encryptionKey: string | undefined;
      
      if (encryptContent === 'true') {
        const vaultToken = extractVaultToken(req);
        if (!vaultToken) {
          return res.status(401).json({ message: 'Vault authorization token required for encrypted uploads' });
        }
        
        vaultPassphrase = getVaultPassphrase(vaultToken, userId);
        if (!vaultPassphrase) {
          return res.status(401).json({ message: 'Invalid or expired vault token' });
        }
        
        // Auto-generate encryption key for this upload session
        encryptionKey = crypto.randomBytes(32).toString('hex');
      }

      const tempFilesToCleanup: string[] = [];

      try {
        // Add all temp files to cleanup list
        for (const file of files) {
          tempFilesToCleanup.push(file.path);
        }

        // Check if this is a directory upload with preserved structure
        if (preserveDirectoryStructure === 'true') {
          // Extract relative paths from request body
          const filesWithPaths = files.map((file, index) => {
            const relativePath = validationResult.data[`relativePath_${index}`] || file.originalname;
            return {
              file,
              relativePath
            };
          });

          // Use the secure folder import service to handle directory structure
          const result = await folderImportService.processUploadedFolderStructure(
            filesWithPaths,
            userId,
            {
              createCategories: createCategories === 'true',
              isVault: encryptContent === 'true',
              parentCategoryId: categoryId,
              vaultPassphrase: vaultPassphrase || undefined,
            }
          );

          // Log activity
          await storage.logActivity({
            userId,
            action: 'DIRECTORY_UPLOAD',
            resource: 'import_batches',
            resourceId: result.importBatchId,
            metadata: {
              totalFiles: result.totalFiles,
              processedFiles: result.processedFiles,
              duplicatesFound: result.duplicatesFound,
              success: result.success,
              createCategories: createCategories === 'true',
              encrypted: encryptContent === 'true'
            },
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
          });

          return res.json(result);
        } else {
          // Handle individual file uploads (existing behavior)
          const results = [];

          for (const file of files) {
            try {
              // Read file buffer from disk storage (async to prevent blocking)
              const fileBuffer = await fsPromises.readFile(file.path);
              
              const result = await mediaService.processFile(
                fileBuffer,
                file.originalname,
                file.mimetype,
                userId,
                {
                  encryptContent: encryptContent === 'true',
                  encryptionKey: encryptionKey || undefined,
                  vaultPassphrase: vaultPassphrase || undefined,
                  categoryId: categoryId || undefined,
                  generateThumbnail: true
                }
              );

              results.push(result);
              
              // Temporary file will be cleaned up in finally block
            } catch (error) {
              const err = error as Error;
              console.error(`Error processing file ${file.originalname}:`, err);
              results.push({
                originalName: file.originalname,
                error: err.message,
              });
              
              // Temporary file will be cleaned up in finally block
            }
          }

          // Log activity
          await storage.logActivity({
            userId,
            action: 'UPLOAD_MEDIA',
            resource: 'media_files',
            metadata: { 
              fileCount: files.length,
              totalSize: files.reduce((sum, f) => sum + f.size, 0),
              categoryId,
              encrypted: encryptContent === 'true'
            },
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
          });

          return res.json({ results });
        }
      } finally {
        // SECURITY: Always cleanup temporary files to prevent disk space exhaustion
        for (const tempFile of tempFilesToCleanup) {
          try {
            await fsPromises.unlink(tempFile);
          } catch (cleanupError) {
            console.error(`Failed to cleanup temp file ${tempFile}:`, cleanupError);
          }
        }
      }
    } catch (error) {
      const err = error as Error;
      console.error("Error uploading media files:", err);
      
      // Cleanup any uploaded files in case of error
      if (req.files) {
        const files = req.files as Express.Multer.File[];
        for (const file of files) {
          try {
            if (file.path) {
              await fsPromises.unlink(file.path);
            }
          } catch (cleanupError) {
            console.error(`Failed to cleanup temp file ${file.path}:`, cleanupError);
          }
        }
      }
      
      res.status(500).json({ message: "Failed to upload media files" });
    }
  });


  app.patch('/api/media/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { id } = req.params;
      const updates = req.body;

      // Validate UUID format
      if (!isValidUUID(id)) {
        return res.status(404).json({ message: 'Media file not found' });
      }

      // Validate the media file belongs to user or user is admin
      const mediaFile = await storage.getMediaFile(id);
      if (!mediaFile) {
        return res.status(404).json({ message: 'Media file not found' });
      }

      const user = await storage.getUser(userId);
      if (mediaFile.uploadedBy !== userId && user?.role !== 'admin') {
        return res.status(403).json({ message: 'Unauthorized to modify this file' });
      }

      const updated = await storage.updateMediaFile(id, updates);
      
      // Log activity
      await storage.logActivity({
        userId,
        action: 'UPDATE_MEDIA',
        resource: 'media_files',
        resourceId: id,
        metadata: { updates },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      res.json(updated);
    } catch (error) {
      const err = error as Error;
      console.error("Error updating media file:", err);
      res.status(500).json({ message: "Failed to update media file" });
    }
  });

  app.delete('/api/media/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { id } = req.params;

      // Validate UUID format
      if (!isValidUUID(id)) {
        return res.status(404).json({ message: 'Media file not found' });
      }

      // Validate the media file belongs to user or user is admin
      const mediaFile = await storage.getMediaFile(id);
      if (!mediaFile) {
        return res.status(404).json({ message: 'Media file not found' });
      }

      const user = await storage.getUser(userId);
      if (mediaFile.uploadedBy !== userId && user?.role !== 'admin') {
        return res.status(403).json({ message: 'Unauthorized to delete this file' });
      }

      const deleted = await storage.deleteMediaFile(id);
      
      // Log activity
      await storage.logActivity({
        userId,
        action: 'DELETE_MEDIA',
        resource: 'media_files',
        resourceId: id,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      res.json({ success: deleted });
    } catch (error) {
      const err = error as Error;
      console.error("Error deleting media file:", err);
      res.status(500).json({ message: "Failed to delete media file" });
    }
  });

  // Category routes
  app.get('/api/categories', isAuthenticated, async (req: any, res) => {
    try {
      const categories = await storage.getCategoryTree();
      res.json(categories);
    } catch (error) {
      const err = error as Error;
      console.error("Error fetching categories:", err);
      res.status(500).json({ message: "Failed to fetch categories" });
    }
  });

  app.post('/api/categories', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: 'Only administrators can create categories' });
      }

      const categoryData = insertCategorySchema.parse(req.body);
      const category = await storage.createCategory(categoryData);
      
      // Log activity
      await storage.logActivity({
        userId,
        action: 'CREATE_CATEGORY',
        resource: 'categories',
        resourceId: category.id,
        metadata: categoryData,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      res.json(category);
    } catch (error) {
      const err = error as Error;
      console.error("Error creating category:", err);
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid category data", errors: err.errors });
      } else {
        res.status(500).json({ message: "Failed to create category" });
      }
    }
  });

  // Statistics route
  app.get('/api/stats', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      
      // Admin gets global stats, users get their own stats
      const stats = await storage.getMediaStats(user?.role === 'admin' ? undefined : userId);
      res.json(stats);
    } catch (error) {
      const err = error as Error;
      console.error("Error fetching stats:", err);
      res.status(500).json({ message: "Failed to fetch statistics" });
    }
  });

  // Vault authentication route
  app.post('/api/vault/authenticate', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { passphrase } = req.body;

      if (!passphrase) {
        return res.status(400).json({ message: 'Passphrase is required' });
      }

      const user = await storage.getUser(userId);
      if (!user?.vaultPassphrase) {
        return res.status(404).json({ message: 'No vault configured for this user' });
      }

      // Verify passphrase
      const isValid = cryptoService.verifyPassword(passphrase, user.vaultPassphrase);
      
      // Log activity
      await storage.logActivity({
        userId,
        action: isValid ? 'VAULT_ACCESS_SUCCESS' : 'VAULT_ACCESS_FAILED',
        resource: 'vault',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      if (!isValid) {
        return res.status(401).json({ message: 'Invalid vault passphrase' });
      }

      // Generate temporary access token and store raw passphrase securely
      const accessToken = cryptoService.generateUUID();
      const expiresAt = Date.now() + 30 * 60 * 1000; // 30 minutes
      
      // Store raw passphrase with token for encryption/decryption operations
      vaultTokenStore.set(accessToken, {
        userId,
        passphrase, // Store raw passphrase, not the hash!
        expiresAt
      });
      
      res.json({ 
        success: true, 
        accessToken,
        expiresAt: new Date(expiresAt)
      });
    } catch (error) {
      const err = error as Error;
      console.error("Error authenticating vault access:", err);
      res.status(500).json({ message: "Failed to authenticate vault access" });
    }
  });

  // Set vault passphrase
  app.post('/api/vault/setup', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { passphrase } = req.body;

      if (!passphrase || passphrase.length < 8) {
        return res.status(400).json({ message: 'Passphrase must be at least 8 characters long' });
      }

      const hashedPassphrase = cryptoService.hashPassword(passphrase);
      await storage.upsertUser({ id: userId, vaultPassphrase: hashedPassphrase });
      
      // Log activity
      await storage.logActivity({
        userId,
        action: 'VAULT_SETUP',
        resource: 'vault',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      res.json({ success: true });
    } catch (error) {
      const err = error as Error;
      console.error("Error setting up vault:", err);
      res.status(500).json({ message: "Failed to setup vault" });
    }
  });

  // Activity logs route
  app.get('/api/activity', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { limit = '50' } = req.query;

      const logs = await storage.getActivityLogs(userId, parseInt(limit as string));
      res.json(logs);
    } catch (error) {
      const err = error as Error;
      console.error("Error fetching activity logs:", err);
      res.status(500).json({ message: "Failed to fetch activity logs" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
