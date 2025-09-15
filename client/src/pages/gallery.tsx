import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import Navbar from "@/components/ui/navbar";
import StatsBar from "@/components/gallery/StatsBar";
import FilterControls from "@/components/gallery/FilterControls";
import CategoryHierarchy from "@/components/gallery/CategoryHierarchy";
import MediaGrid from "@/components/gallery/MediaGrid";
import MediaLightbox from "@/components/gallery/MediaLightbox";
import KeyboardNavigation from "@/components/gallery/KeyboardNavigation";
import ImportModal from "@/components/import/ImportModal";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";

export default function Gallery() {
  const [filters, setFilters] = useState({
    categoryId: undefined as string | undefined,
    isVault: false,
    search: '',
    sortBy: 'created_at' as const,
    sortOrder: 'desc' as const,
  });

  const [pagination, setPagination] = useState({
    limit: 20,
    offset: 0,
  });

  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);

  const { data: mediaResult, isLoading } = useQuery({
    queryKey: ["/api/media", { ...filters, ...pagination }],
    retry: false,
  });

  const { data: categories } = useQuery({
    queryKey: ["/api/categories"],
    retry: false,
  });

  const { data: stats } = useQuery({
    queryKey: ["/api/stats"],
    retry: false,
  });

  const {
    selectedIndex,
    isLightboxOpen,
    openLightbox,
    closeLightbox,
    navigateNext,
    navigatePrevious,
  } = useKeyboardNavigation(mediaResult?.files || []);

  const handleFilterChange = (newFilters: Partial<typeof filters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
    setPagination(prev => ({ ...prev, offset: 0 })); // Reset to first page
  };

  const handlePageChange = (newOffset: number) => {
    setPagination(prev => ({ ...prev, offset: newOffset }));
  };

  const handleMediaSelect = (mediaId: string, index: number) => {
    setSelectedMediaId(mediaId);
    openLightbox(index);
  };

  // Listen for upload modal trigger from navbar
  useEffect(() => {
    const handleOpenUploadModal = () => {
      setShowImportModal(true);
    };

    window.addEventListener('openUploadModal', handleOpenUploadModal);
    return () => {
      window.removeEventListener('openUploadModal', handleOpenUploadModal);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      
      <main className="pt-16">
        {/* Stats Bar */}
        <StatsBar stats={stats} />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Filter Controls */}
          <FilterControls
            filters={filters}
            onFilterChange={handleFilterChange}
            onUploadClick={() => setShowImportModal(true)}
            data-testid="filter-controls"
          />

          {/* Category Hierarchy */}
          <CategoryHierarchy
            categories={categories || []}
            selectedCategoryId={filters.categoryId}
            onCategorySelect={(categoryId) => handleFilterChange({ categoryId })}
            data-testid="category-hierarchy"
          />

          {/* Media Grid */}
          <MediaGrid
            mediaFiles={mediaResult?.files || []}
            isLoading={isLoading}
            selectedIndex={selectedIndex}
            onMediaSelect={handleMediaSelect}
            data-testid="media-grid"
          />

          {/* Pagination */}
          {mediaResult && (
            <div className="flex items-center justify-between mt-8" data-testid="pagination">
              <div className="text-sm text-muted-foreground">
                Showing {pagination.offset + 1} to {Math.min(pagination.offset + pagination.limit, mediaResult.total)} of {mediaResult.total} results
              </div>
              <div className="flex items-center space-x-2">
                <button
                  className="px-3 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-lg transition-colors disabled:opacity-50"
                  disabled={pagination.offset === 0}
                  onClick={() => handlePageChange(Math.max(0, pagination.offset - pagination.limit))}
                  data-testid="button-previous-page"
                >
                  Previous
                </button>
                
                <span className="px-3 py-2 text-muted-foreground">
                  Page {Math.floor(pagination.offset / pagination.limit) + 1} of {Math.ceil(mediaResult.total / pagination.limit)}
                </span>
                
                <button
                  className="px-3 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-lg transition-colors disabled:opacity-50"
                  disabled={pagination.offset + pagination.limit >= mediaResult.total}
                  onClick={() => handlePageChange(pagination.offset + pagination.limit)}
                  data-testid="button-next-page"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Media Lightbox */}
      <MediaLightbox
        mediaFiles={mediaResult?.files || []}
        selectedIndex={selectedIndex}
        isOpen={isLightboxOpen}
        onClose={closeLightbox}
        onNext={navigateNext}
        onPrevious={navigatePrevious}
        data-testid="media-lightbox"
      />

      {/* Import Modal */}
      <ImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        data-testid="import-modal"
      />

      {/* Keyboard Navigation Component */}
      <KeyboardNavigation />
    </div>
  );
}
