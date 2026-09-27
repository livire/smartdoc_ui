import { useRef, useState, useEffect, useCallback } from "react";
import { UploadedImage } from "../../pages/Digitize";

interface UploadAreaProps {
  selectedImages: UploadedImage[];
  onAddImages: (files: File[]) => void;
  onRemoveImage: (id: string) => void;
  onRemoveImages: (ids: string[]) => void;
  // Selection lives up in Digitize so its controls can sit on the tab row
  // with the other actions, rather than in a bar of their own.
  // True while a batch upload is running: the per-tile remove button goes
  // away, because the queue of files was fixed when the upload started.
  busy: boolean;
  // Documents that have been waiting on their row long enough to be worth
  // flagging. Everything else that is waiting gets a quiet mark instead —
  // the row arrives off a queue, so a short wait is how it always works.
  lateIds: Set<string>;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  assignmentId: string | null;
  // What to say when there's nothing to upload against — it differs between
  // "you hold nothing" and "you hold something you haven't started".
  emptyHint?: string;
  // The project's own limit, for the line under the drop zone. Absent
  // until the settings land, and then the line simply omits it.
  maxFileMb?: number | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

// A drag shorter than this is a click that wobbled, not a rectangle.
const DRAG_THRESHOLD_PX = 4;

// How close to the edge the pointer has to get before the list scrolls
// itself while you are dragging a rectangle.
const EDGE_PX = 48;
const EDGE_SPEED_PX = 14;

type Point = { x: number; y: number };

export default function UploadArea({
  selectedImages,
  onAddImages,
  onRemoveImage,
  onRemoveImages,
  selectedIds,
  onSelectionChange,
  busy,
  lateIds,
  assignmentId,
  emptyHint,
  maxFileMb,
  fileInputRef,
}: UploadAreaProps) {
  const dragRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [previewImage, setPreviewImage] = useState<UploadedImage | null>(null);
  const [isZoomed, setIsZoomed] = useState(false);
  const [hoveredImage, setHoveredImage] = useState<{ image: UploadedImage; rect: DOMRect } | null>(null);

  // --- Selection ---------------------------------------------------------
  const setSelectedIds = onSelectionChange;
  // Where a shift-click measures its range from: the last document clicked
  // on its own.
  const [anchorId, setAnchorId] = useState<string | null>(null);
  // Each tile's element, so a dragged rectangle can be tested against what
  // is actually on screen rather than against guessed positions.
  const tileRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const [marquee, setMarquee] = useState<{ start: Point; current: Point } | null>(null);
  // The selection the rectangle is added to — held in a ref because the
  // mouse handlers run outside React's render cycle.
  const marqueeBase = useRef<Set<string>>(new Set());
  const marqueeMoved = useRef(false);

  // Anything not mid-upload can be taken out of the tray. A document that is
  // uploaded and still here is one the batch never recorded — removing it
  // leaves the file in storage, which is better than being unable to clear a
  // tray that will not empty.
  const removableIds = selectedImages
    .filter((image) => selectedIds.has(image.id) && !image.uploading)
    .map((image) => image.id);

  // A tile that is removed never gets a mouse-leave, so its tooltip would
  // otherwise hang about over an empty grid.
  useEffect(() => {
    if (hoveredImage && !selectedImages.some((image) => image.id === hoveredImage.image.id)) {
      setHoveredImage(null);
    }
  }, [selectedImages, hoveredImage]);

  // Documents that go away (uploaded, or cleared) should not stay counted as
  // selected.
  useEffect(() => {
    const alive = new Set(selectedImages.map((image) => image.id));
    const kept = [...selectedIds].filter((id) => alive.has(id));
    if (kept.length !== selectedIds.size) onSelectionChange(new Set(kept));
  }, [selectedImages, selectedIds, onSelectionChange]);

  const clearSelection = useCallback(() => {
    onSelectionChange(new Set());
    setAnchorId(null);
  }, [onSelectionChange]);

  const handleTileClick = (event: React.MouseEvent, image: UploadedImage, index: number) => {
    if (event.shiftKey && anchorId) {
      const anchorIndex = selectedImages.findIndex((item) => item.id === anchorId);
      if (anchorIndex !== -1) {
        const [from, to] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
        const range = selectedImages.slice(from, to + 1).map((item) => item.id);
        // Ctrl with shift widens the existing selection; shift alone replaces
        // it, the way a file list behaves.
        setSelectedIds(
          event.ctrlKey || event.metaKey
            ? new Set([...selectedIds, ...range])
            : new Set(range),
        );
        return;
      }
    }

    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selectedIds);
      if (next.has(image.id)) next.delete(image.id);
      else next.add(image.id);
      setSelectedIds(next);
      setAnchorId(image.id);
      return;
    }

