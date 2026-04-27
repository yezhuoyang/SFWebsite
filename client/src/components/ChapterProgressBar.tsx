/**
 * Sticky toolbar pinned to the top of the chapter pane.
 *
 * Two responsibilities:
 *  1. Show the user's per-exercise progress (X / Y exercises, points, %).
 *  2. Host the prominent **Submit & Grade** button — the obvious thing
 *     the user clicks after editing their proof in the iframe IDE.
 *     The button reads from the system clipboard (so the workflow is
 *     "click in iframe → Ctrl+A → Ctrl+C → Submit") and submits the
 *     whole chapter without a `target_exercise`, letting the server
 *     grade every exercise.
 */

import { useState } from 'react';
import { saveChapterFile, type ChapterProgress, type ExerciseGrade } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useChapterCodeBuffer, useExerciseGrades } from '../coq/exerciseGrading';

interface Props {
  progress: ChapterProgress | null;
  volumeId: string;
  chapterSlug: string;
  /** Called after a successful grade so the parent can refetch
   *  per-chapter progress and bump leaderboard widgets. */
  onGraded: () => void;
}

interface SubmitFeedback {
  kind: 'ok' | 'partial' | 'error';
  message: string;
}

export default function ChapterProgressBar({ progress, volumeId, chapterSlug, onGraded }: Props) {
  const { requireLogin } = useAuth();
  const { code, setCode } = useChapterCodeBuffer(volumeId, chapterSlug);
  const { recordGrade } = useExerciseGrades(volumeId, chapterSlug);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<SubmitFeedback | null>(null);

  const handleSubmit = async () => {
    setFeedback(null);
    // Flip the spinner on immediately so the user gets visible feedback
    // the moment they click — before the clipboard / login dance resolves.
    setSubmitting(true);
    try {
      // Resolve the code in three strategies (clipboard → buffer → prompt)
      // so the button always *does something*, even when clipboard
      // permission is denied or unsupported.
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
          ? "Couldn't read clipboard (permission denied?). Paste your full chapter code below:"
          : 'Paste your full chapter code below (or copy from the IDE first with Ctrl+A, Ctrl+C, then Submit again):';
        const pasted = window.prompt(promptMsg, '');
        if (pasted && pasted.trim()) {
          codeToGrade = pasted;
          setCode(pasted);
        }
      }
      if (!codeToGrade.trim()) {
        setFeedback({
          kind: 'error',
          message: 'No code to submit. Copy from the IDE (Ctrl+A, Ctrl+C) and click Submit again.',
        });
        return;
      }
      try {
        await requireLogin('Sign in to submit your solution.');
      } catch {
        return;
      }
      const result = await saveChapterFile(volumeId, chapterSlug, codeToGrade);
      result.exercises.forEach((ex: ExerciseGrade) => recordGrade(ex));
      onGraded();
      const okCount = result.exercises.filter(e => e.status === 'completed').length;
      const failCount = result.exercises.filter(e => e.status === 'compile_error' || e.status === 'tampered').length;
      if (okCount === 0 && failCount > 0) {
        const first = result.exercises.find(e => e.status === 'compile_error' || e.status === 'tampered');
        setFeedback({
          kind: 'error',
          message: first?.feedback || first?.error_detail || `${failCount} exercise(s) failed to compile.`,
        });
      } else if (failCount > 0) {
        setFeedback({
          kind: 'partial',
          message: `Graded — ${okCount} completed, ${failCount} failed.`,
        });
      } else {
        setFeedback({
          kind: 'ok',
          message: okCount > 0
            ? `Graded — ${okCount} exercise(s) completed.`
            : 'Submitted. No completed exercises detected (check for Admitted / FILL IN HERE).',
        });
      }
    } catch (err) {
      setFeedback({ kind: 'error', message: (err as Error).message || 'Grading failed.' });
    } finally {
      setSubmitting(false);
    }
  };

  const pct = progress && progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;
  const ptsPct = progress && progress.points_total > 0
    ? Math.round((progress.points_earned / progress.points_total) * 100)
    : 0;

  return (
    <div className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-gray-200 shadow-sm">
      <div className="px-4 py-2 flex items-center gap-3 text-[12px]">
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
    </div>
  );
}
