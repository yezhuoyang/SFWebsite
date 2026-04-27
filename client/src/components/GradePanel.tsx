/**
 * Grade-the-chapter panel that sits inside the chapter sidebar.
 *
 * The chapter iframe is cross-origin (loaded from coq.vercel.app) so we
 * cannot read the user's edited code from `iframe.contentWindow.coq`.
 * Instead we expose a paste-textarea: the student copies their code out
 * of the iframe IDE, pastes it here, and we POST to
 * `PUT /api/coq/file/<vol>/<chapter>` for grading.
 *
 * A future Phase B could vendor wacoq locally to enable direct reads.
 */

import { useState } from 'react';
import { saveChapterFile, type SaveResult, type ExerciseGrade } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

interface Props {
  volumeId: string;
  chapterSlug: string;
  /** Kept in the API for future same-origin work, currently unused. */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** Bumped after a successful grade so other widgets (leaderboard) can refetch. */
  onGraded?: () => void;
}

export default function GradePanel({ volumeId, chapterSlug, iframeRef: _iframeRef, onGraded }: Props) {
  const { requireLogin } = useAuth();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGrade = async () => {
    setError(null);
    if (!code.trim()) {
      setError('Paste your chapter code into the box first.');
      return;
    }
    try {
      await requireLogin('Sign in to submit your solutions for grading.');
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      const res = await saveChapterFile(volumeId, chapterSlug, code);
      setResult(res);
      onGraded?.();
    } catch (e) {
      setError((e as Error).message || 'Grading failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border-t border-gray-100 bg-gray-50/60 p-3 space-y-2">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="w-full px-3 py-2 rounded-lg text-sm font-semibold transition-colors bg-indigo-600 text-white hover:bg-indigo-700"
        >
          Submit & Grade
        </button>
      ) : (
        <>
          <p className="text-[11px] text-gray-500 leading-tight">
            Copy your full chapter code from the IDE buffer and paste it below
            (Ctrl+A then Ctrl+C inside the editor).
          </p>
          <textarea
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="(* paste your code here *)"
            disabled={submitting}
            className="w-full h-32 px-2 py-1.5 text-[11px] font-mono rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-100 resize-y"
          />
          <div className="flex gap-1">
            <button
              onClick={handleGrade}
              disabled={submitting}
              className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-indigo-600 text-white hover:bg-indigo-700"
            >
              {submitting ? 'Grading…' : 'Grade'}
            </button>
            <button
              onClick={() => { setOpen(false); setCode(''); setResult(null); setError(null); }}
              disabled={submitting}
              className="px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {error && (
        <div className="text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-md p-2">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
            <span>{result.completed} / {result.total} exercises</span>
            <span className={result.graded ? 'text-emerald-600' : 'text-amber-600'}>
              {result.graded ? 'Graded' : result.status}
            </span>
          </div>
          <ul className="space-y-1 max-h-48 overflow-y-auto">
            {result.exercises.map(ex => (
              <ExerciseRow key={ex.name} ex={ex} />
            ))}
          </ul>
          {result.compile_output && (
            <details className="text-[11px] text-gray-500 mt-1">
              <summary className="cursor-pointer hover:text-gray-700">Compiler output</summary>
              <pre className="mt-1 p-2 bg-white border border-gray-200 rounded font-mono text-[10px] overflow-x-auto whitespace-pre-wrap">
                {result.compile_output}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function ExerciseRow({ ex }: { ex: ExerciseGrade }) {
  const colors = {
    completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    not_started: 'bg-gray-50 text-gray-500 border-gray-200',
    compile_error: 'bg-red-50 text-red-700 border-red-200',
    tampered: 'bg-amber-50 text-amber-700 border-amber-200',
  } as const;
  const dot = {
    completed: '✓',
    not_started: '·',
    compile_error: '✗',
    tampered: '!',
  } as const;
  return (
    <li className={`text-[12px] px-2 py-1 rounded border flex items-center gap-2 ${colors[ex.status]}`} title={ex.feedback ?? ''}>
      <span className="font-mono shrink-0">{dot[ex.status]}</span>
      <span className="truncate flex-1">{ex.name}</span>
      <span className="text-[10px] opacity-70 shrink-0">{ex.points}pt</span>
    </li>
  );
}
