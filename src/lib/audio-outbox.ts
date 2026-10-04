/**
 * Lesson audio that couldn't reach storage (signed out mid-lesson, no internet) waits here, in the
 * browser's IndexedDB, so it survives a reload and is uploaded once the teacher is back.
 * `queue` remembers which lessons still have to be sent to ai-transcribe.
 */

export interface PendingSegment {
  key: string; // `${lessonId}/${name}`
  lessonId: string;
  userId: string;
  name: string;
  blob: Blob;
}

const DB = "seal-lesson-audio";
const STORE = "segments";
const QUEUE_KEY = "seal-transcribe-queue";

// IndexedDB can be unavailable (private mode, quota) — then segments at least live until the tab closes.
const memory = new Map<string, PendingSegment>();

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const outbox = {
  async put(seg: Omit<PendingSegment, "key">) {
    const item = { ...seg, key: `${seg.lessonId}/${seg.name}` };
    try {
      await run("readwrite", (s) => s.put(item));
    } catch {
      memory.set(item.key, item);
    }
  },
  async all(): Promise<PendingSegment[]> {
    const stored = await run<PendingSegment[]>("readonly", (s) => s.getAll()).catch(() => []);
    return [...stored, ...memory.values()];
  },
  async remove(key: string) {
    memory.delete(key);
    await run("readwrite", (s) => s.delete(key)).catch(() => {});
  },
};

interface Queued {
  lessonId: string;
  userId: string;
}

function read(): Queued[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function write(items: Queued[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch {
    // storage is full or blocked — the lesson card still offers a manual retry
  }
}

export const queue = {
  list: (userId: string) => read().filter((q) => q.userId === userId).map((q) => q.lessonId),
  add(lessonId: string, userId: string) {
    const items = read();
    if (!items.some((q) => q.lessonId === lessonId)) write([...items, { lessonId, userId }]);
  },
  remove: (lessonId: string) => write(read().filter((q) => q.lessonId !== lessonId)),
};
