/**
 * Per-exercise "Submit" button rendered next to each Exercise heading
 * in the chapter sidebar TOC. Clicking it submits the chapter code to
 * the grading endpoint with `target_exercise` set.
 *
 * Code-resolution flow on click (in order):
 *   1. **Read iframe DOM** — the iframe is now same-origin (via
 *      /sfproxy), so we walk every CodeMirror instance and POST the
 *      array of edited blocks to the server's splice endpoint. The
 *      server reassembles the chapter file (prose comments + Exercise
 *      headers preserved) before grading. This is the happy path —
 *      no clipboard, no modal.
 *   2. Clipboard.readText() with timeout — fallback if the iframe
 *      hasn't finished loading or the DOM read fails.
 *   3. Persisted chapter buffer.
 *   4. CodePasteModal — last-resort textarea so the button still does
 *      something visible if everything else falls through.
 */

import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { gradeExercise, type ExerciseGradingResult } from '../coq/exerciseGrading';
import { gradeChapterBlocks } from '../api/client';
import { readChapterBlocks } from '../coq/iframeReader';
import CodePasteModal from './CodePasteModal';
import { useNotify } from './Toast';

interface Props {
  volumeId: string;
  chapterSlug: string;
  exerciseName: string;
  /** Same-origin SF iframe — the happy-path read source. */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
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

/** Heuristic: does this string plausibly look like a full SF chapter
 *  source? We require at least 200 chars AND the presence of at least
 *  one structural Coq keyword. Stale clipboard contents (a single
 *  identifier, an English sentence, etc.) get rejected client-side
 *  rather than triggering the server's "near-empty" guard at 10 chars.
 *
 *  The grader compiles the file from the top down, so it needs the
 *  imports / dependencies of the chapter — a single theorem snippet
 *  isn't useful even if it's > 10 chars. */
function looksLikeChapter(s: string): boolean {
  if (s.length < 200) return false;
  return /\b(Require|From|Import|Theorem|Lemma|Definition|Inductive|Fixpoint|Module|Example)\b/.test(s);
}

export default function ExerciseGradeButton({
  volumeId,
  chapterSlug,
  exerciseName,
  iframeRef,
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

  /** Process a grade result (shared between block-submit and
   *  full-content-submit paths). */
  const processResult = (
    all: import('../api/client').ExerciseGrade[],
    target: import('../api/client').ExerciseGrade | undefined,
    rawError: string | null | undefined,
  ) => {
    onResult(all);
    if (!target) {
      const looksTruncated = rawError && /not found in/i.test(rawError);
      notify({
        kind: 'warning',
        title: looksTruncated
          ? `Couldn't find "${exerciseName}" in your code`
          : `Exercise "${exerciseName}" not recognized`,
        message: looksTruncated
          ? 'The chapter source is missing this exercise header. Reload the chapter and try again.'
          : (rawError
            ? `Server output:\n${rawError.slice(0, 400)}`
            : `The grader didn't return a result. Try the global "Submit & Grade" button at the top.`),
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
  };

  /** Submit using the same-origin iframe DOM read (preferred). */
  const submitWithBlocks = async (blocks: string[]) => {
    setError(null);
    setSubmitting(true);
    try {
      try {
        await requireLogin('Sign in to submit exercises.');
      } catch {
        return;
      }
      // eslint-disable-next-line no-console
      console.log('[ExerciseGradeButton] grading via blocks', { exerciseName, count: blocks.length });
      const result = await gradeChapterBlocks(volumeId, chapterSlug, blocks, exerciseName);
      const target = result.exercises.find(e => e.name === exerciseName);
      // eslint-disable-next-line no-console
      console.log('[ExerciseGradeButton] result', { exerciseName, target, exercises: result.exercises });
      processResult(result.exercises, target, result.compile_output);
    } catch (err) {
      const msg = (err as Error).message || 'Grading failed.';
      setError(msg);
      notify({ kind: 'error', title: 'Grading failed', message: msg });
    } finally {
      setSubmitting(false);
    }
  };

  /** Legacy: submit a full chapter file (string) — used by clipboard /
   *  modal fallback paths. */
  const submitWith = async (codeToGrade: string) => {
    if (!codeToGrade.trim()) {
      setError('No code to submit.');
      notify({ kind: 'warning', title: 'No code submitted' });
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
      console.log('[ExerciseGradeButton] grading via content', { exerciseName, codeChars: codeToGrade.length });
      const { all, target, rawError } = await gradeExercise(volumeId, chapterSlug, exerciseName, codeToGrade);
      processResult(all, target, rawError);
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
    // eslint-disable-next-line no-console
    console.log('[ExerciseGradeButton] click', { exerciseName });
    setSubmitting(true);

    // Happy path: read every CodeMirror block from the same-origin
    // iframe and let the server splice + grade.
    const blocks = readChapterBlocks(iframeRef.current);
    if (blocks && blocks.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[ExerciseGradeButton] read', { count: blocks.length, totalChars: blocks.reduce((n, b) => n + b.length, 0) });
      submitWithBlocks(blocks);
      return;
    }

    // Fallback: clipboard / buffer / modal (legacy behavior — kicks in
    // if the iframe DOM isn't ready or the proxy went sideways).
    try { window.focus(); } catch { /* no-op */ }
    let codeToGrade = '';
    try {
      const clip = await withTimeout(navigator.clipboard.readText(), 1500);
      if (clip && looksLikeChapter(clip)) {
        codeToGrade = clip;
        setCode(clip);
      }
    } catch {
      /* permission denied / no focus — fall through */
    }
    if (!codeToGrade && looksLikeChapter(code)) codeToGrade = code;
    if (codeToGrade) {
      submitWith(codeToGrade);
      return;
    }
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
