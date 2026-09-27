/**
 * Unsaved changes to documents, kept on disk rather than in memory.
 *
 * A draft holds the edited picture — a full-size JPEG, which for a scan can
 * be several megabytes. Holding a batch of those in a JavaScript variable is
 * how a tab ends up using a gigabyte, so they live in IndexedDB (the
 * browser's own on-disk store) and only a small thumbnail is ever held open
 * for display. Reading one back costs a moment and happens once, when it is
 * saved.
 *
 * A side effect worth having: drafts survive a reload. Someone whose browser
 * crashes mid-batch still has their work.
 */

import type { Edit } from "../components/documents/ImageEditor";

const DB_NAME = "smartdoc";
const DB_VERSION = 1;
const STORE = "document_drafts";

export type Draft = {
  imageId: number;
  assignmentId: number;
  // A category picked but not yet written. Null means "no change to it".
  categoryId: number | null;
  // The edited picture and its thumbnail, or null when only the category was
  // changed.
  full: Blob | null;
  thumb: Blob | null;
  // How that picture was made — rotation, crop, sliders. Kept so reopening a
  // draft puts the tools back where they were, and so the editor can go on
  // working from the ORIGINAL rather than from an already-edited copy, which
  // would apply everything twice.
  edit: Edit | null;
  updatedAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "imageId" });
        // Drafts are read back a batch at a time, never all at once.
        store.createIndex("assignmentId", "assignmentId", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local storage"));
  });

  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = work(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Local storage refused the write"));
      }),
  );
}

export const draftStore = {
  async put(draft: Draft): Promise<void> {
    await run("readwrite", (store) => store.put(draft));
  },

  async get(imageId: number): Promise<Draft | null> {
    return (await run<Draft | undefined>("readonly", (store) => store.get(imageId))) ?? null;
  },

  async listByAssignment(assignmentId: number): Promise<Draft[]> {
    return await run<Draft[]>("readonly", (store) =>
      store.index("assignmentId").getAll(assignmentId),
    );
  },

  async remove(imageId: number): Promise<void> {
    await run("readwrite", (store) => store.delete(imageId));
  },
};
