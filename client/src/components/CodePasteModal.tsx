/**
 * Modal that pops open when a Submit click can't auto-resolve the
 * chapter code (clipboard permission denied / empty / focus stuck in
 * the cross-origin iframe). The user pastes their full chapter code
 * here and clicks Grade.
 *
 * On open, the modal tries to auto-fill the textarea from the system
 * clipboard (so the workflow can stay one-click in many browsers) and
 * offers a "Load my last submission" button that pulls the user's
 * most recent saved file from the server — useful for recovering work
 * after a page refresh wipes the iframe IDE.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getChapterFile } from '../api/client';

interface Props {
  open: boolean;
  /** Pre-fill the textarea (typically the persisted chapter buffer). */
  initial?: string;
  title?: string;
  /** When provided, enables the "Load my last submission" button. */
  volumeId?: string;
  chapterSlug?: string;
  onCancel: () => void;
  onSubmit: (code: string) => void;
}

export default function CodePasteModal({
  open,
  initial = '',
  title = 'Paste your chapter code',
  volumeId,
  chapterSlug,
  onCancel,
  onSubmit,
}: Props) {
  const [code, setCode] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setInfo(null);
    setCode(initial);
    requestAnimationFrame(() => taRef.current?.focus());
    // Try the clipboard once on open — if the user did Ctrl+A, Ctrl+C
    // in the IDE just before clicking Submit, this auto-fills the
    // textarea so they only need to click Grade.
    (async () => {
      try {
        const clip = await navigator.clipboard.readText();
        if (clip && clip.trim() && clip.trim() !== initial.trim()) {
          setCode(clip);
          setInfo('Auto-filled from clipboard. Edit if needed, then click Grade.');
        }
      } catch {
        /* permission denied — that's fine, the user pastes manually */
      }
    })();
  }, [open, initial]);

  const loadSaved = async () => {
    if (!volumeId || !chapterSlug) return;
    setLoading(true);
    setInfo(null);
    try {
      const file = await getChapterFile(volumeId, chapterSlug);
      setCode(file.content);
      setInfo(`Loaded ${file.content.split('\n').length} lines from your last saved submission.`);
    } catch (e) {
      setInfo(`Couldn't load saved submission: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;
  // eslint-disable-next-line no-console
  console.log('[CodePasteModal] rendering', { title });

  // Render via portal so the modal lives at document.body, escaping any
  // ancestor that creates a containing block (transform / contain) and
  // any z-index stacking context the iframe might pull up.
  return createPortal((
    <div
      className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-lg shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-200 flex items-center">
          <h3 className="text-sm font-bold text-gray-800">{title}</h3>
          <button
            onClick={onCancel}
            className="ml-auto text-gray-400 hover:text-gray-700 text-xl leading-none px-1"
            aria-label="Close"
          >×</button>
        </div>
        <div className="p-4 flex-1 overflow-hidden flex flex-col gap-2">
          <p className="text-[11px] text-gray-600">
            Workflow: in the IDE on the right, click in the editor →{' '}
            <kbd className="px-1 py-0.5 bg-gray-100 rounded font-mono text-[10px]">Ctrl+A</kbd>{' '}→{' '}
            <kbd className="px-1 py-0.5 bg-gray-100 rounded font-mono text-[10px]">Ctrl+C</kbd>{' '}→ click in the textarea below →{' '}
            <kbd className="px-1 py-0.5 bg-gray-100 rounded font-mono text-[10px]">Ctrl+V</kbd>{' '}→ click Grade.
          </p>
          {volumeId && chapterSlug && (
            <div className="flex items-center gap-2">
              <button
                onClick={loadSaved}
                disabled={loading}
                className="text-[11px] px-2 py-1 rounded bg-gray-200 text-gray-800 hover:bg-gray-300 disabled:opacity-50"
                title="Pull your most recent saved chapter file from the server (useful after a refresh wiped the IDE)"
              >
                {loading ? 'Loading…' : '↺ Load my last submission'}
              </button>
              <button
                onClick={() => setCode('')}
                disabled={!code}
                className="text-[11px] px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Clear
              </button>
              <span className="ml-auto text-[10px] text-gray-400 font-mono">
                {code.split('\n').length} lines
              </span>
            </div>
          )}
          <textarea
            ref={taRef}
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="(* paste full chapter code here *)"
            className="flex-1 w-full min-h-[260px] px-2 py-1.5 text-[12px] font-mono rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
            spellCheck={false}
          />
          {info && (
            <p className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-2 py-1">
              {info}
            </p>
          )}
        </div>
        <div className="px-4 py-3 border-t border-gray-200 flex items-center gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-[12px] rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(code)}
            disabled={!code.trim()}
            className="ml-auto px-4 py-1.5 text-[12px] rounded bg-indigo-600 text-white font-semibold shadow-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Grade this code
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
