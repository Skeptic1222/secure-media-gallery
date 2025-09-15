import sharp from 'sharp';
import crypto from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { storage } from '../storage';
import { cryptoService } from './cryptoService';
import type { InsertMediaFile } from '@shared/schema';

export interface MediaProcessingOptions {
  generateThumbnail?: boolean;
  thumbnailSize?: number;
  encryptContent?: boolean;
  encryptionKey?: string;
  vaultPassphrase?: string;
  categoryId?: string;
}

export interface MediaUploadResult {
  id: string;
  sha256Hash: string;
  isDuplicate: boolean;
  thumbnailGenerated: boolean;
}

export class MediaService {
  private ffmpegAvailable: boolean | null = null;

  private async checkFFmpegAvailability(): Promise<boolean> {
    if (this.ffmpegAvailable !== null) {
      return this.ffmpegAvailable;
    }

    try {
      // Test both ffmpeg and ffprobe binaries
      await Promise.all([
        this.testBinary('ffmpeg'),
        this.testBinary('ffprobe')
      ]);
      
      console.log('FFmpeg and FFprobe are available and working');
      this.ffmpegAvailable = true;
      return true;
    } catch (error) {
      console.warn('FFmpeg/FFprobe not available:', error);
      this.ffmpegAvailable = false;
      return false;
    }
  }

