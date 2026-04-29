/**
 * Sticky toolbar pinned to the top of the chapter pane.
 *
 * Two responsibilities:
 *  1. Show the user's per-exercise progress (X / Y exercises, points, %).
 *  2. Host the prominent **Submit & Grade** button — the obvious thing
 *     the user clicks after editing their proof in the iframe IDE.
 *
 * Code-resolution flow on click matches ExerciseGradeButton:
 *   1. window.focus() — pull focus out of the cross-origin iframe.
 *   2. clipboard.readText() with a 1500ms timeout.
 *   3. Persisted chapter buffer.
 *   4. CodePasteModal — last-resort textarea modal.
 */

import { useState } from 'react';
import { saveChapterFile, gradeChapterBlocks, type ChapterProgress, type ExerciseGrade, type SaveResult } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useChapterCodeBuffer, useExerciseGrades, useChapterBlocks } from '../coq/exerciseGrading';
import { readChapterBlocks } from '../coq/iframeReader';
import CodePasteModal from './CodePasteModal';
import { useNotify } from './Toast';

interface Props {
  progress: ChapterProgress | null;
  volumeId: string;
  chapterSlug: string;
  /** Same-origin SF iframe — happy-path read source for the Submit
   *  & Grade button. */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** Called after a successful grade so the parent can refetch
   *  per-chapter progress and bump leaderboard widgets. */
  onGraded: () => void;
  /** TOC visibility (left sidebar). Collapsed gives the IDE
   *  more horizontal space. */
  tocOpen?: boolean;
  onToggleToc?: () => void;
  /** Fullscreen / Present mode toggle. */
  isPresenting?: boolean;
  onPresent?: () => void;
}

interface SubmitFeedback {
  kind: 'ok' | 'partial' | 'error';
  message: string;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>(resolve => setTimeout(() => resolve(null), ms)),
  ]);
}

/** Plausibility check — see ExerciseGradeButton for rationale. */
function looksLikeChapter(s: string): boolean {
  if (s.length < 200) return false;
  return /\b(Require|From|Import|Theorem|Lemma|Definition|Inductive|Fixpoint|Module|Example)\b/.test(s);
}

