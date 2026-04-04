import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getChapters, getVolumes } from '../api/client';
import type { Chapter, Volume } from '../types';

const STAR_COLORS = ['', 'text-yellow-500', 'text-yellow-500', 'text-orange-500', 'text-red-500', 'text-red-600'];

export default function VolumePage() {
  const { volumeId } = useParams<{ volumeId: string }>();
  const [volume, setVolume] = useState<Volume | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);

  useEffect(() => {
    if (!volumeId) return;
    getVolumes().then(vols => setVolume(vols.find(v => v.id === volumeId) || null));
    getChapters(volumeId).then(setChapters).catch(console.error);
  }, [volumeId]);

  if (!volumeId || !volume) return <div className="p-8 text-gray-500">Loading...</div>;

  const overallPct = volume.exercise_count > 0
    ? Math.round((volume.completed_count / volume.exercise_count) * 100)
    : 0;

  return (
    <div className="p-8">
      <Link to="/" className="text-sm text-gray-500 hover:text-gray-400 mb-4 inline-block">
        &larr; All Volumes
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-100">{volume.name}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {volume.completed_count}/{volume.exercise_count} exercises completed ({overallPct}%)
        </p>
        <div className="w-full max-w-md bg-gray-800 rounded-full h-2 mt-2">
          <div className="bg-indigo-500 h-2 rounded-full" style={{ width: `${overallPct}%` }} />
        </div>
      </div>

      {/* Chapter list */}
      <div className="space-y-2">
        {chapters.map((ch, i) => {
          const pct = ch.exercise_count > 0
            ? Math.round((ch.completed_count / ch.exercise_count) * 100)
            : 0;

          return (
            <Link
              key={ch.id}
              to={`/volume/${volumeId}/chapter/${ch.name}`}
              className="flex items-center gap-4 bg-[#16171f] rounded-lg border border-gray-800 p-4 hover:border-gray-700 transition-colors"
            >
              <span className="text-sm text-gray-500 w-6 text-right">{i + 1}</span>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-100">{ch.name}</h3>
                  {ch.exercise_count === 0 && (
                    <span className="text-xs text-gray-500">(no exercises)</span>
                  )}
                </div>
                {ch.exercise_count > 0 && (
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 max-w-xs bg-gray-800 rounded-full h-1.5">
                      <div
                        className="bg-indigo-500 h-1.5 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500">
                      {ch.completed_count}/{ch.exercise_count}
                    </span>
                  </div>
                )}
              </div>

              <span className="text-xs text-gray-500">
                {ch.max_points_standard > 0 && `${ch.max_points_standard} pts`}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
