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
import { useNotify } from './Toast';

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
  const notify = useNotify();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  const status = result?.status;

  /** Run the actual grade once we know what code to submit. */
  const submitWith = async (codeToGrade: string) => {
    if (!codeToGrade.trim()) {
      setError('No code to submit. Copy from the IDE (Ctrl+A, Ctrl+C) and click Submit again.');
      notify({ kind: 'warning', title: 'No code submitted', message: 'Copy your chapter code from the IDE first (Ctrl+A, Ctrl+C).' });
      setSubmitting(false);
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
      // eslint-disable-next-line no-console
      console.log('[ExerciseGradeButton] grading', { exerciseName, codeChars: codeToGrade.length });
      const { all, target, rawError } = await gradeExercise(volumeId, chapterSlug, exerciseName, codeToGrade);
      // eslint-disable-next-line no-console
      console.log('[ExerciseGradeButton] result', { exerciseName, target, all, rawError });
      onResult(all);
      if (!target) {
        // The server compiled the file but didn't include this exercise
        // in its results — usually means the heading name parsed in the
        // sidebar doesn't match the exercise name in the DB.
        notify({
          kind: 'warning',
          title: `Exercise "${exerciseName}" not recognized`,
          message: rawError
            ? `Server compile output:\n${rawError.slice(0, 400)}`
            : `The grader didn't return a result for this exercise. Try the global "Submit & Grade" button at the top.`,
          duration: 0,
        });
        return;
      }
      if (target.status === 'completed') {
        onCompleted?.();
        notify({
          kind: 'success',
          title: `✓ ${exerciseName} — completed!`,
          message: `${target.points} pt earned${target.feedback ? '. ' + target.feedback : ''}`,
        });
        return;
      }
      // status === 'compile_error' | 'tampered' | 'not_started'
      const detail = target.feedback || target.error_detail || target.status;
      setError(detail);
      if (target.status === 'not_started') {
        notify({
          kind: 'warning',
          title: `${exerciseName}: still has Admitted / FILL IN HERE`,
          message: 'Replace the placeholder with your actual proof, then Submit again.',
          duration: 0,
        });
      } else if (target.status === 'tampered') {
        notify({
          kind: 'warning',
          title: `${exerciseName}: original definitions modified`,
          message: detail,
          duration: 0,
        });
      } else {
        notify({
          kind: 'error',
          title: `${exerciseName}: proof failed to compile`,
          message: detail,
          duration: 0,
        });
      }
    } catch (err) {
      const msg = (err as Error).message || 'Grading failed.';
      setError(msg);
      notify({ kind: 'error', title: 'Grading failed', message: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const handleGrade = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    // Diagnostic — if the user reports "nothing happens", this proves
    // the click handler is at least running.
    // eslint-disable-next-line no-console
    console.log('[ExerciseGradeButton] click', { exerciseName });
    // Visible feedback the moment the click registers — the button
    // immediately shows the spinner so the user knows *something*
    // started, even before clipboard / login resolve.
    setSubmitting(true);
    // Pull focus out of the cross-origin iframe so the document is
    // focused when we call clipboard.readText() (Chrome refuses
    // otherwise). Harmless if focus is already on this document.
    try { window.focus(); } catch { /* no-op */ }

    // Try the clipboard with a hard 1.5s timeout — `readText` can hang
    // indefinitely on some browser/permission combinations.
    let codeToGrade = '';
    try {
      const clip = await withTimeout(navigator.clipboard.readText(), 1500);
      if (clip && clip.trim()) {
        codeToGrade = clip;
        setCode(clip);
      }
    } catch {
      /* permission denied / no focus — fall through */
    }
    if (!codeToGrade.trim()) codeToGrade = code;

    if (codeToGrade.trim()) {
      // Fast path: had code in clipboard or buffer — grade immediately.
      // submitWith will reset submitting in its finally block.
      submitWith(codeToGrade);
      return;
    }
    // Slow path: open the paste modal so the user can paste manually
    // or load their last submission from the server.
    setSubmitting(false);
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
        volumeId={volumeId}
        chapterSlug={chapterSlug}
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
