/**
 * Per-exercise grading hook.
 *
 * The legacy grading API (`PUT /api/coq/file/<vol>/<chapter>` with
 * `{ content, target_exercise }`) does the heavy lifting:
 *
 *   - truncates the file at the target exercise's `(** [] *)` end marker
 *   - auto-closes any open Module / Section
 *   - runs `coqc` (90s timeout)
 *   - checks for `Admitted.` / `FILL IN HERE` → marks as `not_started`
 *   - tamper-checks identifiers against the original `.v.orig` template
 *   - returns per-exercise status / points / feedback / error_detail
 *
 * Our cross-origin iframe means we can't read the user's edited code
 * directly; instead the user pastes the chapter buffer once into a
 * shared textarea (persisted per-chapter in localStorage) and any
 * Grade button on a specific exercise sends `{ content, target_exercise }`
 * to the same legacy endpoint.
 */

import { useEffect, useState, useCallback } from 'react';
import { saveChapterFile, getChapterProgress, type ExerciseGrade, type ChapterProgress } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

/** localStorage key for the user's pasted chapter code. */
function bufferKey(volumeId: string, slug: string): string {
  return `sf:codeBuffer:${volumeId}:${slug}`;
}

// Bump this when the splice pipeline changes in ways that make old
// localStorage blocks bad to restore (e.g. previous splice produced
// content that doesn't match the iframe's current CodeMirrors). The
// key is part of the localStorage path, so an older version's blocks
// stay parked but never get loaded again.
const BLOCKS_SCHEMA_VERSION = 'v3';

function blocksKey(volumeId: string, slug: string): string {
  return `sf:blocks:${BLOCKS_SCHEMA_VERSION}:${volumeId}:${slug}`;
}

/** Persistent per-chapter code buffer. The textarea reads/writes this;
 *  Grade buttons on individual exercises read it too. */
export function useChapterCodeBuffer(volumeId: string, slug: string) {
  const [code, setCode] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(bufferKey(volumeId, slug)) ?? '';
  });
  // Reset when chapter changes (different localStorage slot).
  useEffect(() => {
    setCode(localStorage.getItem(bufferKey(volumeId, slug)) ?? '');
  }, [volumeId, slug]);
  const persist = useCallback((next: string) => {
    setCode(next);
    try { localStorage.setItem(bufferKey(volumeId, slug), next); } catch { /* quota */ }
  }, [volumeId, slug]);
  return { code, setCode: persist };
}

/** Persistent per-block edits, written after every successful Submit
 *  and restored into the iframe's CodeMirror instances on chapter load
 *  (so navigating away and back doesn't lose the user's solution). */
export function useChapterBlocks(volumeId: string, slug: string) {
  const key = blocksKey(volumeId, slug);
  const read = useCallback((): string[] | null => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every(s => typeof s === 'string')) return parsed;
    } catch { /* malformed */ }
    return null;
  }, [key]);
  const write = useCallback((blocks: string[]) => {
    try { localStorage.setItem(key, JSON.stringify(blocks)); } catch { /* quota */ }
  }, [key]);
  return { read, write };
}

export interface ExerciseGradingResult extends ExerciseGrade {
  gradedAt: number;
}

/** Per-exercise grading state for the current chapter, keyed by
 *  exercise name. Persisted to localStorage so results survive a
 *  reload. */
export function useExerciseGrades(volumeId: string, slug: string) {
  const key = `sf:exGrades:${volumeId}:${slug}`;
  const [grades, setGrades] = useState<Record<string, ExerciseGradingResult>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { return {}; }
  });
  useEffect(() => {
    try { setGrades(JSON.parse(localStorage.getItem(key) ?? '{}')); } catch { setGrades({}); }
  }, [key]);
  const recordGrade = useCallback((ex: ExerciseGrade) => {
    setGrades(prev => {
      const next = { ...prev, [ex.name]: { ...ex, gradedAt: Date.now() } };
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }, [key]);
  return { grades, recordGrade };
}

/** Submit the chapter buffer to grade ONE exercise. The server returns
 *  results for every exercise it knew about (because it has to compile
 *  past dependent definitions); we pick out the targeted one to surface
 *  immediately, but record results for ALL of them so the sidebar
 *  status colors reflect the latest run. */
export async function gradeExercise(
  volumeId: string,
  chapterSlug: string,
  exerciseName: string,
  code: string,
): Promise<{ target?: ExerciseGrade; all: ExerciseGrade[]; rawError?: string | null }> {
  const result = await saveChapterFile(volumeId, chapterSlug, code, exerciseName);
  const target = result.exercises.find(e => e.name === exerciseName);
  return {
    target,
    all: result.exercises,
    rawError: result.compile_output ?? null,
  };
}

/** Parse the exercise name (the bit in parens at the end of the
 *  Exercise heading, e.g. "Exercise: 2 stars, standard (list_funs)"
 *  → "list_funs"). Returns null if the heading isn't an exercise or
 *  the name can't be extracted. */
export function parseExerciseName(headingText: string): string | null {
  if (!headingText.startsWith('Exercise:')) return null;
  const m = headingText.match(/\(([A-Za-z_][A-Za-z_0-9]*)\)\s*$/);
  return m ? m[1] : null;
}

/** Fetches and caches the current user's per-chapter exercise progress
 *  from the server. Refreshes when (volume, slug, user) changes, and
 *  exposes a `refresh()` function the Grade button can call after each
 *  submission. Returns null while loading or when not signed in. */
export function useChapterProgress(volumeId: string, slug: string) {
  const { user } = useAuth();
  const [progress, setProgress] = useState<ChapterProgress | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setProgress(null);
      return;
    }
    getChapterProgress(volumeId, slug)
      .then(p => { if (!cancelled) setProgress(p); })
      .catch(() => { if (!cancelled) setProgress(null); });
    return () => { cancelled = true; };
  }, [volumeId, slug, user, refreshTick]);

  const refresh = useCallback(() => setRefreshTick(t => t + 1), []);
  return { progress, refresh };
}
