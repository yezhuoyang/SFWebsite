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
    // Flip submitting on immediately so the user gets visible feedback
    // ("…" spinner) the moment they click — even before the clipboard /
    // login dance resolves.
    setSubmitting(true);
    try {
      // Resolve the code to grade. Three strategies in order:
      //   1. System clipboard (the click is a user gesture, so most
      //      modern browsers allow this).
      //   2. The persisted chapter buffer (in case a previous submission
      //      already cached it).
      //   3. A native window.prompt() — last-resort fallback that works
      //      even when clipboard permission is denied / unsupported, so
      //      the button always *does something*.
      let codeToGrade = '';
      let clipboardError: unknown = null;
      try {
        const clip = await navigator.clipboard.readText();
        if (clip.trim()) {
          codeToGrade = clip;
          setCode(clip);
        }
      } catch (err) {
        clipboardError = err;
      }
      if (!codeToGrade.trim()) codeToGrade = code;
      if (!codeToGrade.trim()) {
        const promptMsg = clipboardError
          ? "Couldn't read clipboard (permission denied?). Paste your chapter code below:"
          : 'Paste your full chapter code below (or copy from the IDE first with Ctrl+A, Ctrl+C, then click Submit again):';
        const pasted = window.prompt(promptMsg, '');
        if (pasted && pasted.trim()) {
          codeToGrade = pasted;
          setCode(pasted);
        }
      }
      if (!codeToGrade.trim()) {
        setError('No code to submit. Copy from the IDE (Ctrl+A, Ctrl+C) and click Submit again.');
        return;
      }
      try {
        await requireLogin('Sign in to submit exercises.');
      } catch {
        return;
      }
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
        <p className="basis-full text-[11px] text-red-800 bg-red-50 border border-red-200 rounded px-2 py-1.5 mt-1 break-words font-mono leading-snug">
          <strong className="not-italic mr-1">⚠</strong>{error}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-[10px] underline opacity-70 hover:opacity-100"
          >
            dismiss
          </button>
        </p>
      )}
    </>
  );
}
