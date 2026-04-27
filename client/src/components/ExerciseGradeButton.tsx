/**
 * Compact "Grade" button shown next to each exercise entry in the
 * chapter sidebar TOC. Clicking it submits the shared chapter code
 * buffer to the legacy grading endpoint with `target_exercise` set,
 * which triggers the server's per-exercise compile-and-grade flow
 * (truncate-at-end-marker + Admitted / tamper detection).
 *
 * If the buffer is empty, the button surfaces an error guiding the
 * user to paste their code first.
 */

import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { gradeExercise, type ExerciseGradingResult } from '../coq/exerciseGrading';

interface Props {
  volumeId: string;
  chapterSlug: string;
  exerciseName: string;
  /** Current chapter code buffer (from useChapterCodeBuffer). */
  code: string;
  /** Persist a fresh buffer to localStorage (clipboard auto-sync uses this). */
  setCode: (next: string) => void;
  /** Latest stored grade for this exercise (from useExerciseGrades). */
  result: ExerciseGradingResult | undefined;
  /** Called with one ExerciseGrade per exercise the server reports back
   *  (a single grade-call returns results for everything it compiled). */
  onResult: (grades: import('../api/client').ExerciseGrade[]) => void;
  /** Called when an exercise becomes `completed` (parent bumps a counter
   *  to refresh leaderboard widgets etc.). */
  onCompleted?: () => void;
  /** Surface the buffer panel when something needs the user's attention. */
  onNeedCode?: () => void;
}

export default function ExerciseGradeButton({
  volumeId,
  chapterSlug,
  exerciseName,
  code,
  setCode,
  result,
  onResult,
  onCompleted,
  onNeedCode,
}: Props) {
  const { requireLogin } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = result?.status;

  const handleGrade = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setError(null);

    // Resolve the code we'll grade with. Prefer the persisted buffer;
    // if empty, try the system clipboard (the click is a user gesture
    // so the browser will allow `clipboard.readText()`). This lets the
    // user just Ctrl+A, Ctrl+C in the iframe and immediately click
    // Grade — no textarea round-trip.
    let codeToGrade = code;
    if (!codeToGrade.trim()) {
      try {
        const clip = await navigator.clipboard.readText();
        if (clip.trim()) {
          codeToGrade = clip;
          setCode(clip); // also persist for subsequent Grade clicks
        }
      } catch {
        // Permission denied (Firefox / Safari without user setting), or
        // clipboard API unavailable. Fall through to the empty-buffer
        // error below.
      }
    }
    if (!codeToGrade.trim()) {
      setError('Copy your chapter code first: click in the IDE → Ctrl+A → Ctrl+C → click Grade.');
      onNeedCode?.();
      return;
    }
    try {
      await requireLogin('Sign in to grade exercises.');
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      const { all, target } = await gradeExercise(volumeId, chapterSlug, exerciseName, codeToGrade);
      onResult(all);
      if (target?.status === 'completed') onCompleted?.();
      if (target && target.status !== 'completed') {
        setError(target.feedback || target.error_detail || target.status);
      }
    } catch (err) {
      setError((err as Error).message || 'Grading failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const colors: Record<string, string> = {
    completed: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200',
    compile_error: 'bg-red-100 text-red-700 hover:bg-red-200',
    tampered: 'bg-amber-100 text-amber-700 hover:bg-amber-200',
    not_started: 'bg-gray-100 text-gray-600 hover:bg-gray-200',
  };
  const label: Record<string, string> = {
    completed: '✓',
    compile_error: '✗',
    tampered: '!',
    not_started: '·',
  };
  const cls = status ? (colors[status] ?? colors.not_started) : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100';

  return (
    <div className="inline-flex items-center gap-1">
      <button
        onClick={handleGrade}
        disabled={submitting}
        className={`px-1.5 py-0.5 rounded text-[10px] font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${cls}`}
        title={
          error
            ? error
            : result
              ? `${result.status}${result.feedback ? ': ' + result.feedback : ''} (${result.points}pt)`
              : 'Grade this exercise'
        }
      >
        {submitting ? '…' : status ? label[status] ?? 'Grade' : 'Grade'}
      </button>
    </div>
  );
}
