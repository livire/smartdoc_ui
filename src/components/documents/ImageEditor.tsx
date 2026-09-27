import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import Toast from "../common/Toast";

/**
 * Editing tools for one document.
 *
 * Everything happens in the browser: the adjustments are shown live with CSS
 * on the picture you are looking at, and only when you press Apply is the
 * same recipe replayed onto a canvas to make the real bytes. That way
 * dragging a slider costs nothing, and a document that is fiddled with for a
 * minute is still only ever written once.
 *
 * Nothing here touches storage. Apply hands back the edited image and a
 * thumbnail to match; saving them is the pane's job, so an edit can still be
 * thrown away after it has been made.
 */

export type Edit = {
  // Quarter turns, clockwise.
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
  grayscale: boolean;
  // Fractions of the (rotated) picture, so a crop survives a window resize.
  crop: { x: number; y: number; w: number; h: number } | null;
};

export const NO_EDIT: Edit = {
  rotate: 0,
  flipH: false,
  flipV: false,
  brightness: 100,
  contrast: 100,
  saturation: 100,
  grayscale: false,
  crop: null,
};

export const isEdited = (edit: Edit) =>
  edit.rotate !== 0 ||
  edit.flipH ||
  edit.flipV ||
  edit.brightness !== 100 ||
  edit.contrast !== 100 ||
  edit.saturation !== 100 ||
  edit.grayscale ||
  edit.crop !== null;

const filterOf = (edit: Edit) =>
  `brightness(${edit.brightness}%) contrast(${edit.contrast}%) saturate(${
    edit.grayscale ? 0 : edit.saturation
  }%)`;

// Longest edge of the thumbnail written alongside the document, matching what
// smartdoc_enhance_service produces.
const THUMB_EDGE = 400;
const JPEG_QUALITY = 0.9;
const THUMB_QUALITY = 0.7;

/** Replay the edit onto a canvas and hand back the bytes. */
export async function renderEdit(
  image: HTMLImageElement,
  edit: Edit,
): Promise<{ full: Blob; thumb: Blob }> {
  const turned = edit.rotate === 90 || edit.rotate === 270;
  const rotatedW = turned ? image.naturalHeight : image.naturalWidth;
  const rotatedH = turned ? image.naturalWidth : image.naturalHeight;

  const crop = edit.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const outW = Math.max(1, Math.round(rotatedW * crop.w));
  const outH = Math.max(1, Math.round(rotatedH * crop.h));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser would not give us a canvas to draw on");

  ctx.filter = filterOf(edit);
  ctx.save();
  // Move to where the crop starts, then rotate and flip about the middle of
  // the whole picture — the order matters, and this is the order the preview
  // uses too.
  ctx.translate(-Math.round(rotatedW * crop.x), -Math.round(rotatedH * crop.y));
  ctx.translate(rotatedW / 2, rotatedH / 2);
  ctx.rotate((edit.rotate * Math.PI) / 180);
  ctx.scale(edit.flipH ? -1 : 1, edit.flipV ? -1 : 1);
  ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  ctx.restore();

  const scale = Math.min(1, THUMB_EDGE / Math.max(outW, outH));
  const thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = Math.max(1, Math.round(outW * scale));
  thumbCanvas.height = Math.max(1, Math.round(outH * scale));
  thumbCanvas
    .getContext("2d")
    ?.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);

  const toBlob = (source: HTMLCanvasElement, quality: number) =>
    new Promise<Blob>((resolve, reject) => {
      source.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(
                new Error(
                  "The edited image could not be read back. If this keeps happening, the storage bucket needs to allow this site to read images (CORS).",
                ),
              ),
        "image/jpeg",
        quality,
      );
    });

  return { full: await toBlob(canvas, JPEG_QUALITY), thumb: await toBlob(thumbCanvas, THUMB_QUALITY) };
}

/**
 * Work out brightness and contrast that use the full range.
 *
 * Scans a small copy of the picture, finds where the darkest and lightest
 * real content sits (ignoring the half a percent at each end, which is
 * usually specks and glare), and returns the pair of settings that stretches
 * that range out to black-to-white. A grey, flat scan comes back readable; a
 * picture already using the full range barely moves.
 *
 * The maths follows the order the filters are applied in: brightness
 * multiplies first, then contrast pivots around middle grey.
 */
