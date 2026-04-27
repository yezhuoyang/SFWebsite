/**
 * AI Tutor side-panel for the chapter page.
 *
 * The chapter iframe is cross-origin (loaded from coq.vercel.app) so we
 * cannot read goals / diagnostics / code from `iframe.contentWindow.coq`.
 * Instead the user pastes the relevant context (their code, the current
 * goal text, any errors) into a textarea, and we send it to
 * `POST /api/tutor/explain` along with their question.
 *
 * Collapses by default — click the floating "AI Tutor" tab on the
 * right edge of the iframe to expand it.
 */

import { useState, useRef, useEffect, type FormEvent } from 'react';
import { explainOutput } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

interface Props {
  volumeId: string;
  chapterSlug: string;
  /** Kept for future same-origin work, currently unused. */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
}

interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

export default function TutorPanel({ volumeId, chapterSlug, iframeRef: _iframeRef }: Props) {
  const { requireLogin } = useAuth();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [proofText, setProofText] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, loading]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const message = input.trim();
    if (!message || loading) return;

    setError(null);
    try {
      await requireLogin('Sign in to chat with the AI tutor.');
    } catch {
      return;
    }

    setInput('');
    setTurns(t => [...t, { role: 'user', text: message }]);
    setLoading(true);
    try {
      const res = await explainOutput({
        volume_id: volumeId,
        chapter_name: chapterSlug,
        exercise_name: null,
        student_code: studentCode,
        proof_state_text: proofText,
        diagnostics_text: '',
        processed_lines: null,
        message,
      });
      setTurns(t => [...t, { role: 'assistant', text: res.explanation }]);
    } catch (err) {
      setError((err as Error).message || 'Tutor request failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Toggle tab on the right edge */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed top-1/2 -translate-y-1/2 right-0 z-50 bg-indigo-600 text-white px-2 py-3 rounded-l-lg shadow-md hover:bg-indigo-700 transition-colors text-[11px] font-bold tracking-wide"
        style={{ writingMode: 'vertical-rl' }}
        title={open ? 'Hide AI Tutor' : 'Show AI Tutor'}
      >
        {open ? 'Hide Tutor' : 'AI Tutor'}
      </button>

      {open && (
        <div
          className="fixed top-0 right-0 h-screen w-96 bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col"
          style={{ paddingRight: 28 }}
        >
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <span className="text-base">&#9672;</span>
            <h3 className="text-sm font-bold text-gray-800">AI Tutor</h3>
            <span className="ml-auto text-[10px] text-gray-400 uppercase tracking-wide">{volumeId}/{chapterSlug}</span>
          </div>

          {/* Context inputs (collapsed inside a details for compactness) */}
          <details className="border-b border-gray-100 text-[12px]">
            <summary className="px-4 py-2 cursor-pointer hover:bg-gray-50 text-gray-600 select-none">
              Paste context (current goal + your code) ↓
            </summary>
            <div className="px-4 py-2 space-y-2">
              <label className="block">
                <span className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">Current goal</span>
                <textarea
                  value={proofText}
                  onChange={e => setProofText(e.target.value)}
                  placeholder="Paste the Goals panel content from the IDE…"
                  className="mt-1 w-full h-20 px-2 py-1 text-[11px] font-mono rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">Your code (optional)</span>
                <textarea
                  value={studentCode}
                  onChange={e => setStudentCode(e.target.value)}
                  placeholder="(* paste your code so the tutor sees full context *)"
                  className="mt-1 w-full h-24 px-2 py-1 text-[11px] font-mono rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y"
                />
              </label>
            </div>
          </details>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-[13px]">
            {turns.length === 0 && (
              <p className="text-gray-400 italic">
                Ask a question about the proof state, an error, or a tactic.
                Paste the goal text above for the most relevant answer.
              </p>
            )}
            {turns.map((t, i) => (
              <div key={i} className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 whitespace-pre-wrap ${
                    t.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {t.text}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 text-gray-500 rounded-lg px-3 py-2 italic">Thinking…</div>
              </div>
            )}
            {error && (
              <div className="text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-md p-2">
                {error}
              </div>
            )}
          </div>

          <form onSubmit={send} className="border-t border-gray-100 p-3 flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={loading ? 'Thinking…' : 'Ask the tutor…'}
              disabled={loading}
              className="flex-1 px-3 py-2 text-[13px] rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="px-3 py-2 rounded-lg text-[13px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
