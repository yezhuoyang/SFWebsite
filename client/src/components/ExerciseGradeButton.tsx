/**
 * Per-exercise "Submit" button rendered next to each Exercise heading
 * in the chapter sidebar TOC. Clicking it submits the chapter code to
 * the legacy grading endpoint with `target_exercise` set, triggering
 * the server's per-exercise compile-and-grade flow (truncate-at-end-
 * marker + Admitted / tamper detection).
 *
 * Reads the system clipboard on click (the click is a user gesture so
 * the browser allows `clipboard.readText()`), so the workflow is
 * "edit in iframe IDE → Ctrl+A → Ctrl+C → click Submit".
 *
 * Layout note: this returns a fragment of (button, optional feedback
 * line). The parent row uses `flex-wrap`, and the feedback line uses
 * `basis-full` so it drops to its own line beneath the row when set.
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
}: Props) {
  const { requireLogin } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = result?.status;

  const handleGrade = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setError(null);

    // Always try the clipboard first — the user almost certainly just
    // copied their freshest edit. Fall back to the persisted buffer
    // only if the clipboard is empty / permission is denied.
    let codeToGrade = '';
    try {
      const clip = await navigator.clipboard.readText();
      if (clip.trim()) {
        codeToGrade = clip;
        setCode(clip);
      }
    } catch {
      /* permission denied — fall through */
    }
    if (!codeToGrade.trim()) codeToGrade = code;

    if (!codeToGrade.trim()) {
      setError('Copy your chapter code first: click in the IDE → Ctrl+A → Ctrl+C → Submit.');
      return;
    }
    try {
      await requireLogin('Sign in to submit exercises.');
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

  // Visual styling per status. Default (unsubmitted) is a prominent
  // indigo button so the "submit your work" affordance is obvious.
  const styles: Record<string, string> = {
    completed: 'bg-emerald-600 text-white hover:bg-emerald-700',
    compile_error: 'bg-red-600 text-white hover:bg-red-700',
    tampered: 'bg-amber-600 text-white hover:bg-amber-700',
    not_started: 'bg-indigo-600 text-white hover:bg-indigo-700',
  };
  const icon: Record<string, string> = {
    completed: '✓',
    compile_error: '✗',
    tampered: '!',
    not_started: '',
  };
  const cls = status ? (styles[status] ?? styles.not_started) : 'bg-indigo-600 text-white hover:bg-indigo-700';
  const showIcon = status ? icon[status] : '';

  return (
    <>
      <button
        onClick={handleGrade}
        disabled={submitting}
        className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold shadow-sm disabled:opacity-60 disabled:cursor-not-allowed transition-colors ${cls}`}
        title={
          error
            ? error
            : result
              ? `${result.status}${result.feedback ? ': ' + result.feedback : ''} (${result.points}pt)`
              : 'Submit & grade this exercise'
        }
      >
        {submitting ? (
          <>
            <span className="inline-block w-2.5 h-2.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            …
          </>
        ) : (
          <>
            {showIcon && <span>{showIcon}</span>}
            Submit
          </>
        )}
      </button>
      {error && (
        <p className="basis-full text-[10px] text-red-700 bg-red-50 border-l-2 border-red-300 px-2 py-1 mt-1 ml-2 break-words font-mono leading-snug">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 underline opacity-60 hover:opacity-100"
          >
            dismiss
          </button>
        </p>
      )}
    </>
  );
}
