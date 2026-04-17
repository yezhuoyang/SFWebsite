/**
 * Compact leaderboard widget showing top users.
 * Used on Dashboard (global), VolumePage (volume-scoped), and ChapterPage (chapter-scoped).
 */

import { useEffect, useState } from 'react';
import { getLeaderboard, getVolumeLeaderboard, getChapterLeaderboard, type LeaderboardEntry } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

interface Props {
  scope: 'global' | 'volume' | 'chapter';
  volumeId?: string;
  chapterName?: string;
  title?: string;
  limit?: number;
  /** compact = small fixed-width card; full = wider with more details */
  variant?: 'compact' | 'full';
  /** Bump this to force an immediate re-fetch (e.g. after grading a
   *  solution). Included in the effect dependency list. */
  refreshKey?: number;
}

export default function LeaderboardWidget({
  scope, volumeId, chapterName, title, limit = 10, variant = 'compact',
  refreshKey = 0,
}: Props) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const fetcher =
      scope === 'volume' && volumeId ? getVolumeLeaderboard(volumeId, limit)
      : scope === 'chapter' && volumeId && chapterName ? getChapterLeaderboard(volumeId, chapterName, limit)
      : getLeaderboard('points', limit);

    fetcher
      .then(data => { if (!cancelled) setEntries(data); })
      .catch(() => { if (!cancelled) setEntries([]); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [scope, volumeId, chapterName, limit, refreshKey]);

  const headerLabel = title || (
    scope === 'global' ? 'Global Leaderboard' :
    scope === 'volume' ? 'Volume Leaderboard' :
    'Chapter Leaderboard'
  );

  const isCompact = variant === 'compact';

  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden ${isCompact ? '' : 'w-full'}`}>
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-amber-50 to-yellow-50">
        <div className="flex items-center gap-2">
          <span className="text-lg">🏆</span>
          <h3 className="text-sm font-bold text-gray-800">{headerLabel}</h3>
        </div>
        <span className="text-[10px] text-gray-400 font-mono uppercase tracking-wider">Top {limit}</span>
      </div>

      {loading ? (
        <div className="px-5 py-8 text-center text-xs text-gray-400">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="px-5 py-8 text-center text-xs text-gray-400">
          No entries yet. Be the first to solve!
        </div>
      ) : (
        <ul className="divide-y divide-gray-50">
          {entries.map((e, i) => {
            const isMe = user && e.user_id === user.id;
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null;
            return (
              <li key={e.user_id}
                  className={`flex items-center gap-3 px-5 py-2 transition-colors ${isMe ? 'bg-blue-50/50' : 'hover:bg-gray-50/50'}`}>
                <span className={`text-sm font-bold w-6 text-center ${i < 3 ? '' : 'text-gray-400'}`}>
                  {medal || `#${e.rank}`}
                </span>
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {(e.display_name || e.username).charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800 truncate">
                    {e.display_name || e.username}
                    {isMe && <span className="ml-1 text-[9px] text-blue-500 font-medium">(you)</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-gray-700">{Math.round(e.total_points)}</div>
                  <div className="text-[9px] text-gray-400">{e.exercises_completed} solved</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
