import { useState, useRef, useEffect } from "react";
import { Play, Lock, Heart, Download, Eye, EyeOff } from "lucide-react";
import type { MediaFile } from "@shared/schema";

interface MediaGridProps {
  mediaFiles: MediaFile[];
  isLoading: boolean;
  selectedIndex: number;
  onMediaSelect: (mediaId: string, index: number) => void;
  isVaultMode?: boolean;
  decryptionKey?: string | null;
}

export default function MediaGrid({ 
  mediaFiles, 
  isLoading, 
  selectedIndex, 
  onMediaSelect, 
  isVaultMode = false,
  decryptionKey 
}: MediaGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Scroll selected item into view
    if (selectedIndex >= 0 && gridRef.current) {
      const selectedItem = gridRef.current.children[selectedIndex] as HTMLElement;
      if (selectedItem) {
        selectedItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [selectedIndex]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4" data-testid="media-grid-loading">
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={i} className="aspect-square bg-card rounded-lg border border-border animate-pulse" />
        ))}
      </div>
    );
  }

  if (mediaFiles.length === 0) {
    return (
      <div className="text-center py-12" data-testid="media-grid-empty">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
          <Eye className="w-8 h-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">No Media Found</h3>
        <p className="text-muted-foreground">
          {isVaultMode ? "No encrypted content in your vault" : "Upload some photos and videos to get started"}
        </p>
      </div>
    );
  }

  return (
    <div 
      ref={gridRef}
      className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4" 
      data-testid="media-grid"
    >
      {mediaFiles.map((file, index) => (
        <MediaGridItem
          key={file.id}
          file={file}
          index={index}
          isSelected={index === selectedIndex}
          isVaultMode={isVaultMode}
          decryptionKey={decryptionKey}
          onClick={() => onMediaSelect(file.id, index)}
        />
      ))}
    </div>
  );
}

interface MediaGridItemProps {
  file: MediaFile;
  index: number;
  isSelected: boolean;
  isVaultMode: boolean;
  decryptionKey?: string | null;
  onClick: () => void;
}

