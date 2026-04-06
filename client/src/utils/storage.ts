/**
 * localStorage persistence for user progress.
 * Data survives browser restarts; only cleared by user manually.
 *
 * Keys:
 *   sf:edits:{volume}:{chapter}   → JSON { blockId: editedContent, ... }
 *   sf:grades:{volume}:{chapter}  → JSON { exerciseName: { status, points, gradedAt }, ... }
 */

const PREFIX = 'sf';

function editsKey(volume: string, chapter: string): string {
  return `${PREFIX}:edits:${volume}:${chapter}`;
}

function gradesKey(volume: string, chapter: string): string {
  return `${PREFIX}:grades:${volume}:${chapter}`;
}

// ── Block edits ──────────────────────────────────────────────

export function saveBlockEdits(
  volume: string,
  chapter: string,
  edits: Map<number, string>,
): void {
  const obj: Record<string, string> = {};
  edits.forEach((content, blockId) => {
    obj[String(blockId)] = content;
  });
  try {
    localStorage.setItem(editsKey(volume, chapter), JSON.stringify(obj));
  } catch {
    // localStorage full — silently ignore
  }
}

export function loadBlockEdits(
  volume: string,
  chapter: string,
): Map<number, string> | null {
  try {
    const raw = localStorage.getItem(editsKey(volume, chapter));
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

export function clearBlockEdits(volume: string, chapter: string): void {
  localStorage.removeItem(editsKey(volume, chapter));
}

// ── Grade results ────────────────────────────────────────────

export interface StoredGrade {
  status: string;       // "completed" | "not_started"
  points: number;
  gradedAt: number;     // timestamp ms
}

export function saveGradeResults(
  volume: string,
  chapter: string,
  grades: Record<string, StoredGrade>,
): void {
  try {
    localStorage.setItem(gradesKey(volume, chapter), JSON.stringify(grades));
  } catch {
    // silently ignore
  }
}

export function loadGradeResults(
  volume: string,
  chapter: string,
): Record<string, StoredGrade> | null {
  try {
    const raw = localStorage.getItem(gradesKey(volume, chapter));
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, StoredGrade>;
  } catch {
    return null;
  }
}

/** Count locally-completed exercises for a chapter */
export function countLocalCompleted(volume: string, chapter: string): number {
  const grades = loadGradeResults(volume, chapter);
  if (!grades) return 0;
  return Object.values(grades).filter(g => g.status === 'completed').length;
}

/** Get total local completions across all chapters for a volume.
 *  Scans all localStorage keys matching sf:grades:{volume}:* */
export function countVolumeLocalCompleted(volume: string): number {
  const prefix = `${PREFIX}:grades:${volume}:`;
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
