/**
 * localStorage persistence for per-user progress.
 *
 * PRIVACY: every key is namespaced by userId so two users on the same browser
 * never see each other's grades, edits, or annotations. Anonymous (logged-out)
 * usage falls under the literal "anon" namespace.
 *
 * Keys:
 *   sf:u:{userId}:edits:{volume}:{chapter}        → JSON { blockId: editedContent, ... }
 *   sf:u:{userId}:grades:{volume}:{chapter}       → JSON { exerciseName: { status, points, gradedAt }, ... }
 *   sf:u:{userId}:annotations:{volume}:{chapter}  → JSON Annotation[]
 */

const PREFIX = 'sf';
type UserId = number | string | null | undefined;

function uid(userId: UserId): string {
  return userId == null ? 'anon' : String(userId);
}

function editsKey(userId: UserId, volume: string, chapter: string): string {
  return `${PREFIX}:u:${uid(userId)}:edits:${volume}:${chapter}`;
}

function gradesKey(userId: UserId, volume: string, chapter: string): string {
  return `${PREFIX}:u:${uid(userId)}:grades:${volume}:${chapter}`;
}

function annotationsKey(userId: UserId, volume: string, chapter: string): string {
  return `${PREFIX}:u:${uid(userId)}:annotations:${volume}:${chapter}`;
}

// ── Block edits ──────────────────────────────────────────────

export function saveBlockEdits(
  userId: UserId,
  volume: string,
  chapter: string,
  edits: Map<number, string>,
): void {
  const obj: Record<string, string> = {};
  edits.forEach((content, blockId) => {
    obj[String(blockId)] = content;
  });
  try {
    localStorage.setItem(editsKey(userId, volume, chapter), JSON.stringify(obj));
  } catch {
    // localStorage full — silently ignore
  }
}

export function loadBlockEdits(
  userId: UserId,
  volume: string,
  chapter: string,
): Map<number, string> | null {
  try {
    const raw = localStorage.getItem(editsKey(userId, volume, chapter));
    if (!raw) return null;
    const obj = JSON.parse(raw) as Record<string, string>;
    const map = new Map<number, string>();
    for (const [k, v] of Object.entries(obj)) {
      map.set(Number(k), v);
    }
    return map;
  } catch {
    return null;
  }
}

export function clearBlockEdits(userId: UserId, volume: string, chapter: string): void {
  localStorage.removeItem(editsKey(userId, volume, chapter));
}

// ── Grade results ────────────────────────────────────────────

export interface StoredGrade {
  status: string;       // "completed" | "not_started"
  points: number;
  gradedAt: number;     // timestamp ms
}

export function saveGradeResults(
  userId: UserId,
  volume: string,
  chapter: string,
  grades: Record<string, StoredGrade>,
): void {
  try {
    localStorage.setItem(gradesKey(userId, volume, chapter), JSON.stringify(grades));
  } catch {
    // silently ignore
  }
}

export function loadGradeResults(
  userId: UserId,
  volume: string,
  chapter: string,
): Record<string, StoredGrade> | null {
  try {
    const raw = localStorage.getItem(gradesKey(userId, volume, chapter));
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, StoredGrade>;
  } catch {
    return null;
  }
}

/** Count locally-completed exercises for a chapter (this user only). */
export function countLocalCompleted(userId: UserId, volume: string, chapter: string): number {
  const grades = loadGradeResults(userId, volume, chapter);
  if (!grades) return 0;
  return Object.values(grades).filter(g => g.status === 'completed').length;
}

// ── Annotations ──────────────────────────────────────────────

export interface Annotation {
  id: string;           // unique id
  blockId: number;
  selectedText: string; // the text that was selected (used to find & highlight)
  color: string;        // user-chosen color for underline
  startLine: number;    // 1-indexed within the block (for Monaco code blocks)
  startCol: number;
  endLine: number;
  endCol: number;
  text: string;         // user's note
  createdAt: number;
}

export function loadAnnotations(userId: UserId, volume: string, chapter: string): Annotation[] {
  try {
    const raw = localStorage.getItem(annotationsKey(userId, volume, chapter));
    if (!raw) return [];
    return JSON.parse(raw) as Annotation[];
  } catch {
    return [];
  }
}

export function saveAnnotations(userId: UserId, volume: string, chapter: string, annotations: Annotation[]): void {
  try {
    localStorage.setItem(annotationsKey(userId, volume, chapter), JSON.stringify(annotations));
  } catch { /* ignore */ }
}

export function clearAnnotations(userId: UserId, volume: string, chapter: string): void {
  localStorage.removeItem(annotationsKey(userId, volume, chapter));
}

/** Get total local completions across all chapters for a volume (this user). */
export function countVolumeLocalCompleted(userId: UserId, volume: string): number {
  const prefix = `${PREFIX}:u:${uid(userId)}:grades:${volume}:`;
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const grades = JSON.parse(raw) as Record<string, StoredGrade>;
          total += Object.values(grades).filter(g => g.status === 'completed').length;
        }
      }
    }
  } catch { /* ignore */ }
  return total;
}
