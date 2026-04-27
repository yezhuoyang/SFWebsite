/**
 * Sticky progress bar pinned to the top of the chapter pane.
 *
 * Shows the current user's per-exercise progress in this chapter (X / Y
 * exercises completed, Z / W points), with a thin bar that tracks
 * completion percent. Updates whenever the chapter or grade refresh
 * tick changes. Hidden when the user isn't signed in or the chapter
 * has no exercises.
 */

import type { ChapterProgress } from '../api/client';

interface Props {
  progress: ChapterProgress | null;
}

export default function ChapterProgressBar({ progress }: Props) {
  if (!progress || progress.total === 0) return null;
  const pct = Math.round((progress.completed / progress.total) * 100);
  const ptsPct = progress.points_total > 0
    ? Math.round((progress.points_earned / progress.points_total) * 100)
    : 0;
  return (
    <div className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-gray-200 px-4 py-2 shadow-sm">
      <div className="flex items-center gap-3 text-[12px]">
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
        <div className="ml-auto flex-1 max-w-xs h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${pct >= 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`}
            style={{ width: `${Math.max(pct, ptsPct, 1)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
