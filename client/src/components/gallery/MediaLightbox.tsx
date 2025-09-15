import { useState, useEffect, useCallback } from "react";
import { X, ChevronLeft, ChevronRight, Heart, Download, Share2, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MediaFile } from "@shared/schema";

interface MediaLightboxProps {
  mediaFiles: MediaFile[];
  selectedIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  decryptionKey?: string | null;
}

type ViewMode = 'fit' | 'fill' | 'actual';

export default function MediaLightbox({
  mediaFiles,
  selectedIndex,
  isOpen,
  onClose,
  onNext,
  onPrevious,
  decryptionKey
}: MediaLightboxProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('fit');
  const [isPlaying, setIsPlaying] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [rotation, setRotation] = useState(0);

  const currentFile = mediaFiles[selectedIndex];

  // Hide controls after 3 seconds of inactivity
  useEffect(() => {
    if (!showControls) return;

    const timer = setTimeout(() => {
      setShowControls(false);
    }, 3000);

    return () => clearTimeout(timer);
  }, [showControls]);

  // Reset state when opening/closing
  useEffect(() => {
    if (isOpen) {
      setViewMode('fit');
      setRotation(0);
      setIsPlaying(false);
      setShowControls(true);
    }
  }, [isOpen, selectedIndex]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isOpen) return;

    switch (e.key.toLowerCase()) {
      case 'escape':
        onClose();
        break;
      case 'arrowleft':
      case 'a':
        e.preventDefault();
        onPrevious();
        break;
      case 'arrowright':
      case 'd':
        e.preventDefault();
        onNext();
        break;
      case 'arrowdown':
      case 's':
        e.preventDefault();
        onClose();
        break;
      case ' ':
        e.preventDefault();
        if (currentFile?.mimeType.startsWith('video/')) {
          setIsPlaying(!isPlaying);
        }
        break;
      case 'f':
        e.preventDefault();
        toggleViewMode();
        break;
      case 'r':
        e.preventDefault();
        setRotation((prev) => (prev + 90) % 360);
        break;
    }
  }, [isOpen, onClose, onNext, onPrevious, currentFile, isPlaying]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'auto';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'auto';
    };
  }, [handleKeyDown, isOpen]);

  const toggleViewMode = () => {
    const modes: ViewMode[] = ['fit', 'fill', 'actual'];
    const currentIndex = modes.indexOf(viewMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    setViewMode(modes[nextIndex]);
  };

  const getMediaUrl = (file: MediaFile) => {
    if (file.isEncrypted && decryptionKey) {
      return `/api/media/${file.id}?decrypt=true&key=${btoa(decryptionKey)}`;
    } else if (!file.isEncrypted) {
      return `/api/media/${file.id}`;
    }
    return null;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  if (!isOpen || !currentFile) return null;

  const mediaUrl = getMediaUrl(currentFile);
  const isVideo = currentFile.mimeType.startsWith('video/');

  return (
    <div
      className="fixed inset-0 bg-black/95 backdrop-blur-lg z-50 flex items-center justify-center"
      onClick={() => setShowControls(true)}
      onMouseMove={() => setShowControls(true)}
      data-testid="media-lightbox"
    >
      <div className="relative max-w-full max-h-full flex items-center justify-center">
        {/* Media Content */}
        <div className={`relative transition-all duration-300 ${
          viewMode === 'fit' ? 'max-w-[90vw] max-h-[90vh]' :
          viewMode === 'fill' ? 'w-screen h-screen' : 'w-auto h-auto'
        }`}>
          {mediaUrl ? (
            isVideo ? (
              <video
                src={mediaUrl}
                className={`block transition-all duration-300 ${
                  viewMode === 'fit' ? 'max-w-full max-h-full object-contain' :
                  viewMode === 'fill' ? 'w-full h-full object-cover' : 'w-auto h-auto'
                }`}
                style={{ transform: `rotate(${rotation}deg)` }}
                controls={showControls}
                autoPlay={isPlaying}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                data-testid="lightbox-video"
              />
            ) : (
              <img
                src={mediaUrl}
                alt={currentFile.originalName}
                className={`block transition-all duration-300 ${
                  viewMode === 'fit' ? 'max-w-full max-h-full object-contain' :
                  viewMode === 'fill' ? 'w-full h-full object-cover' : 'w-auto h-auto'
                }`}
                style={{ transform: `rotate(${rotation}deg)` }}
                data-testid="lightbox-image"
              />
            )
          ) : (
            <div className="w-96 h-96 bg-muted rounded-lg flex items-center justify-center">
              <div className="text-center">
                <div className="text-4xl mb-4">🔒</div>
                <div className="text-lg font-semibold mb-2">Content Encrypted</div>
                <div className="text-sm text-muted-foreground">
                  Valid decryption key required to view this content
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Navigation Controls */}
        {showControls && mediaFiles.length > 1 && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-4 top-1/2 transform -translate-y-1/2 w-12 h-12 bg-black/50 hover:bg-black/70 text-white rounded-full"
              onClick={(e) => {
                e.stopPropagation();
                onPrevious();
              }}
              disabled={selectedIndex === 0}
              data-testid="lightbox-previous"
            >
              <ChevronLeft className="w-6 h-6" />
            </Button>
            
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-4 top-1/2 transform -translate-y-1/2 w-12 h-12 bg-black/50 hover:bg-black/70 text-white rounded-full"
              onClick={(e) => {
                e.stopPropagation();
                onNext();
              }}
              disabled={selectedIndex === mediaFiles.length - 1}
              data-testid="lightbox-next"
            >
              <ChevronRight className="w-6 h-6" />
            </Button>
          </>
        )}

        {/* Top Controls */}
        {showControls && (
          <div className="absolute top-4 right-4 flex items-center gap-2">
            {/* View Mode Controls */}
            <div className="flex bg-black/50 rounded-lg p-1">
              <Button
                variant="ghost"
                size="sm"
                className={`text-white hover:bg-white/20 ${viewMode === 'fit' ? 'bg-white/20' : ''}`}
                onClick={() => setViewMode('fit')}
                title="Fit to screen"
                data-testid="view-fit"
              >
                <ZoomOut className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={`text-white hover:bg-white/20 ${viewMode === 'fill' ? 'bg-white/20' : ''}`}
                onClick={() => setViewMode('fill')}
                title="Fill screen"
                data-testid="view-fill"
              >
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-white hover:bg-white/20"
                onClick={() => setRotation((prev) => (prev + 90) % 360)}
                title="Rotate"
                data-testid="rotate"
              >
                <RotateCw className="w-4 h-4" />
              </Button>
            </div>

            {/* Close Button */}
            <Button
              variant="ghost"
              size="icon"
              className="w-10 h-10 bg-black/50 hover:bg-black/70 text-white rounded-full"
              onClick={onClose}
              data-testid="lightbox-close"
            >
              <X className="w-6 h-6" />
            </Button>
          </div>
        )}

        {/* Media Info Panel */}
        {showControls && (
          <div className="absolute bottom-4 left-4 right-4 bg-black/70 rounded-lg p-4 text-white max-w-4xl mx-auto">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h3 className="font-semibold text-lg mb-1" data-testid="lightbox-title">
                  {currentFile.originalName}
                </h3>
                <div className="text-sm text-gray-300 flex items-center gap-4" data-testid="lightbox-meta">
                  <span>{isVideo ? '🎥' : '📸'} {currentFile.tags?.[0] || 'Media'}</span>
                  <span>{formatFileSize(currentFile.fileSize)}</span>
                  {currentFile.width && currentFile.height && (
                    <span>{currentFile.width}x{currentFile.height}</span>
                  )}
                  {currentFile.isEncrypted && <span>🔒 AES-256</span>}
                  <span>{selectedIndex + 1} of {mediaFiles.length}</span>
                </div>
              </div>
              
              <div className="flex items-center space-x-2 ml-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white hover:bg-white/20"
                  title="Add to Favorites"
                  data-testid="favorite-button"
                >
                  <Heart className={`w-5 h-5 ${currentFile.isFavorite ? 'fill-current text-red-400' : ''}`} />
                </Button>
                
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white hover:bg-white/20"
                  title="Download"
                  onClick={() => {
                    if (mediaUrl) {
                      const a = document.createElement('a');
                      a.href = mediaUrl;
                      a.download = currentFile.originalName;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }
                  }}
                  data-testid="download-button"
                >
                  <Download className="w-5 h-5" />
                </Button>
                
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white hover:bg-white/20"
                  title="Share"
                  data-testid="share-button"
                >
                  <Share2 className="w-5 h-5" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Loading Indicator */}
        {!mediaUrl && currentFile.isEncrypted && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full"></div>
          </div>
        )}
      </div>

      {/* Keyboard Hints */}
      {showControls && (
        <div className="absolute bottom-6 right-6 bg-black/70 rounded-lg p-3 text-sm text-white">
          <div className="font-semibold mb-2">⌨️ Keyboard Shortcuts</div>
          <div className="space-y-1 text-xs">
            <div><kbd className="px-1 py-0.5 bg-white/20 rounded">ESC</kbd> Close</div>
            <div><kbd className="px-1 py-0.5 bg-white/20 rounded">←→</kbd> Navigate</div>
            <div><kbd className="px-1 py-0.5 bg-white/20 rounded">F</kbd> View mode</div>
            <div><kbd className="px-1 py-0.5 bg-white/20 rounded">R</kbd> Rotate</div>
          </div>
        </div>
      )}
    </div>
  );
}
