import { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getChapters, getVolumes } from '../api/client';
import type { Chapter, Volume } from '../types';
import { getChapterIllustration } from '../components/ChapterIllustrations';
import { countLocalCompleted } from '../utils/storage';
import { useAuth } from '../contexts/AuthContext';

const VOLUME_GRADIENTS: Record<string, string> = {
  lf: 'from-blue-500 to-indigo-600',
  plf: 'from-violet-500 to-purple-600',
  vfa: 'from-emerald-500 to-green-600',
  slf: 'from-amber-500 to-orange-600',
  secf: 'from-rose-500 to-red-600',
};

export default function VolumePage() {
  const { user: authUser } = useAuth();
  const { volumeId } = useParams<{ volumeId: string }>();
  const [volume, setVolume] = useState<Volume | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);

  useEffect(() => {
    if (!volumeId) return;
    getVolumes().then(vols => setVolume(vols.find(v => v.id === volumeId) || null));
    getChapters(volumeId).then(setChapters).catch(console.error);
  }, [volumeId]);

  // Overlay this user's localStorage grades onto chapter completed counts.
  const chaptersWithLocal = useMemo(() => {
    if (!volumeId) return chapters;
    return chapters.map(ch => {
      const localCount = countLocalCompleted(authUser?.id, volumeId, ch.name);
      return { ...ch, completed_count: Math.max(ch.completed_count, localCount) };
    });
  }, [chapters, volumeId, authUser?.id]);

  if (!volumeId || !volume) return <div className="p-10 text-gray-400">Loading...</div>;

  const totalCompleted = chaptersWithLocal.reduce((s, ch) => s + ch.completed_count, 0);
  const overallPct = volume.exercise_count > 0
    ? Math.round((totalCompleted / volume.exercise_count) * 100)
    : 0;
  const gradient = VOLUME_GRADIENTS[volumeId] || 'from-gray-500 to-gray-600';

  return (
    <div className="p-10 max-w-4xl mx-auto">
      <Link to="/" className="text-sm text-gray-400 hover:text-gray-600 mb-6 inline-flex items-center gap-1 font-medium transition-colors">
        <span>&larr;</span> All Volumes
      </Link>

      {/* Header */}
      <div className="mb-8 mt-2">
        <div className="flex items-center gap-3 mb-3">
          <span className={`text-xs font-bold font-mono px-2.5 py-1 rounded-lg bg-gradient-to-r ${gradient} text-white shadow-sm`}>
            {volume.namespace}
          </span>
        </div>
        <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">{volume.name}</h1>
        <p className="text-sm text-gray-500 mt-2">
          {totalCompleted} of {volume.exercise_count} exercises completed ({overallPct}%)
        </p>
        <div className="w-full max-w-sm bg-gray-100 rounded-full h-2.5 mt-3">
          <div className={`bg-gradient-to-r ${gradient} h-2.5 rounded-full transition-all`} style={{ width: `${overallPct}%` }} />
        </div>
      </div>

      {/* Chapter list */}
      <div className="space-y-2">
        {chaptersWithLocal.map((ch, i) => {
          const pct = ch.exercise_count > 0
            ? Math.round((ch.completed_count / ch.exercise_count) * 100)
            : 0;

          const ChIllust = getChapterIllustration(ch.name);
          return (
            <Link
              key={ch.id}
              to={`/volume/${volumeId}/chapter/${ch.name}`}
              className="group flex items-center gap-4 bg-white rounded-xl border border-gray-100 p-4 hover:shadow-sm hover:border-gray-200 transition-all"
            >
              <span className="text-sm text-gray-300 w-7 text-right font-mono font-medium shrink-0">{i + 1}</span>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-gray-800 group-hover:text-indigo-700 transition-colors">{ch.title || ch.name}</h3>
                  {ch.exercise_count === 0 && (
                    <span className="text-[11px] text-gray-300 font-medium">(reading only)</span>
                  )}
                </div>
                {ch.summary && (
                  <p className="text-xs text-gray-400 mt-0.5 line-clamp-2 leading-relaxed">{ch.summary}</p>
                )}
                <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400">
                  {ch.exercise_count > 0 && (
                    <>
                      <span className="font-medium">{ch.exercise_count} exercises</span>
                      <span>&middot;</span>
                    </>
                  )}
                  {ch.line_count > 0 && (
                    <span>{ch.line_count.toLocaleString()} lines</span>
                  )}
                  {ch.exercise_count > 0 && (
                    <>
                      <span>&middot;</span>
                      <div className="flex items-center gap-1.5">
                        <div className="w-20 bg-gray-100 rounded-full h-1.5">
                          <div
                            className={`bg-gradient-to-r ${gradient} h-1.5 rounded-full transition-all`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="font-mono">{ch.completed_count}/{ch.exercise_count}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Chapter illustration */}
              {ChIllust && (
                <div className="shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                  <ChIllust />
                </div>
              )}

              <span className="text-[11px] text-gray-300 font-medium shrink-0">
                {ch.max_points_standard > 0 && `${ch.max_points_standard} pts`}
              </span>

              <span className="text-gray-300 group-hover:text-gray-400 transition-colors">&rsaquo;</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
