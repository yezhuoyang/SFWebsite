import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getVolumes } from '../api/client';
import type { Volume } from '../types';
import { VOLUME_ILLUSTRATIONS } from '../components/VolumeIllustrations';
import { PLSELogo, UCLACSLogo } from '../components/PLSELogo';
import { countVolumeLocalCompleted } from '../utils/storage';
import LeaderboardWidget from '../components/LeaderboardWidget';
import { useAuth } from '../contexts/AuthContext';

const VOLUME_META: Record<string, { gradient: string; accent: string; desc: string; topics: string[] }> = {
  lf: {
    gradient: 'from-blue-500 to-indigo-600',
    accent: 'text-blue-600',
    desc: 'Functional programming, logic, and proof basics in Rocq',
    topics: ['Induction', 'Pattern matching', 'Proof trees', 'Propositions as types'],
  },
  plf: {
    gradient: 'from-violet-500 to-purple-600',
    accent: 'text-violet-600',
    desc: 'Type systems, Hoare logic, and small-step semantics',
    topics: ['Lambda calculus', 'Type judgments', 'Progress & preservation', 'Hoare triples'],
  },
  vfa: {
    gradient: 'from-emerald-500 to-green-600',
    accent: 'text-emerald-600',
    desc: 'Verified sorting, search trees, and priority queues',
    topics: ['BST invariants', 'Red-black trees', 'Sorting correctness', 'ADT specs'],
  },
  slf: {
    gradient: 'from-amber-500 to-orange-600',
    accent: 'text-amber-600',
    desc: 'Separation logic for reasoning about heap programs',
    topics: ['Heap predicates', 'Frame rule', 'Points-to (\u21a6)', 'Separating conjunction (\u2217)'],
  },
  secf: {
    gradient: 'from-rose-500 to-red-600',
    accent: 'text-rose-600',
    desc: 'Noninterference, information flow, and constant-time',
    topics: ['Security lattice', 'IFC typing', 'Noninterference', 'Constant-time'],
  },
};

// Used by Layout sidebar — kept for consistency
// const VOLUME_COLORS: Record<string, string> = { lf: 'bg-blue-500', ... };

export default function Dashboard() {
  const { user: authUser } = useAuth();
  const [volumes, setVolumes] = useState<Volume[]>([]);

  useEffect(() => {
    // Re-fetch when the auth user changes — the per-user completion counts
    // baked into /volumes responses depend on the JWT we send.
    getVolumes().then(setVolumes).catch(console.error);
  }, [authUser?.id]);

  // Overlay this user's localStorage grades onto server-reported counts.
  const volumesWithLocal = useMemo(() => volumes.map(v => {
    const localCount = countVolumeLocalCompleted(authUser?.id, v.id);
    return { ...v, completed_count: Math.max(v.completed_count, localCount) };
  }), [volumes, authUser?.id]);

  const totalExercises = volumesWithLocal.reduce((s, v) => s + v.exercise_count, 0);
  const totalCompleted = volumesWithLocal.reduce((s, v) => s + v.completed_count, 0);
  const overallPct = totalExercises > 0 ? Math.round((totalCompleted / totalExercises) * 100) : 0;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        {/* Institutional logos */}
        <div className="flex items-center gap-6 mb-6">
          <PLSELogo size={80} />
          <UCLACSLogo size={80} />
        </div>
        <p className="text-sm font-semibold text-indigo-500 uppercase tracking-wider mb-2">Learning Platform</p>
        <h1 className="text-4xl font-extrabold text-gray-900 mb-2 tracking-tight">
          Software Foundations
        </h1>
        <p className="text-lg text-gray-500 font-light">
          Your journey through formal verification, one proof at a time.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-5 mb-8">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Progress</p>
          <p className="text-4xl font-extrabold text-gray-900 mt-1">{overallPct}%</p>
          <div className="w-full bg-gray-100 rounded-full h-2 mt-3">
            <div className="bg-indigo-500 h-2 rounded-full transition-all" style={{ width: `${overallPct}%` }} />
          </div>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Completed</p>
          <p className="text-4xl font-extrabold text-gray-900 mt-1">{totalCompleted}</p>
          <p className="text-sm text-gray-400 mt-1">of {totalExercises} exercises</p>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Volumes</p>
          <p className="text-4xl font-extrabold text-gray-900 mt-1">{volumesWithLocal.length}</p>
          <p className="text-sm text-gray-400 mt-1">
            {volumesWithLocal.filter(v => v.completed_count > 0).length} in progress
          </p>
        </div>
      </div>

      {/* 2-column layout: volumes left, leaderboard right */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Left: Volume cards */}
        <div className="space-y-5 min-w-0">
        {volumesWithLocal.map((v) => {
          const meta = VOLUME_META[v.id] || { gradient: 'from-gray-500 to-gray-600', accent: 'text-gray-600', desc: '', topics: [] };
          const pct = v.exercise_count > 0
            ? Math.round((v.completed_count / v.exercise_count) * 100)
            : 0;
          const Illustration = VOLUME_ILLUSTRATIONS[v.id];

          return (
            <Link
              key={v.id}
              to={`/volume/${v.id}`}
              className="group block bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm hover:shadow-md hover:border-gray-200 transition-all duration-200"
            >
              <div className={`h-1.5 bg-gradient-to-r ${meta.gradient}`} />
              <div className="flex items-stretch">
                {/* Left: content */}
                <div className="flex-1 p-7">
                  <div className="flex items-center gap-3 mb-3">
                    <span className={`text-xs font-bold font-mono px-2.5 py-1 rounded-lg bg-gradient-to-r ${meta.gradient} text-white shadow-sm`}>
                      {v.namespace}
                    </span>
                  </div>

                  <h3 className="text-xl font-bold text-gray-900 mb-1.5 group-hover:text-indigo-700 transition-colors">
                    {v.name}
                  </h3>
                  <p className="text-sm text-gray-500 mb-4 leading-relaxed max-w-md">{meta.desc}</p>

                  {/* Topic pills */}
                  <div className="flex flex-wrap gap-1.5 mb-5">
                    {meta.topics.map(topic => (
                      <span key={topic} className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-gray-50 text-gray-500 border border-gray-150">
                        {topic}
                      </span>
                    ))}
                  </div>

                  {/* Progress bar */}
                  <div className="flex items-center gap-3">
                    <div className="flex-1 max-w-xs bg-gray-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full bg-gradient-to-r ${meta.gradient} transition-all`}
                        style={{ width: `${Math.max(pct, 1)}%` }}
                      />
                    </div>
                    <span className="text-sm text-gray-500 font-mono font-medium">
                      {v.completed_count}/{v.exercise_count}
                    </span>
                  </div>
                </div>

                {/* Right: illustration */}
                <div className="w-64 shrink-0 flex items-center justify-center p-2 bg-gray-50/80 border-l border-gray-100/80 group-hover:bg-gray-50 transition-colors">
                  {Illustration && <Illustration />}
                </div>
              </div>
            </Link>
          );
        })}
        </div>

        {/* Right: Global leaderboard (sticky) */}
        <aside className="lg:sticky lg:top-6 lg:self-start space-y-4">
          <LeaderboardWidget scope="global" limit={10} title="Top Solvers" />
          <div className="text-center">
            <Link to="/leaderboard" className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
              View full leaderboard &rarr;
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