export default function ChapterProgressBar({
  progress, volumeId, chapterSlug, iframeRef, onGraded,
  tocOpen, onToggleToc, isPresenting, onPresent,
}: Props) {
  const { requireLogin } = useAuth();
  const notify = useNotify();
  const { code, setCode } = useChapterCodeBuffer(volumeId, chapterSlug);
  const { recordGrade } = useExerciseGrades(volumeId, chapterSlug);
  const { write: persistBlocks } = useChapterBlocks(volumeId, chapterSlug);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<SubmitFeedback | null>(null);
  const [showModal, setShowModal] = useState(false);

  /** Render a SaveResult into toast + inline feedback. Shared by both
   *  the block-submit (preferred) and full-content paths. */
  const processResult = (result: SaveResult) => {
    result.exercises.forEach((ex: ExerciseGrade) => recordGrade(ex));
    onGraded();
    const okCount = result.exercises.filter(e => e.status === 'completed').length;
    const failCount = result.exercises.filter(e => e.status === 'compile_error' || e.status === 'tampered').length;
    const admittedCount = result.exercises.filter(e => e.status === 'not_started').length;
    if (okCount === 0 && failCount > 0) {
      const first = result.exercises.find(e => e.status === 'compile_error' || e.status === 'tampered');
      const msg = first?.feedback || first?.error_detail || `${failCount} exercise(s) failed to compile.`;
      setFeedback({ kind: 'error', message: msg });
      notify({ kind: 'error', title: `Grading: ${failCount} failed`, message: msg, duration: 0 });
    } else if (failCount > 0) {
      const msg = `${okCount} completed, ${failCount} failed${admittedCount ? `, ${admittedCount} still Admitted` : ''}.`;
      setFeedback({ kind: 'partial', message: msg });
      notify({ kind: 'warning', title: 'Partial success', message: msg, duration: 0 });
    } else if (okCount > 0) {
      const msg = `${okCount} exercise(s) completed${admittedCount ? `, ${admittedCount} still Admitted` : ''}.`;
      setFeedback({ kind: 'ok', message: msg });
      notify({ kind: 'success', title: 'Graded ✓', message: msg });
    } else {
      const msg = 'No completed exercises detected. Replace Admitted / FILL IN HERE with your proofs.';
      setFeedback({ kind: 'ok', message: msg });
      notify({ kind: 'warning', title: 'Nothing graded', message: msg, duration: 0 });
    }
  };

  const submitWithBlocks = async (blocks: string[]) => {
    setFeedback(null);
    setSubmitting(true);
    try {
      try {
        await requireLogin('Sign in to submit your solution.');
      } catch {
        return;
      }
      // eslint-disable-next-line no-console
      console.log('[ChapterProgressBar] grading via blocks', { count: blocks.length });
      persistBlocks(blocks);
      const result = await gradeChapterBlocks(volumeId, chapterSlug, blocks);
      processResult(result);
    } catch (err) {
      const msg = (err as Error).message || 'Grading failed.';
      setFeedback({ kind: 'error', message: msg });
      notify({ kind: 'error', title: 'Grading failed', message: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const submitWith = async (codeToGrade: string) => {
    if (!codeToGrade.trim()) {
      setFeedback({ kind: 'error', message: 'No code to submit.' });
      setSubmitting(false);
      return;
    }
    setFeedback(null);
    setSubmitting(true);
    try {
      try {
        await requireLogin('Sign in to submit your solution.');
      } catch {
        return;
      }
      const result = await saveChapterFile(volumeId, chapterSlug, codeToGrade);
      processResult(result);
    } catch (err) {
      const msg = (err as Error).message || 'Grading failed.';
      setFeedback({ kind: 'error', message: msg });
      notify({ kind: 'error', title: 'Grading failed', message: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    // eslint-disable-next-line no-console
    console.log('[ChapterProgressBar] Submit & Grade click');
    setFeedback(null);
    setSubmitting(true);

    // Happy path: read every editable block from the same-origin iframe.
    const blocks = readChapterBlocks(iframeRef.current);
    if (blocks && blocks.length > 0) {
      submitWithBlocks(blocks);
      return;
    }

    // Fallback: clipboard / buffer / paste modal.
    try { window.focus(); } catch { /* no-op */ }
    let codeToGrade = '';
    try {
      const clip = await withTimeout(navigator.clipboard.readText(), 1500);
      if (clip && looksLikeChapter(clip)) {
        codeToGrade = clip;
        setCode(clip);
      }
    } catch {
      /* permission denied — fall through */
    }
    if (!codeToGrade && looksLikeChapter(code)) codeToGrade = code;
    if (codeToGrade) {
      submitWith(codeToGrade);
      return;
    }
    setSubmitting(false);
    setShowModal(true);
  };

  const pct = progress && progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;
  const ptsPct = progress && progress.points_total > 0
    ? Math.round((progress.points_earned / progress.points_total) * 100)
    : 0;

  return (
    <div className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-gray-200 shadow-sm">
      <div className="px-4 py-2 flex items-center gap-2 text-[12px]">
        {onToggleToc && (
          <button
            onClick={onToggleToc}
            className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded border border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
            title={tocOpen ? 'Hide chapter sidebar' : 'Show chapter sidebar'}
            aria-label={tocOpen ? 'Hide sidebar' : 'Show sidebar'}
          >
            {tocOpen ? '◀' : '▶'}
          </button>
        )}
        {onPresent && (
          <button
            onClick={onPresent}
            className={`shrink-0 inline-flex items-center gap-1 px-2 h-7 rounded border text-[11px] font-semibold transition-colors ${
              isPresenting
                ? 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                : 'border-gray-200 text-gray-700 hover:bg-gray-100 hover:text-gray-900'
            }`}
            title={isPresenting ? 'Exit presentation mode (Esc)' : 'Enter fullscreen presentation'}
          >
            {isPresenting ? '⤓ Exit' : '⛶ Present'}
          </button>
        )}
        {(onToggleToc || onPresent) && <span className="text-gray-200">|</span>}
        {progress && progress.total > 0 ? (
          <>
            <span className="font-bold text-gray-800">
              {progress.completed} / {progress.total}
            </span>
            <span className="text-gray-400">exercises</span>
            <span className="text-gray-300">·</span>
            <span className="font-mono text-gray-700">
              {progress.points_earned.toFixed(0)} / {progress.points_total.toFixed(0)} pt
            </span>
            <span className="text-gray-300">·</span>
            <span className={`font-bold ${pct >= 100 ? 'text-emerald-600' : pct >= 50 ? 'text-indigo-600' : 'text-gray-500'}`}>
              {pct}%
            </span>
            <div className="flex-1 max-w-[160px] h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${pct >= 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                style={{ width: `${Math.max(pct, ptsPct, 1)}%` }}
              />
            </div>
          </>
        ) : (
          <span className="text-gray-400 italic">No progress yet — copy your code from the IDE and click Submit.</span>
        )}
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 text-white text-[12px] font-semibold shadow-sm hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          title="Copy your code from the IDE (Ctrl+A, Ctrl+C), then click here to grade the whole chapter."
        >
          {submitting ? (
            <>
              <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Grading…
            </>
          ) : (
            <>Submit &amp; Grade</>
          )}
        </button>
      </div>
      {feedback && (
        <div
          className={`px-4 py-1.5 text-[11px] border-t ${
            feedback.kind === 'ok'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-100'
              : feedback.kind === 'partial'
                ? 'bg-amber-50 text-amber-800 border-amber-100'
                : 'bg-red-50 text-red-800 border-red-100'
          }`}
        >
          <span className="font-mono whitespace-pre-wrap">{feedback.message}</span>
          <button
            onClick={() => setFeedback(null)}
            className="ml-2 text-[10px] underline opacity-60 hover:opacity-100"
          >
            dismiss
          </button>
        </div>
      )}
      <CodePasteModal
        open={showModal}
        initial={code}
        title="Grade entire chapter"
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
    </div>
  );
}