  private async testBinary(binaryName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn(binaryName, ['-version'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let outputReceived = false;

      process.stdout.on('data', () => {
        outputReceived = true;
      });

      process.stderr.on('data', () => {
        outputReceived = true;
      });

      process.on('close', (code) => {
        if (code === 0 && outputReceived) {
          resolve();
        } else {
          reject(new Error(`${binaryName} process exited with code ${code} or no output received`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Failed to spawn ${binaryName}: ${error.message}`));
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        process.kill();
        reject(new Error(`${binaryName} version check timed out`));
      }, 5000);
    });
  }
  async processFile(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    uploadedBy: string,
    options: MediaProcessingOptions = {}
  ): Promise<MediaUploadResult> {
    const {
      generateThumbnail = true,
      thumbnailSize = 300,
      encryptContent = false,
      encryptionKey,
      vaultPassphrase,
      categoryId
    } = options;

    // Generate SHA-256 hash for duplicate detection
    const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');

    // Check for duplicates (scoped to user to prevent cross-tenant access)
    const existingFile = await storage.getMediaFileByHash(sha256Hash, uploadedBy);
    if (existingFile) {
      return {
        id: existingFile.id,
        sha256Hash,
        isDuplicate: true,
        thumbnailGenerated: false,
      };
    }

    let processedBuffer = buffer;
    let thumbnailData: Buffer | undefined;
    let width: number | undefined;
    let height: number | undefined;
    let duration: number | undefined;

    // Process based on media type
    if (mimeType.startsWith('image/')) {
      const image = sharp(buffer);
      const metadata = await image.metadata();
      width = metadata.width;
      height = metadata.height;

      // Generate thumbnail
      if (generateThumbnail) {
        thumbnailData = await image
          .resize(thumbnailSize, thumbnailSize, { 
            fit: 'cover',
            withoutEnlargement: true 
          })
          .jpeg({ quality: 85 })
          .toBuffer();
      }
    } else if (mimeType.startsWith('video/')) {
      // Process video using ffmpeg with graceful fallback
      const ffmpegAvailable = await this.checkFFmpegAvailability();
      if (ffmpegAvailable) {
        try {
          const videoResult = await this.processVideo(buffer, generateThumbnail, thumbnailSize);
          duration = videoResult.duration;
          width = videoResult.width;
          height = videoResult.height;
          thumbnailData = videoResult.thumbnail;
        } catch (error) {
          console.warn('Video processing failed, proceeding without metadata:', error);
          // Fallback: proceed without video metadata or thumbnail
        }
      } else {
        console.warn('FFmpeg not available, proceeding without video processing');
        // Fallback: proceed without video metadata or thumbnail
      }
    }

    // Encrypt content if requested
    let encryptedKey: string | undefined;
    if (encryptContent && encryptionKey && vaultPassphrase) {
      // Validate that vault is set up
      const user = await storage.getUser(uploadedBy);
      if (!user?.vaultPassphrase) {
        throw new Error('User vault must be set up before encrypting content');
      }

      processedBuffer = cryptoService.encryptBuffer(buffer, encryptionKey);
      
      // CRITICAL FIX: Use the raw vault passphrase (not the stored hash) for key wrapping
      // This fixes the severe security flaw where the hash was used for encryption
      encryptedKey = cryptoService.encryptString(encryptionKey, vaultPassphrase);
      
      if (thumbnailData) {
        thumbnailData = cryptoService.encryptBuffer(thumbnailData, encryptionKey);
      }
    } else if (encryptContent && !vaultPassphrase) {
      throw new Error('Vault passphrase is required for encrypted content');
    }

    // Create media file record
    const fileData: Omit<InsertMediaFile, 'uploadedBy'> & { uploadedBy: string } = {
      filename: this.generateUniqueFilename(originalName),
      originalName,
      mimeType,
      fileSize: buffer.length,
      sha256Hash,
      binaryData: processedBuffer,
      width,
      height,
      duration,
      thumbnailData,
      isEncrypted: encryptContent,
      encryptionKey: encryptedKey,
      categoryId,
      uploadedBy,
    };

    let mediaFile;
    try {
      mediaFile = await storage.createMediaFile(fileData);
    } catch (error) {
      const err = error as Error;
      // Handle race condition where another concurrent upload created the same file
      if (err.message.includes('unique_violation') || err.message.includes('duplicate key') || err.message.includes('UNIQUE constraint')) {
        // Re-fetch the existing file by hash
        const existingFile = await storage.getMediaFileByHash(sha256Hash, uploadedBy);
        if (existingFile) {
          return {
            id: existingFile.id,
            sha256Hash,
            isDuplicate: true,
            thumbnailGenerated: false,
          };
        }
      }
      // Re-throw other errors
      throw error;
    }

    return {
      id: mediaFile.id,
      sha256Hash,
      isDuplicate: false,
      thumbnailGenerated: !!thumbnailData,
    };
  }

  async getMediaContent(id: string, requestingUserId: string, decrypt = false, vaultPassphrase?: string): Promise<{
    buffer: Buffer;
    mimeType: string;
    filename: string;
  } | null> {
    const mediaFile = await storage.getMediaFile(id);
    if (!mediaFile) return null;

    // SECURITY: Verify ownership to prevent IDOR/BOLA attacks
    if (mediaFile.uploadedBy !== requestingUserId) {
      throw new Error('Access denied: You do not own this media file');
    }

    let buffer = Buffer.from(mediaFile.binaryData);

    // Decrypt if necessary
    if (mediaFile.isEncrypted && decrypt && vaultPassphrase) {
      try {
        // Unwrap the encryption key using the vault passphrase
        if (!mediaFile.encryptionKey) {
          throw new Error('Encrypted content missing encryption key');
        }
        
        const unwrappedKey = cryptoService.decryptString(mediaFile.encryptionKey, vaultPassphrase);
        buffer = cryptoService.decryptBuffer(buffer, unwrappedKey);
      } catch (error) {
        throw new Error('Invalid vault passphrase or corrupted encryption data');
      }
    } else if (mediaFile.isEncrypted && !decrypt) {
      throw new Error('Content is encrypted and requires decryption');
    }

    return {
      buffer,
      mimeType: mediaFile.mimeType,
      filename: mediaFile.originalName,
    };
  }

  async getThumbnail(id: string, requestingUserId: string, decrypt = false, vaultPassphrase?: string): Promise<Buffer | null> {
    const mediaFile = await storage.getMediaFile(id);
    if (!mediaFile || !mediaFile.thumbnailData) return null;

    // SECURITY: Verify ownership to prevent IDOR/BOLA attacks
    if (mediaFile.uploadedBy !== requestingUserId) {
      throw new Error('Access denied: You do not own this media file');
    }

    let buffer = Buffer.from(mediaFile.thumbnailData);

    // Decrypt thumbnail if necessary
    if (mediaFile.isEncrypted && decrypt && vaultPassphrase) {
      try {
        // Unwrap the encryption key using the vault passphrase
        if (!mediaFile.encryptionKey) {
          throw new Error('Encrypted content missing encryption key');
        }
        
        const unwrappedKey = cryptoService.decryptString(mediaFile.encryptionKey, vaultPassphrase);
        buffer = cryptoService.decryptBuffer(buffer, unwrappedKey);
      } catch (error) {
        throw new Error('Invalid vault passphrase for thumbnail decryption');
      }
    } else if (mediaFile.isEncrypted && !decrypt) {
      // Return a placeholder for encrypted content
      return sharp({
        create: {
          width: 300,
          height: 300,
          channels: 3,
          background: { r: 50, g: 50, b: 50 }
        }
      }).jpeg().toBuffer();
    }

    return buffer;
  }

  async moveToCategory(fileId: string, categoryId: string): Promise<boolean> {
    const updated = await storage.updateMediaFile(fileId, { categoryId });
    return !!updated;
  }

  async addTags(fileId: string, tags: string[]): Promise<boolean> {
    const mediaFile = await storage.getMediaFile(fileId);
    if (!mediaFile) return false;

    const existingTags = mediaFile.tags || [];
    const newTags = Array.from(new Set([...existingTags, ...tags]));
    
    const updated = await storage.updateMediaFile(fileId, { tags: newTags });
    return !!updated;
  }

  async removeTags(fileId: string, tags: string[]): Promise<boolean> {
    const mediaFile = await storage.getMediaFile(fileId);
    if (!mediaFile) return false;

    const existingTags = mediaFile.tags || [];
    const newTags = existingTags.filter(tag => !tags.includes(tag));
    
    const updated = await storage.updateMediaFile(fileId, { tags: newTags });
    return !!updated;
  }

  async toggleFavorite(fileId: string): Promise<boolean> {
    const mediaFile = await storage.getMediaFile(fileId);
    if (!mediaFile) return false;

    const updated = await storage.updateMediaFile(fileId, { 
      isFavorite: !mediaFile.isFavorite 
    });
    return !!updated;
  }

  private async processVideo(buffer: Buffer, generateThumbnail: boolean, thumbnailSize: number): Promise<{
    duration?: number;
    width?: number;
    height?: number;
    thumbnail?: Buffer;
  }> {
    // Create temporary file for ffmpeg processing
    const tempDir = os.tmpdir();
    const tempVideoPath = path.join(tempDir, `video_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.tmp`);
    const tempThumbnailPath = path.join(tempDir, `thumb_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.jpg`);

    try {
      // Write buffer to temporary file
      await fs.writeFile(tempVideoPath, buffer);

      // Extract video metadata and generate thumbnail
      return await new Promise((resolve, reject) => {
        const command = ffmpeg(tempVideoPath);
        
        let duration: number | undefined;
        let width: number | undefined;
        let height: number | undefined;

        // Get video metadata
        command.ffprobe((err, metadata) => {
          if (err) {
            console.error('FFprobe error:', err);
            return reject(err);
          }

          try {
            // Extract duration and dimensions
            const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
            if (videoStream) {
              // Handle duration parsing with proper fallback for "N/A" values
              let parsedDuration = videoStream.duration ? Number(videoStream.duration) : NaN;
              if (!Number.isFinite(parsedDuration)) {
                // Fallback to format duration if stream duration is invalid
                parsedDuration = metadata.format?.duration ? Number(metadata.format.duration) : NaN;
              }
              duration = Number.isFinite(parsedDuration) ? Math.round(parsedDuration) : undefined;
              
              width = videoStream.width;
              height = videoStream.height;
            }

            if (!generateThumbnail) {
              return resolve({ duration, width, height });
            }

            // Generate thumbnail at 1 second mark
            command
              .seekInput(1) // Seek to 1 second
              .frames(1) // Extract 1 frame
              .size(`${thumbnailSize}x${thumbnailSize}`)
              .aspect('1:1')
              .output(tempThumbnailPath)
              .on('end', async () => {
                try {
                  // Read thumbnail and process with Sharp for better quality
                  const thumbnailBuffer = await fs.readFile(tempThumbnailPath);
                  const processedThumbnail = await sharp(thumbnailBuffer)
                    .resize(thumbnailSize, thumbnailSize, { 
                      fit: 'cover',
                      withoutEnlargement: true 
                    })
                    .jpeg({ quality: 85 })
                    .toBuffer();

                  resolve({
                    duration,
                    width,
                    height,
                    thumbnail: processedThumbnail,
                  });
                } catch (thumbnailError) {
                  console.error('Thumbnail processing error:', thumbnailError);
                  resolve({ duration, width, height });
                } finally {
                  // Cleanup thumbnail file
                  try {
                    await fs.unlink(tempThumbnailPath);
                  } catch {}
                }
              })
              .on('error', (thumbnailError) => {
                console.error('FFmpeg thumbnail generation error:', thumbnailError);
                // Return metadata without thumbnail if thumbnail generation fails
                resolve({ duration, width, height });
              })
              .run();
          } catch (metadataError) {
            console.error('Metadata processing error:', metadataError);
            reject(metadataError);
          }
        });
      });
    } catch (error) {
      console.error('Video processing error:', error);
      throw error;
    } finally {
      // Cleanup temporary video file
      try {
        await fs.unlink(tempVideoPath);
      } catch {}
    }
  }

  private generateUniqueFilename(originalName: string): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    const ext = originalName.split('.').pop();
    return `${timestamp}_${random}.${ext}`;
  }

  async validateHashIntegrity(fileId: string): Promise<boolean> {
    const mediaFile = await storage.getMediaFile(fileId);
    if (!mediaFile) return false;

    const buffer = Buffer.from(mediaFile.binaryData);
    const currentHash = crypto.createHash('sha256').update(buffer).digest('hex');
    
    return currentHash === mediaFile.sha256Hash;
  }

  async regenerateThumbnail(fileId: string): Promise<boolean> {
    const mediaFile = await storage.getMediaFile(fileId);
    if (!mediaFile || !mediaFile.mimeType.startsWith('image/')) return false;

    try {
      const buffer = Buffer.from(mediaFile.binaryData);
      let imageBuffer = buffer;

      // Decrypt if necessary (would need decryption key)
      if (mediaFile.isEncrypted) {
        throw new Error('Cannot regenerate thumbnail for encrypted content without decryption key');
      }

      const thumbnailData = await sharp(imageBuffer)
        .resize(300, 300, { 
          fit: 'cover',
          withoutEnlargement: true 
        })
        .jpeg({ quality: 85 })
        .toBuffer();

      const updated = await storage.updateMediaFile(fileId, { thumbnailData });
      return !!updated;
    } catch (error) {
      console.error('Error regenerating thumbnail:', error);
      return false;
    }
  }
}

export const mediaService = new MediaService();
