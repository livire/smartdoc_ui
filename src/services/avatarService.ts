const API_URL = import.meta.env.VITE_API_URL;

// What a person may choose. Anything else is refused before it is read.
export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
// A cap on what we will read and decode, not on what is kept: the picture is
// squared and resized before it leaves the browser, so what is stored is
// around 30KB whatever comes in. Generous enough for a phone photo, which is
// commonly 2–4MB and cannot easily be shrunk by the person holding it.
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_FILE_LABEL = "4MB";

// What is actually stored: a square, this many pixels on a side. A profile
// picture is shown at 80px at most, so anything larger is bytes nobody sees.
export const AVATAR_PIXELS = 256;
const JPEG_QUALITY = 0.85;

const jsonHeaders = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  "Content-Type": "application/json",
});

/**
 * Read a chosen file, check it, and cut it down to a square data URL.
 *
 * The resizing happens here rather than on the server: the API then never
 * handles a file, the row stays small, and someone on a phone uploads tens of
 * kilobytes instead of four megabytes.
 */
export async function prepareAvatar(file: File): Promise<{ dataUrl: string; contentType: string }> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error("Choose a JPG, PNG or WebP image");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`That image is over ${MAX_FILE_LABEL} — choose a smaller one`);
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That file could not be read as an image"));
      el.src = objectUrl;
    });

    // Centre square crop, so a portrait or landscape photo is not squashed.
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const sx = (image.naturalWidth - side) / 2;
    const sy = (image.naturalHeight - side) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_PIXELS;
    canvas.height = AVATAR_PIXELS;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser would not give us a canvas to draw on");
    ctx.drawImage(image, sx, sy, side, side, 0, 0, AVATAR_PIXELS, AVATAR_PIXELS);

    return { dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY), contentType: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export const avatarService = {
  async get(userId: number, accessToken: string): Promise<string | null> {
    const response = await fetch(`${API_URL}/user_avatar/${userId}`, {
      headers: jsonHeaders(accessToken),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body.data?.image_data ?? null;
  },

  async save(userId: number, dataUrl: string, contentType: string, accessToken: string) {
    const response = await fetch(`${API_URL}/user_avatar/`, {
      method: "POST",
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ user_id: userId, image_data: dataUrl, content_type: contentType }),
    });
    if (!response.ok) throw new Error("Failed to save the picture");
  },

  async remove(userId: number, accessToken: string) {
    const response = await fetch(`${API_URL}/user_avatar/${userId}`, {
      method: "DELETE",
      headers: jsonHeaders(accessToken),
    });
    if (!response.ok) throw new Error("Failed to remove the picture");
  },
};