export function autoLevels(image: HTMLImageElement): { brightness: number; contrast: number } {
  const SAMPLE_EDGE = 200;
  const scale = Math.min(1, SAMPLE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const w = Math.max(1, Math.round(image.naturalWidth * scale));
  const h = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser would not give us a canvas to draw on");
  ctx.drawImage(image, 0, 0, w, h);

  // Throws when the browser will not hand the pixels back — the same CORS
  // rule that applies when the edit is rendered.
  const { data } = ctx.getImageData(0, 0, w, h);

  const histogram = new Array(256).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    const luma = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    histogram[luma] += 1;
  }

  const total = w * h;
  const cut = total * 0.005;
  let low = 0;
  let high = 255;
  for (let count = 0, i = 0; i < 256; i += 1) {
    count += histogram[i];
    if (count > cut) {
      low = i;
      break;
    }
  }
  for (let count = 0, i = 255; i >= 0; i -= 1) {
    count += histogram[i];
    if (count > cut) {
      high = i;
      break;
    }
  }

  const lo = low / 255;
  const hi = high / 255;
  // Nothing sensible to stretch — a blank or single-tone page.
  if (hi - lo < 0.05) return { brightness: 100, contrast: 100 };

  const contrast = 1 + (2 * lo) / (hi - lo);
  const brightness = 1 / ((hi - lo) * contrast);

  const clamp = (n: number, min: number, max: number) =>
    Math.round(Math.min(max, Math.max(min, n * 100)));

  return { brightness: clamp(brightness, 50, 150), contrast: clamp(contrast, 50, 150) };
}

type Rect = { x: number; y: number; w: number; h: number };

// Corner and edge grips, named by which sides they move.
const GRIPS = [
  ["nw", "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize"],
  ["n", "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize"],
  ["ne", "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize"],
  ["e", "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize"],
  ["se", "bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize"],
  ["s", "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-ns-resize"],
  ["sw", "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize"],
  ["w", "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize"],
] as const;

type Grip = (typeof GRIPS)[number][0];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const MIN_SIDE = 0.03;

export type ImageEditorHandle = {
  /** Render whatever is set up here into a draft. Does nothing if untouched. */
  apply: () => Promise<void>;
  /**
   * Drop the crop rectangle if one is drawn, and say whether there was one.
   * Escape is handled by the viewer, which asks this first — relying on two
   * key listeners to fire in the right order was a coin toss.
   */
  clearSelection: () => boolean;
};

const ImageEditor = forwardRef<
  ImageEditorHandle,
  {
    src: string;
    onApply: (result: { full: Blob; thumb: Blob; preview: string; edit: Edit }) => void;
    // Throws away the draft this editor has already produced, so Reset can go
    // back to the stored document rather than only to the sliders' defaults.
    onRevert: () => void;
    // So the one Apply button, which lives outside this component, knows
    // whether there is anything to apply.
    onDirtyChange: (dirty: boolean) => void;
    // Where the tools start: the recipe of an existing draft, so reopening
    // one shows the same rotation, crop and slider positions.
    initialEdit?: Edit | null;
    // The buttons that finish the job. They belong to the viewer, not to the
    // tools, but this is where they sit — under Reset, at the foot of the
    // column.
    footer?: React.ReactNode;
    // Anything the viewer wants above the tools, in the same column — the
    // batch screen puts the category picker there, so the two things
    // somebody does to a page sit together instead of on opposite sides.
    header?: React.ReactNode;
    // Which side the tool column sits on. The batch viewer keeps the right
    // for the page's text, so it asks for the left.
    toolsSide?: "left" | "right";
  }
