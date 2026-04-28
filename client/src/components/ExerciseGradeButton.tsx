/**
 * Per-exercise "Submit" button rendered next to each Exercise heading
 * in the chapter sidebar TOC. Clicking it submits the chapter code to
 * the legacy grading endpoint with `target_exercise` set, triggering
 * the server's per-exercise compile-and-grade flow (truncate-at-end-
 * marker + Admitted / tamper detection).
 *
 * Code-resolution flow on click:
 *   1. window.focus() — pull focus out of the cross-origin iframe so
 *      the clipboard API will let us read.
 *   2. clipboard.readText() with a 1500ms timeout — workflow is
 *      "edit in iframe IDE → Ctrl+A → Ctrl+C → click Submit".
 *   3. Persisted chapter buffer (in case clipboard is empty / denied
 *      but we already cached code from a previous submission).
 *   4. CodePasteModal — last-resort textarea modal so the button
 *      always *does something* visible when clicked, even when
 *      clipboard permission is denied.
 *
 * Layout note: this returns a fragment of (button, optional feedback
 * line, optional modal). The parent row uses `flex-wrap`, and the
 * feedback line uses `basis-full` so it drops to its own line beneath
 * the row when set.
 */

import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { gradeExercise, type ExerciseGradingResult } from '../coq/exerciseGrading';
import CodePasteModal from './CodePasteModal';

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

/** Race a promise against a timeout. Returns null if the timeout wins. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>(resolve => setTimeout(() => resolve(null), ms)),
  ]);
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
  const [showModal, setShowModal] = useState(false);

  const status = result?.status;

  /** Run the actual grade once we know what code to submit. */
  const submitWith = async (codeToGrade: string) => {
    if (!codeToGrade.trim()) {
      setError('No code to submit. Copy from the IDE (Ctrl+A, Ctrl+C) and click Submit again.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
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

  const handleGrade = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    // Pull focus out of the cross-origin iframe so the document is
    // focused when we call clipboard.readText() (Chrome refuses
    // otherwise). Harmless if focus is already on this document.
    try { window.focus(); } catch { /* no-op */ }

    // Try the clipboard with a hard 1.5s timeout — `readText` can hang
    // indefinitely on some browser/permission combinations, which would
    // make the button feel broken.
    let codeToGrade = '';
    let clipboardErr: unknown = null;
    try {
      const clip = await withTimeout(navigator.clipboard.readText(), 1500);
      if (clip && clip.trim()) {
        codeToGrade = clip;
        setCode(clip);
      } else if (clip === null) {
        clipboardErr = new Error('clipboard read timed out');
      }
    } catch (err) {
      clipboardErr = err;
    }
    if (!codeToGrade.trim()) codeToGrade = code;

    if (codeToGrade.trim()) {
      // Got code from clipboard or buffer — grade immediately.
      submitWith(codeToGrade);
      return;
    }
    // Last resort: open the paste modal. We open it whether or not
    // there was a clipboard error — the user always sees a clear
    // affordance to paste their code.
    void clipboardErr;
    setShowModal(true);
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
      <CodePasteModal
        open={showModal}
        initial={code}
        title={`Grade exercise: ${exerciseName}`}
        onCancel={() => setShowModal(false)}
        onSubmit={pasted => {
          setShowModal(false);
          if (pasted.trim()) {
            setCode(pasted);
            submitWith(pasted);
          }
        }}
      />
    </>
  );
}
