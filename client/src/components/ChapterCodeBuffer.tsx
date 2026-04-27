/**
 * Compact "Your code" status pill at the bottom of the chapter sidebar.
 *
 * Workflow with the current cross-origin iframe:
 *  1. Edit your code in the iframe IDE.
 *  2. Click in the iframe, Ctrl+A, Ctrl+C.
 *  3. Click any exercise's Grade button — the button auto-reads from
 *     the system clipboard, persists it as the chapter buffer, and
 *     submits to the grader.
 *
 * So the buffer panel is mostly informational — it tells you what
 * code is currently being graded against. Click the chevron to expand
 * a textarea if you want to edit it manually or paste-by-hand
 * (e.g. when clipboard permission is blocked).
 */

import { useEffect, useState, type ChangeEvent } from 'react';
import { useChapterCodeBuffer } from '../coq/exerciseGrading';

interface Props {
  volumeId: string;
  chapterSlug: string;
  /** Bumped when an empty buffer caused a Grade click to surface an
   *  error; used to flash the panel open. */
  flashTick?: number;
}

export default function ChapterCodeBuffer({ volumeId, chapterSlug, flashTick }: Props) {
  const { code, setCode } = useChapterCodeBuffer(volumeId, chapterSlug);
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    if (flashTick !== undefined && flashTick > 0) setOpen(true);
  }, [flashTick]);

  const lineCount = code ? code.split('\n').length : 0;
  const hasCode = code.trim().length > 0;

  const syncFromClipboard = async () => {
    setSyncMsg(null);
    setSyncing(true);
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setSyncMsg("Clipboard is empty — copy from the IDE first (Ctrl+A, Ctrl+C).");
      } else {
        setCode(text);
        setSyncMsg(null);
      }
    } catch {
      setSyncMsg('Clipboard permission denied — paste manually below.');
      setOpen(true);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="border-t border-gray-100 bg-gray-50/60">
      {/* Header row: status + sync button + expand toggle. */}
      <div className="px-3 py-2 flex items-center gap-2 text-[12px]">
        <button
          onClick={() => setOpen(o => !o)}
          className="text-gray-400 hover:text-gray-700 text-[10px]"
          title={open ? 'Hide details' : 'Show details'}
        >
          {open ? '▼' : '▶'}
        </button>
        <span className="font-semibold text-gray-600">Your code</span>
        <span className="ml-auto text-[10px] text-gray-400 font-mono">
          {hasCode ? `${lineCount} lines` : 'empty'}
        </span>
        <button
          onClick={syncFromClipboard}
          disabled={syncing}
          className="text-[10px] px-2 py-0.5 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          title="Read your chapter code from the system clipboard (Ctrl+A, Ctrl+C in the IDE first)"
        >
          {syncing ? '…' : 'Sync'}
        </button>
      </div>

      {syncMsg && (
        <p className="px-3 pb-2 text-[10px] text-amber-700">{syncMsg}</p>
      )}

      {open && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-[10px] text-gray-500 leading-tight">
            This is the code each Grade button submits. Edit here if your
            clipboard sync didn't capture what you wanted.
          </p>
          <textarea
            value={code}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setCode(e.target.value)}
            placeholder="(* paste chapter code here *)"
            className="w-full h-40 px-2 py-1.5 text-[11px] font-mono rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-y"
            spellCheck={false}
          />
          <button
            onClick={() => setCode('')}
            disabled={!hasCode}
            className="text-[11px] px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-white disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