    setSelectedIds(new Set([image.id]));
    setAnchorId(image.id);
  };

  // --- Rectangle drag ----------------------------------------------------
  const hitTest = useCallback((start: Point, current: Point) => {
    const box = {
      left: Math.min(start.x, current.x),
      right: Math.max(start.x, current.x),
      top: Math.min(start.y, current.y),
      bottom: Math.max(start.y, current.y),
    };

    const hits: string[] = [];
    tileRefs.current.forEach((element, id) => {
      const rect = element.getBoundingClientRect();
      const overlaps =
        rect.left < box.right &&
        rect.right > box.left &&
        rect.top < box.bottom &&
        rect.bottom > box.top;
      if (overlaps) hits.push(id);
    });

    setSelectedIds(new Set([...marqueeBase.current, ...hits]));
  }, []);

  const startMarquee = (event: React.MouseEvent) => {
    // Only from empty space, and only with the left button — a drag that
    // starts on a document is a click on that document.
    if (event.button !== 0) return;
    if (event.target !== event.currentTarget) return;

    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    marqueeBase.current = additive ? new Set(selectedIds) : new Set();
    marqueeMoved.current = false;
    if (!additive) setSelectedIds(new Set());

    setMarquee({
      start: { x: event.clientX, y: event.clientY },
      current: { x: event.clientX, y: event.clientY },
    });
  };

  useEffect(() => {
    if (!marquee) return;

    const pointer = { x: marquee.current.x, y: marquee.current.y };

    const onMove = (event: MouseEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;

      setMarquee((prev) => {
        if (!prev) return prev;
        const moved =
          Math.abs(event.clientX - prev.start.x) > DRAG_THRESHOLD_PX ||
          Math.abs(event.clientY - prev.start.y) > DRAG_THRESHOLD_PX;
        if (moved) marqueeMoved.current = true;
        const next = { start: prev.start, current: { x: event.clientX, y: event.clientY } };
        if (marqueeMoved.current) hitTest(next.start, next.current);
        return next;
      });
    };

    const onUp = () => {
      // A plain click on empty space means "select nothing".
      if (!marqueeMoved.current) setAnchorId(null);
      setMarquee(null);
    };

    // Dragging past the bottom of the list should keep going, not stop at
    // whatever happens to be visible.
    const scroller = window.setInterval(() => {
      const container = scrollContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      let delta = 0;
      if (pointer.y < rect.top + EDGE_PX) delta = -EDGE_SPEED_PX;
      else if (pointer.y > rect.bottom - EDGE_PX) delta = EDGE_SPEED_PX;
      if (delta === 0) return;

      const before = container.scrollTop;
      container.scrollTop += delta;
      if (container.scrollTop === before) return;

      setMarquee((prev) => {
        if (!prev) return prev;
        marqueeMoved.current = true;
        hitTest(prev.start, { x: pointer.x, y: pointer.y });
        return { start: prev.start, current: { x: pointer.x, y: pointer.y } };
      });
    }, 16);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.clearInterval(scroller);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [marquee !== null, hitTest]); // eslint-disable-line react-hooks/exhaustive-deps

  // The rectangle is drawn in page coordinates, so it stays put over the
  // documents while the list scrolls under it.
  const marqueeStyle = (() => {
    if (!marquee || !marqueeMoved.current) return null;
    const container = scrollContainerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const left = Math.min(marquee.start.x, marquee.current.x) - rect.left;
    const top = Math.min(marquee.start.y, marquee.current.y) - rect.top + container.scrollTop;
    return {
      left,
      top,
      width: Math.abs(marquee.current.x - marquee.start.x),
      height: Math.abs(marquee.current.y - marquee.start.y),
    };
  })();

  // --- Keyboard ----------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && previewImage) {
        setPreviewImage(null);
        setIsZoomed(false);
        return;
      }

      // Not while someone is typing somewhere else on the screen.
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (previewImage || selectedImages.length === 0) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelectedIds(new Set(selectedImages.map((image) => image.id)));
        return;
      }

      if (e.key === "Escape") {
        clearSelection();
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && removableIds.length > 0) {
        e.preventDefault();
        onRemoveImages(removableIds);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewImage, selectedImages, removableIds, clearSelection, onRemoveImages]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragRef.current) {
      dragRef.current.classList.add("border-brand-500", "bg-brand-50", "dark:bg-brand-900/20");
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragRef.current) {
      dragRef.current.classList.remove("border-brand-500", "bg-brand-50", "dark:bg-brand-900/20");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragRef.current) {
      dragRef.current.classList.remove("border-brand-500", "bg-brand-50", "dark:bg-brand-900/20");
    }

    const files = Array.from(e.dataTransfer.files).filter((file) =>
      file.type.startsWith("image/")
    );
    if (files.length > 0) {
      onAddImages(files);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onAddImages(files);
    }
  };

  return (
    <div className="flex flex-col w-full overflow-hidden h-full">
      {selectedImages.length === 0 ? (
        /* Drop Zone - Only when no images selected */
        <div
          ref={dragRef}
          onDragOver={assignmentId ? handleDragOver : undefined}
          onDragLeave={assignmentId ? handleDragLeave : undefined}
          onDrop={assignmentId ? handleDrop : undefined}
          className={`flex-1 flex flex-col justify-center items-center border-2 border-dashed rounded-lg p-4 text-center transition ${
            assignmentId
              ? 'border-gray-300 dark:border-gray-600'
              : 'border-gray-200 dark:border-gray-700 opacity-60'
          }`}
        >
          <svg
            className="w-10 h-10 mx-auto text-gray-400 dark:text-gray-500 mb-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          {assignmentId ? (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                Drag and drop or{" "}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-brand-500 hover:text-brand-600 font-medium"
                >
                  select
                </button>
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500">
                JPG, PNG, GIF, WebP{maxFileMb ? ` (Max ${maxFileMb}MB)` : ""}
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {emptyHint ||
                "Pick up an assignment from My Assignments to start adding documents"}
            </p>
          )}
        </div>
      ) : (
        /* Selected Images Grid - When images are selected */
        <div className="flex flex-col flex-1 min-h-0">
          <div
            ref={scrollContainerRef}
            onMouseDown={startMarquee}
            className="relative w-full overflow-y-auto flex-1 select-none"
          >
            <div
              className="flex flex-wrap gap-4 p-2.5"
              style={{ scrollBehavior: 'smooth' }}
              onMouseDown={startMarquee}
            >
              {selectedImages.map((image, index) => {
                const isSelected = selectedIds.has(image.id);
                return (
                <div
                  key={image.id}
                  className="flex flex-col items-center"
                >
                  <div
                    ref={(element) => {
                      if (element) tileRefs.current.set(image.id, element);
                      else tileRefs.current.delete(image.id);
                    }}
                    style={{ width: '150px', height: '150px', flexShrink: 0 }}
                    className={`relative group rounded-lg overflow-hidden bg-gray-200 dark:bg-gray-700 cursor-pointer border-2 transition-colors ${
                      isSelected
                        ? 'border-brand-500 ring-2 ring-brand-500/30'
                        : 'border-transparent hover:border-gray-600'
                    }`}
                    onClick={(event) => handleTileClick(event, image, index)}
                    onDoubleClick={() => setPreviewImage(image)}
                    onMouseEnter={(e) => {
                      if (!image.uploading) {
                        setHoveredImage({ image, rect: e.currentTarget.getBoundingClientRect() });
                      }
                    }}
                    onMouseLeave={() => setHoveredImage(null)}
                  >
                    <img
                      src={image.preview}
                      alt="preview"
                      draggable={false}
                      className={`w-full h-full object-cover ${image.uploading ? 'opacity-50' : ''}`}
                    />
                    {isSelected && (
                      <div className="absolute inset-0 bg-brand-500/15 pointer-events-none" />
                    )}
                    {image.uploading && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      </div>
                    )}
                    {/* Reaching storage is only half of it: the batch row is
                        written by another service off a queue, and can fail
                        long after the file itself is safe. Waiting for that
                        row is normal and takes a second, so the tile says
                        nothing about it — the tab row carries the count.
                        A mark appears here only when one is overdue, so
                        anything marked is genuinely worth a look. */}
                    {image.uploaded && !image.uploading && (
                      <div className="absolute left-0.5 top-0.5 flex gap-0.5">
                        <span title="Stored" className="rounded-full bg-green-600 p-0.5">
                          <svg className="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </span>

                        {lateIds.has(image.id) && (
                          <span
                            title="Stored, but the batch still has no record of it — use Retry above"
                            className="rounded-full bg-warning-500 p-0.5"
                          >
                            <svg className="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M10 3a7 7 0 1 0 6.9 8.1h-2.05A5 5 0 1 1 10 5c1.2 0 2.3.44 3.16 1.16L11 8h6V2z" />
                            </svg>
                          </span>
                        )}
                      </div>
                    )}
                    {isSelected && (
                      <div className="absolute bottom-0.5 left-0.5 bg-brand-500 rounded-full p-0.5">
                        <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>
                    )}
                    {!image.uploading && !busy && (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          onRemoveImage(image.id);
                        }}
                        className="absolute top-0.5 right-0.5 bg-red-500 hover:bg-red-600 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition"
                        title="Remove"
                      >
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                );
              })}
            </div>

            {marqueeStyle && (
              <div
                className="absolute border border-brand-500 bg-brand-500/10 pointer-events-none rounded-sm"
                style={marqueeStyle}
              />
            )}
          </div>
        </div>
      )}

      {/* Hover Tooltip - fixed positioned to escape overflow clipping */}
      {hoveredImage && !marquee && (
        <div
          className="fixed z-[999998] bg-gray-900/95 text-white text-xs p-2 rounded-lg w-48 pointer-events-none shadow-lg"
          style={{
            top: hoveredImage.rect.bottom + 4,
            left: hoveredImage.rect.left,
          }}
        >
          <div className="font-medium break-words">{hoveredImage.image.file.name}</div>
          <div className="text-gray-300 mt-0.5">{(hoveredImage.image.file.size / 1024).toFixed(1)} KB</div>
          <div className="text-gray-400 mt-0.5">{hoveredImage.image.file.type || 'image'}</div>
          {hoveredImage.image.uploaded ? (
            <>
              {hoveredImage.image.uploadedAt && (
                <div className="text-gray-400 mt-0.5">
                  Uploaded at {hoveredImage.image.uploadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
              {hoveredImage.image.s3ObjectKey && (
                <>
                  <div className="border-t border-gray-600 mt-1 pt-1">S3 Info:</div>
                  <div className="text-gray-400 mt-0.5 break-all font-mono text-[10px]">{hoveredImage.image.s3ObjectKey}</div>
                </>
              )}
            </>
          ) : (
            <div className="text-amber-400 mt-0.5 font-medium">Pending Upload</div>
          )}
        </div>
      )}

      {/* Image Preview Modal */}
      {previewImage && (
        <div
          className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[999999]"
          onClick={() => {
            setPreviewImage(null);
            setIsZoomed(false);
          }}
        >
          <div
            className={`relative ${isZoomed ? 'w-full h-full' : 'max-w-4xl max-h-screen'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={previewImage.preview}
              alt="preview"
              onClick={() => setIsZoomed(!isZoomed)}
              className={`${isZoomed ? 'w-full h-full object-contain' : 'max-w-full max-h-screen object-contain'} cursor-zoom-in`}
            />
            <button
              onClick={() => {
                setPreviewImage(null);
                setIsZoomed(false);
              }}
              className="absolute top-4 right-4 bg-white dark:bg-gray-800 rounded-full p-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
              title="Close"
            >
              <svg className="w-6 h-6 text-gray-900 dark:text-white" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Hidden file input - always available */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
}
