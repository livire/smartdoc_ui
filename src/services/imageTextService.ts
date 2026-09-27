import { authService } from "./authService";

const API_URL = import.meta.env.VITE_API_URL;

/** What was read off one page, and by which engine. */
export interface ImageText {
  image_text_id: number;
  image_id: number;
  ocr_text: string;
  // Null when a person wrote this text rather than an engine.
  model_id: number | null;
  edited_by?: number | null;
  confidence: number | string | null;
  language: string;
  created_at: string;
  // Joined from the catalogue, so a screen can say which engine read it —
  // two customers on two engines get visibly different text, and the answer
  // to "why is this worse?" should be on the screen.
  model_catalogue?: {
    model_id: number;
    display_name: string;
    provider: string;
  } | null;
}

export const imageTextService = {
  /**
   * The current text for a page, or null if it has not been read.
   *
   * Null is an ordinary answer, not an error: most projects have OCR off.
   * A page that was read and had nothing on it comes back with `ocr_text`
   * as an empty string, which is a different thing and says so.
   */
  async getLatest(imageId: number): Promise<ImageText | null> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/image_text/last/${imageId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body?.data ?? null;
  },

  /**
   * Correct what was read off a page.
   *
   * A new row, not an update — the table is insert-only, so the engine's
   * original stays and the correction becomes the current text. Who edited
   * it is taken from the token by the API and is not sent from here.
   */
  async edit(imageId: number, text: string, language: string): Promise<void> {
    const token = await authService.ensureValidToken();
    const response = await fetch(`${API_URL}/image_text/`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ image_id: imageId, ocr_text: text, language }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.message || "Failed to save the text");
    }
  },
};