function MediaGridItem({ file, index, isSelected, isVaultMode, decryptionKey, onClick }: MediaGridItemProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [thumbnailBlobUrl, setThumbnailBlobUrl] = useState<string | null>(null);

  const isVideo = file.mimeType.startsWith('video/');
  const isEncrypted = file.isEncrypted;
  
  // Determine thumbnail URL (secure - no keys in URL)
  const getThumbnailUrl = () => {
    if (isEncrypted && isVaultMode && decryptionKey) {
      // For encrypted content, use decrypt parameter but NO key in URL
      return `/api/media/${file.id}/thumbnail?decrypt=true`;
    } else if (!isEncrypted) {
      return `/api/media/${file.id}/thumbnail`;
    }
    return null; // Will show placeholder for encrypted content without key
  };

  const thumbnailUrl = getThumbnailUrl();

  // Fetch encrypted thumbnails securely using Authorization headers
  useEffect(() => {
    if (isEncrypted && isVaultMode && decryptionKey && thumbnailUrl) {
      const fetchSecureThumbnail = async () => {
        try {
          const response = await fetch(thumbnailUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer vault:${decryptionKey}`,
            },
            credentials: 'include',
          });

          if (response.ok) {
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            setThumbnailBlobUrl(blobUrl);
            setImageLoaded(true);
          } else {
            console.error('Failed to fetch encrypted thumbnail:', response.status);
            setImageError(true);
          }
        } catch (error) {
          console.error('Error fetching encrypted thumbnail:', error);
          setImageError(true);
        }
      };

      fetchSecureThumbnail();

      // Cleanup blob URL on unmount
      return () => {
        if (thumbnailBlobUrl) {
          URL.revokeObjectURL(thumbnailBlobUrl);
        }
      };
    }
  }, [file.id, isEncrypted, isVaultMode, decryptionKey, thumbnailUrl]);

  // Use blob URL for encrypted content, regular URL for non-encrypted
  const displayUrl = isEncrypted && isVaultMode && decryptionKey ? thumbnailBlobUrl : thumbnailUrl;

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDuration = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className={`
        bg-card rounded-lg border overflow-hidden transition-all duration-300 cursor-pointer
        hover:transform hover:translate-y-[-4px] hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/20
        ${isSelected ? 'keyboard-nav-active ring-2 ring-accent ring-offset-2 ring-offset-background' : 'border-border'}
        ${isEncrypted && isVaultMode ? 'border-accent/50 shadow-sm shadow-accent/10' : ''}
      `}
      onClick={onClick}
      tabIndex={0}
      data-media-type={isVideo ? 'video' : 'image'}
      data-index={index}
      data-testid={`media-item-${index}`}
    >
      <div className="aspect-square relative">
        {displayUrl ? (
          <>
            <img
              src={displayUrl}
              alt={file.originalName}
              className={`w-full h-full object-cover transition-opacity duration-300 ${
                imageLoaded ? 'opacity-100' : 'opacity-0'
              } ${imageError ? 'hidden' : ''}`}
              onLoad={() => !isEncrypted && setImageLoaded(true)} // For encrypted, loading is handled in useEffect
              onError={() => setImageError(true)}
            />
            
            {/* Loading placeholder */}
            {!imageLoaded && !imageError && (
              <div className="w-full h-full bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center">
                <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full"></div>
              </div>
            )}
          </>
        ) : (
          /* Encrypted content placeholder */
          <div className="w-full h-full bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center">
            <div className="text-center">
              <Lock className="w-8 h-8 text-accent mx-auto mb-2" />
              <div className="text-accent text-xs font-semibold">ENCRYPTED</div>
            </div>
          </div>
        )}

        {/* Error state */}
        {imageError && (
          <div className="w-full h-full bg-muted flex items-center justify-center">
            <div className="text-center">
              <EyeOff className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <div className="text-xs text-muted-foreground">Failed to load</div>
            </div>
          </div>
        )}

        {/* Video Play Indicator */}
        {isVideo && (
          <>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-12 h-12 bg-white/90 rounded-full flex items-center justify-center shadow-lg transition-opacity hover:opacity-75">
                <Play className="w-5 h-5 text-gray-800 ml-0.5" />
              </div>
            </div>
            {/* Duration Badge */}
            {file.duration && (
              <div className="absolute top-3 left-3 px-2 py-1 bg-black/80 rounded text-white text-xs font-medium">
                {formatDuration(file.duration)}
              </div>
            )}
          </>
        )}

        {/* Vault/Encrypted Badge */}
        {isEncrypted && (
          <div className="absolute top-3 right-3 px-2 py-1 bg-accent/90 rounded text-white text-xs font-medium flex items-center gap-1">
            <Lock className="w-3 h-3" />
            {isVaultMode && decryptionKey ? 'DECRYPTED' : 'ENCRYPTED'}
          </div>
        )}

        {/* Favorite Badge */}
        {file.isFavorite && (
          <div className="absolute top-3 left-3 p-1 bg-black/50 rounded">
            <Heart className="w-4 h-4 text-red-400 fill-current" />
          </div>
        )}

        {/* Selection Indicator */}
        <div className="absolute top-3 right-3">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
            isSelected 
              ? 'bg-accent text-white' 
              : 'bg-background/80 border-2 border-white'
          }`}>
            {isSelected && <div className="w-2 h-2 bg-white rounded-full"></div>}
          </div>
        </div>

        {/* Hover Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 hover:opacity-100 transition-opacity">
          <div className="absolute bottom-3 left-3 right-3">
            <div className="text-white font-medium text-sm truncate">
              {file.originalName}
            </div>
            <div className="text-white/80 text-xs mt-1">
              {isVideo ? '🎥' : '📸'} {file.tags && file.tags.length > 0 ? file.tags[0] : 'Media'} • {formatFileSize(file.fileSize)}
              {isEncrypted && <> • AES-256</>}
            </div>
          </div>
          
          {/* Action Buttons */}
          <div className="absolute top-3 left-3 flex gap-2">
            <button
              className="p-2 bg-black/50 rounded hover:bg-black/70 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                // Toggle favorite
              }}
              title="Add to favorites"
            >
              <Heart className="w-4 h-4 text-white" />
            </button>
            <button
              className="p-2 bg-black/50 rounded hover:bg-black/70 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                // Download file
              }}
              title="Download"
            >
              <Download className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// NOTE: Encryption keys are now passed securely via Authorization headers instead of URL query strings
