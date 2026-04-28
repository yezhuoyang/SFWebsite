/**
 * Modal that pops open when a Submit click can't auto-resolve the
 * chapter code (clipboard permission denied / empty / focus stuck in
 * the cross-origin iframe). The user pastes their full chapter code
 * here and clicks Grade; the code is persisted to the chapter buffer
 * for subsequent clicks so the modal usually only appears once per
 * chapter session.
 *
 * `window.prompt()` was the previous fallback, but a single-line text
 * dialog is awkward for multi-line Coq code and dismissing it
 * accidentally is too easy.
 */

import { useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  initial?: string;
  title?: string;
  onCancel: () => void;
  onSubmit: (code: string) => void;
}

export default function CodePasteModal({ open, initial = '', title = 'Paste your chapter code', onCancel, onSubmit }: Props) {
  const [code, setCode] = useState(initial);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open) {
      setCode(initial);
      // Focus the textarea after the modal mounts so the user can
      // paste with Ctrl+V immediately.
      requestAnimationFrame(() => taRef.current?.focus());
    }
  }, [open, initial]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl flex flex-col max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-200 flex items-center">
          <h3 className="text-sm font-bold text-gray-800">{title}</h3>
          <button
            onClick={onCancel}
            className="ml-auto text-gray-400 hover:text-gray-700 text-lg leading-none"
            aria-label="Close"
          >×</button>
        </div>
        <div className="p-4 flex-1 overflow-hidden flex flex-col">
          <p className="text-[11px] text-gray-600 mb-2">
            In the IDE on the right: click anywhere in the editor → <kbd className="px-1 py-0.5 bg-gray-100 rounded font-mono text-[10px]">Ctrl+A</kbd> → <kbd className="px-1 py-0.5 bg-gray-100 rounded font-mono text-[10px]">Ctrl+C</kbd> → click here → <kbd className="px-1 py-0.5 bg-gray-100 rounded font-mono text-[10px]">Ctrl+V</kbd>.
          </p>
          <textarea
            ref={taRef}
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="(* paste full chapter code here *)"
            className="flex-1 w-full min-h-[240px] px-2 py-1.5 text-[12px] font-mono rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
            spellCheck={false}
          />
        </div>
        <div className="px-4 py-3 border-t border-gray-200 flex items-center gap-2">
          <span className="text-[10px] text-gray-400 font-mono">
            {code.split('\n').length} lines
          </span>
          <button
            onClick={onCancel}
            className="ml-auto px-3 py-1.5 text-[12px] rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(code)}
            disabled={!code.trim()}
            className="px-3 py-1.5 text-[12px] rounded bg-indigo-600 text-white font-semibold shadow-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Grade this code
          </button>
        </div>
      </div>
    </div>
  );
}