>(function ImageEditor(
  { src, onApply, onRevert, onDirtyChange, initialEdit, footer, header, toolsSide = "right" },
  ref
) {
  const [edit, setEditState] = useState<Edit>(initialEdit ?? NO_EDIT);
  // Where every setting has been. Kept as whole states rather than as a list
  // of actions — an Edit is a handful of numbers, and comparing two of them
  // is cheaper than replaying anything.
  // Seeded with the untouched picture when a draft is reopened, so undo can
  // walk all the way back to it.
  const [past, setPast] = useState<Edit[]>(initialEdit && isEdited(initialEdit) ? [NO_EDIT] : []);
  const [future, setFuture] = useState<Edit[]>([]);
  // Dragging a slider fires a change per pixel; without this, undo would
  // step back through every one of them.
  const lastChange = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  // The rectangle being adjusted, in fractions of the picture on screen. It
  // is only turned into a crop when Apply crop is pressed, so it can be
  // dragged about and resized as many times as you like first.
  const [selection, setSelection] = useState<Rect | null>(null);
  // Which cursor is in hand: the pointer moves and resizes the rectangle,
  // the crop tool draws a new one.
  const [mode, setMode] = useState<"pointer" | "crop">("pointer");
  // Zoom is for looking closely, not for editing: the crop rectangle is
  // measured against the frame, so drawing one while the picture is scaled
  // and shifted would cut the wrong part. Taking the crop tool resets it.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panFrom = useRef<{ x: number; y: number; pan: { x: number; y: number } } | null>(null);
  const [drag, setDrag] = useState<
    { mode: "new" | "move" | Grip; startX: number; startY: number; from: Rect } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [frame, setFrame] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const imgRef = useRef<HTMLImageElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  // The frame is sized from the picture's shape, so what is on screen is the
  // rotated, cropped picture itself — which is what makes a dragged rectangle
  // mean the same thing as the crop that comes out.
  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const measure = () =>
      setFrame({ w: element.clientWidth, h: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [natural, edit.rotate, edit.crop]);

  const set = (patch: Partial<Edit>) => {
    const keys = Object.keys(patch);
    const key = keys.length === 1 ? keys[0] : "";
    const now = Date.now();
    // One continuous slider drag is one thing to undo.
    const continues = key !== "" && lastChange.current.key === key && now - lastChange.current.at < 700;
    lastChange.current = { key, at: now };

    if (!continues) setPast((prev) => [...prev, edit]);
    setFuture([]);
    setEditState((prev) => ({ ...prev, ...patch }));
  };

  const undo = () => {
    if (past.length === 0) return;
    lastChange.current = { key: "", at: 0 };
    setSelection(null);
    setFuture((prev) => [edit, ...prev]);
    setEditState(past[past.length - 1]);
    setPast((prev) => prev.slice(0, -1));
  };

  const redo = () => {
    if (future.length === 0) return;
    lastChange.current = { key: "", at: 0 };
    setSelection(null);
    setPast((prev) => [...prev, edit]);
    setEditState(future[0]);
    setFuture((prev) => prev.slice(1));
  };

  const resetAll = (next: Edit = NO_EDIT) => {
    lastChange.current = { key: "", at: 0 };
    setPast([]);
    setFuture([]);
    setEditState(next);
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const turn = (degrees: number) => {
    // A pending rectangle means nothing once the picture turns under it.
    setSelection(null);
    resetView();
    set({ rotate: ((((edit.rotate + degrees) % 360) + 360) % 360) as Edit["rotate"] });
  };

  const turned = edit.rotate === 90 || edit.rotate === 270;
  const rotatedW = natural ? (turned ? natural.h : natural.w) : 1;
  const rotatedH = natural ? (turned ? natural.w : natural.h) : 1;
  const crop = edit.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const shownW = rotatedW * crop.w;
  const shownH = rotatedH * crop.h;

  // The picture is drawn bigger than the frame and shifted, so the frame
  // shows exactly the kept part.
  const fullW = frame.w / crop.w;
  const fullH = frame.h / crop.h;

  // --- dragging the rectangle ---
  const pointAt = (event: { clientX: number; clientY: number }) => {
    const rect = frameRef.current!.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  };

  useEffect(() => {
    if (!drag) return;

    const onMove = (event: MouseEvent) => {
      const { x, y } = pointAt(event);

      if (drag.mode === "new") {
        setSelection({
          x: Math.min(drag.startX, x),
          y: Math.min(drag.startY, y),
          w: Math.abs(x - drag.startX),
          h: Math.abs(y - drag.startY),
        });
        return;
      }

      if (drag.mode === "move") {
        const dx = x - drag.startX;
        const dy = y - drag.startY;
        setSelection({
          ...drag.from,
          x: Math.min(Math.max(drag.from.x + dx, 0), 1 - drag.from.w),
          y: Math.min(Math.max(drag.from.y + dy, 0), 1 - drag.from.h),
        });
        return;
      }

      // A grip moves only the sides it is named after.
      const from = drag.from;
      let { x: left, y: top, w, h } = from;
      const right = from.x + from.w;
      const bottom = from.y + from.h;

      if (drag.mode.includes("w")) {
        left = Math.min(x, right - MIN_SIDE);
        w = right - left;
      }
      if (drag.mode.includes("e")) {
        w = Math.max(x - from.x, MIN_SIDE);
      }
      if (drag.mode.includes("n")) {
        top = Math.min(y, bottom - MIN_SIDE);
        h = bottom - top;
      }
      if (drag.mode.includes("s")) {
        h = Math.max(y - from.y, MIN_SIDE);
      }

      setSelection({
        x: clamp01(left),
        y: clamp01(top),
        w: Math.min(w, 1 - clamp01(left)),
        h: Math.min(h, 1 - clamp01(top)),
      });
    };

    const onUp = () => {
      setDrag(null);
      // A stray click is not a rectangle.
      setSelection((prev) => (prev && (prev.w < MIN_SIDE || prev.h < MIN_SIDE) ? null : prev));
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag]);

  // Cutting the rectangle on its own, so the tools that follow work on the
  // cropped picture rather than the whole page.
  const applyCrop = () => {
    if (!selection) return;
    set({
      crop: {
        x: crop.x + selection.x * crop.w,
        y: crop.y + selection.y * crop.h,
        w: selection.w * crop.w,
        h: selection.h * crop.h,
      },
    });
    setSelection(null);
    setMode("pointer");
  };

  // What Apply will actually render: the adjustments, plus whatever
  // rectangle is currently drawn. Crops compound — a crop of a crop is
  // measured against the original.
  const effectiveEdit: Edit = selection
    ? {
        ...edit,
        crop: {
          x: crop.x + selection.x * crop.w,
          y: crop.y + selection.y * crop.h,
          w: selection.w * crop.w,
          h: selection.h * crop.h,
        },
      }
    : edit;

  const apply = async () => {
    const image = imgRef.current;
    if (!image) return;
    // Nothing was rotated, cropped or adjusted — there is no new picture to
    // make, and making one anyway would put the document into draft for no
    // reason.
    if (!isEdited(effectiveEdit)) return;

    setError(null);
    try {
      const { full, thumb } = await renderEdit(image, effectiveEdit);
      onApply({ full, thumb, preview: URL.createObjectURL(full), edit: effectiveEdit });
      // The editor goes on working from the original picture, so the settings
      // stay exactly where they are — a crop that was drawn simply becomes
      // part of them.
      setEditState(effectiveEdit);
      setSelection(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply the edit");
    }
  };

  useEffect(() => {
    onDirtyChange(isEdited(effectiveEdit));
  }, [effectiveEdit, onDirtyChange]);

  useImperativeHandle(ref, () => ({
    apply,
    clearSelection: () => {
      if (!selection) return false;
      setSelection(null);
      return true;
    },
  }));

  const tool =
    "flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/15 px-2 text-xs font-medium text-white/80 transition hover:bg-white/10 hover:text-white";

  return (
    // Clicks stop here: the viewer behind closes when its backdrop is
    // clicked, and every tool press was reaching it.
    <div
      // min-w-0 matters: a flex item's minimum width is its content by
      // default, so a wide picture — a crop of a few lines across a page is
      // wider than it is tall — refused to shrink and pushed whatever sits
      // beside it off the screen. The batch viewer keeps the page's text
      // there, and cropping made it disappear.
      className={`flex min-h-0 min-w-0 flex-1 ${toolsSide === "left" ? "flex-row-reverse" : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex min-w-0 flex-1 items-center justify-center overflow-hidden p-4">
        <div
          ref={frameRef}
          onMouseDown={(e) => {
            if (e.button !== 0) return;

            // Zoomed in with the pointer in hand: drag moves the picture.
            if (mode === "pointer" && zoom > 1) {
              panFrom.current = { x: e.clientX, y: e.clientY, pan };
              return;
            }

            if (mode !== "crop") return;
            const { x, y } = pointAt(e);
            setSelection({ x, y, w: 0, h: 0 });
            setDrag({ mode: "new", startX: x, startY: y, from: { x, y, w: 0, h: 0 } });
          }}
          style={{
            // The width is given, the height follows the shape.
            //
            // It cannot be the other way round here: everything inside this
            // box is absolutely positioned, so the box has no content of its
            // own to be measured — an `auto` width would collapse it to
            // nothing. And a fixed 82vh height was what made a cropped strip
            // of lines fill the screen sideways: a wide shape at that height
            // is wider than the column it sits in.
            //
            // min() takes whichever is smaller: the space actually there, or
            // the width that would make this 82vh tall. So a tall page fills
            // the height, a wide crop fits the width, and neither pushes the
            // text panel off the screen.
            aspectRatio: `${shownW} / ${shownH}`,
            width: `min(100%, calc(82vh * ${shownW} / ${shownH}))`,
            height: "auto",
          }}
          onMouseMove={(e) => {
            const from = panFrom.current;
            if (!from) return;
            setPan({
              x: from.pan.x + (e.clientX - from.x),
              y: from.pan.y + (e.clientY - from.y),
            });
          }}
          onMouseUp={() => {
            panFrom.current = null;
          }}
          onMouseLeave={() => {
            panFrom.current = null;
          }}
          className={`relative overflow-hidden select-none ${
            mode === "crop" ? "cursor-crosshair" : zoom > 1 ? "cursor-grab" : ""
          }`}
        >
          <div
            className="absolute"
            style={{
              left: -crop.x * fullW,
              top: -crop.y * fullH,
              width: fullW,
              height: fullH,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "center",
            }}
          >
            <img
              ref={imgRef}
              src={src}
              alt=""
              // Needed to read the edited picture back off the canvas; without
              // it the browser refuses to hand over the bytes.
              crossOrigin="anonymous"
              draggable={false}
              onLoad={(e) =>
                setNatural({
                  w: e.currentTarget.naturalWidth,
                  h: e.currentTarget.naturalHeight,
                })
              }
              style={{
                width: turned ? fullH : fullW,
                height: turned ? fullW : fullH,
                filter: filterOf(edit),
                transform: `translate(-50%, -50%) rotate(${edit.rotate}deg) scale(${
                  edit.flipH ? -1 : 1
                }, ${edit.flipV ? -1 : 1})`,
              }}
              className="absolute left-1/2 top-1/2 max-w-none"
            />
          </div>

          {/* The rectangle, with grips on every side. Everything outside it
              is dimmed by the box shadow — one shape doing both jobs, so the
              kept part is never dimmed by an overlay of its own. Nothing is
              cut until Apply crop. */}
          {selection && selection.w > 0 && selection.h > 0 && (
            <>
              <div
                onMouseDown={(e) => {
                  e.stopPropagation();
                  const { x, y } = pointAt(e);
                  setDrag({ mode: "move", startX: x, startY: y, from: selection });
                }}
                style={{
                  left: `${selection.x * 100}%`,
                  top: `${selection.y * 100}%`,
                  width: `${selection.w * 100}%`,
                  height: `${selection.h * 100}%`,
                  // The kept part shows through at full brightness.
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
                }}
                className="absolute cursor-move border border-white/90"
              >
                {/* The tick belongs to the rectangle, not to a panel across
                    the screen — it cuts to what is drawn right here. */}
                <button
                  type="button"
                  title="Cut to this rectangle"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    applyCrop();
                  }}
                  className="absolute bottom-1 right-1 flex size-7 items-center justify-center rounded-full bg-brand-500 text-white shadow-lg transition hover:bg-brand-600"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                    <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                </button>

                {GRIPS.map(([grip, position]) => (
                  <span
                    key={grip}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      const { x, y } = pointAt(e);
                      setDrag({ mode: grip, startX: x, startY: y, from: selection });
                    }}
                    className={`absolute size-2.5 rounded-sm border border-gray-900/40 bg-white ${position}`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* The tool column. On the right the way an editor puts them, unless
          the viewer wants that side for something else. */}
      <div
        className={`flex w-64 flex-shrink-0 flex-col gap-4 overflow-y-auto bg-gray-900/80 p-4 ${
          toolsSide === "left" ? "border-r border-white/10" : "border-l border-white/10"
        }`}
      >
        {header}

        <div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={tool} onClick={() => turn(-90)}>
              ⟲ Left
            </button>
            <button type="button" className={tool} onClick={() => turn(90)}>
              ⟳ Right
            </button>
            <button type="button" className={tool} onClick={() => set({ flipH: !edit.flipH })}>
              ⇋ Flip H
            </button>
            <button type="button" className={tool} onClick={() => set({ flipV: !edit.flipV })}>
              ⇅ Flip V
            </button>
          </div>
        </div>

        <div>
          {/* No heading: a slider between a minus and a plus is a zoom.
              The percentage stays — it is a reading, not a label. */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              title="Zoom out"
              onClick={() => setZoom((z) => Math.max(1, Number((z - 0.25).toFixed(2))))}
              className={`${tool} size-8 px-0`}
            >
              −
            </button>
            <input
              type="range"
              min={100}
              max={400}
              step={25}
              value={Math.round(zoom * 100)}
              onChange={(e) => {
                setZoom(Number(e.target.value) / 100);
                if (Number(e.target.value) === 100) setPan({ x: 0, y: 0 });
              }}
              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/20 accent-brand-500"
            />
            <button
              type="button"
              title="Zoom in"
              onClick={() => setZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
              className={`${tool} size-8 px-0`}
            >
              +
            </button>
            {/* A reading, not a label — fixed width so the slider does not
                shift as the number grows. */}
            <span className="w-9 flex-shrink-0 text-right text-[11px] tabular-nums text-white/40">
              {Math.round(zoom * 100)}%
            </span>
          </div>
          {zoom > 1 && (
            <p className="mt-1.5 text-[11px] text-white/50">
              Drag to move the picture. Cropping starts from a whole page, so
              taking the crop tool resets this.
            </p>
          )}
        </div>

        <div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              title="Pointer — move and resize the rectangle"
              onClick={() => setMode("pointer")}
              className={`${tool} ${
                mode === "pointer" ? "border-brand-400 bg-brand-500/20 text-white" : ""
              }`}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                <path d="M5 2.5 19 12l-6.1 1.4 3.1 6-2.6 1.3-3-6.1L5 19z" />
              </svg>
              Pointer
            </button>
            <button
              type="button"
              title="Crop — drag a new rectangle"
              onClick={() => {
                resetView();
                setMode("crop");
              }}
              className={`${tool} ${
                mode === "crop" ? "border-brand-400 bg-brand-500/20 text-white" : ""
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
                <path strokeLinecap="round" d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14" />
              </svg>
              Crop
            </button>
          </div>
          {/* Only once a rectangle is on the page, and only then because
              the tick and Esc are not guessable. Before that, taking the
              crop cursor and dragging is what the cursor already invites. */}
          {selection && (
            <p className="mt-2 text-[11px] leading-snug text-white/50">
              Drag inside to move it, pull an edge to resize, tick to cut, Esc to drop it.
            </p>
          )}
        </div>

        <div className="space-y-3">
          {([
            ["Brightness", "brightness", 50, 150],
            ["Contrast", "contrast", 50, 150],
            ["Saturation", "saturation", 0, 200],
          ] as const).map(([label, key, min, max]) => (
            <label key={key} className="block">
              <span className="flex items-center justify-between text-[11px] text-white/60">
                {label}
                <span>{edit[key]}%</span>
              </span>
              <input
                type="range"
                min={min}
                max={max}
                value={edit[key]}
                disabled={key === "saturation" && edit.grayscale}
                onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<Edit>)}
                className="mt-1 h-1 w-full cursor-pointer appearance-none rounded-full bg-white/20 accent-brand-500 disabled:opacity-40"
              />
            </label>
          ))}

          <label className="flex items-center gap-2 text-xs text-white/70">
            <input
              type="checkbox"
              checked={edit.grayscale}
              onChange={(e) => set({ grayscale: e.target.checked })}
              className="size-3.5 accent-brand-500"
            />
            Black and white
          </label>

          {/* Sets the two sliders above rather than doing something of its
              own, so the result can still be nudged by hand afterwards. */}
          <button
            type="button"
            className={`${tool} h-8 w-full`}
            onClick={() => {
              const image = imgRef.current;
              if (!image) return;
              try {
                set(autoLevels(image));
                setError(null);
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : "Could not read the picture to adjust it",
                );
              }
            }}
          >
            Auto adjust
          </button>
        </div>

        {error && <Toast message={error} type="error" onClose={() => setError(null)} />}

        <div className="mt-auto space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              title="Undo"
              onClick={undo}
              className={`${tool} h-9 ${past.length === 0 ? "opacity-40" : ""}`}
            >
              ↶ Undo
            </button>
            <button
              type="button"
              title="Redo"
              onClick={redo}
              className={`${tool} h-9 ${future.length === 0 ? "opacity-40" : ""}`}
            >
              ↷ Redo
            </button>
            <button
              type="button"
              className={`${tool} h-9`}
              onClick={() => {
                setSelection(null);
                resetView();
                resetAll();
                // An applied crop is already part of the picture, not a slider
                // that can be moved back — so Reset drops the draft too and
                // starts again from the stored document.
                onRevert();
              }}
            >
              Reset
            </button>
          </div>

          {footer}
        </div>
      </div>
    </div>
  );
});

export default ImageEditor;
