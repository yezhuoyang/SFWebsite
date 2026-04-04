import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getVolumes } from '../api/client';
import type { Volume } from '../types';

const VOLUME_META: Record<string, { color: string; desc: string }> = {
  lf: { color: 'from-blue-500 to-blue-600', desc: 'Functional programming, logic, and proof basics in Rocq' },
  plf: { color: 'from-purple-500 to-purple-600', desc: 'Type systems, Hoare logic, and small-step semantics' },
  vfa: { color: 'from-green-500 to-green-600', desc: 'Verified sorting, search trees, and priority queues' },
  slf: { color: 'from-orange-500 to-orange-600', desc: 'Separation logic for reasoning about heap programs' },
  secf: { color: 'from-red-500 to-red-600', desc: 'Noninterference, information flow, and constant-time' },
};

export default function Dashboard() {
  const [volumes, setVolumes] = useState<Volume[]>([]);

  useEffect(() => {
    getVolumes().then(setVolumes).catch(console.error);
  }, []);

  const totalExercises = volumes.reduce((s, v) => s + v.exercise_count, 0);
  const totalCompleted = volumes.reduce((s, v) => s + v.completed_count, 0);
  const overallPct = totalExercises > 0 ? Math.round((totalCompleted / totalExercises) * 100) : 0;

  return (
    <div className="p-8">
      {/* Header stats */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-100 mb-2">Software Foundations</h1>
        <p className="text-gray-500 mb-6">Your progress across all volumes</p>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-[#16171f] rounded-xl p-5 border border-gray-800">
            <p className="text-sm text-gray-500">Total Progress</p>
            <p className="text-3xl font-bold text-gray-100">{overallPct}%</p>
            <div className="w-full bg-gray-800 rounded-full h-2 mt-2">
              <div className="bg-indigo-500 h-2 rounded-full" style={{ width: `${overallPct}%` }} />
            </div>
          </div>
          <div className="bg-[#16171f] rounded-xl p-5 border border-gray-800">
            <p className="text-sm text-gray-500">Exercises Completed</p>
            <p className="text-3xl font-bold text-gray-100">{totalCompleted}</p>
            <p className="text-xs text-gray-600 mt-1">out of {totalExercises}</p>
          </div>
          <div className="bg-[#16171f] rounded-xl p-5 border border-gray-800">
            <p className="text-sm text-gray-500">Volumes</p>
            <p className="text-3xl font-bold text-gray-100">{volumes.length}</p>
            <p className="text-xs text-gray-600 mt-1">
              {volumes.filter(v => v.completed_count > 0).length} in progress
            </p>
          </div>
        </div>
      </div>

      {/* Volume cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {volumes.map((v) => {
          const meta = VOLUME_META[v.id] || { color: 'from-gray-500 to-gray-600', desc: '' };
          const pct = v.exercise_count > 0
            ? Math.round((v.completed_count / v.exercise_count) * 100)
            : 0;

          return (
            <Link
              key={v.id}
              to={`/volume/${v.id}`}
              className="bg-[#16171f] rounded-xl border border-gray-800 overflow-hidden hover:border-gray-700 transition-colors"
            >
              <div className={`h-2 bg-gradient-to-r ${meta.color}`} />
              <div className="p-5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono bg-gray-800 px-2 py-0.5 rounded text-gray-400">
                    {v.namespace}
                  </span>
                  <span className="text-xs text-gray-500 ml-auto">{pct}%</span>
                </div>
                <h3 className="text-lg font-semibold text-gray-100 mb-1">{v.name}</h3>
                <p className="text-xs text-gray-500 mb-3">{meta.desc}</p>

                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>{v.chapter_count} chapters</span>
                  <span>{v.exercise_count} exercises</span>
                </div>

                <div className="w-full bg-gray-800 rounded-full h-1.5 mt-3">
                  <div
                    className={`h-1.5 rounded-full bg-gradient-to-r ${meta.color}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {v.completed_count} / {v.exercise_count} completed
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
