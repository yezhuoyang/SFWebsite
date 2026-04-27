import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getVolumes } from '../api/client';
import type { Volume } from '../types';
import { STATIC_VOLUMES } from '../data/sfVolumes';
import { PLSELogo, UCLACSLogo } from '../components/PLSELogo';
import { countVolumeLocalCompleted } from '../utils/storage';
import LeaderboardWidget from '../components/LeaderboardWidget';
import { useAuth } from '../contexts/AuthContext';

/**
 * Volume metadata in the SF book series style. Colors and cover icons
 * mirror coq.vercel.app/ext/sf/ \u2014 see the source CSS table.logical /
 * .language_found / .algo / .slf classes.
 */
interface VolumeMeta {
  number: number;
  italicTitle: string;
  description: string;
  cover: string;       // path under /sf-covers/ (downloaded from upstream)
  tabColor: string;    // top band color
  bodyColor: string;   // translucent body color
}
const VOLUME_META: Record<string, VolumeMeta> = {
  lf: {
    number: 1,
    italicTitle: 'Logical Foundations',
    description:
      'Logical Foundations is the entry-point to the series. It covers functional programming, basic concepts of logic, computer-assisted theorem proving, and Coq.',
    cover: '/sf-covers/lf_icon.jpg',
    tabColor: '#91a1d1',
    bodyColor: 'rgba(144, 160, 209, 0.5)',
  },
  plf: {
    number: 2,
    italicTitle: 'Programming Language Foundations',
    description:
      'Programming Language Foundations surveys the theory of programming languages, including operational semantics, Hoare logic, and static type systems.',
    cover: '/sf-covers/plf_icon.jpg',
    tabColor: '#b25959',
    bodyColor: 'rgba(178, 88, 88, 0.5)',
  },
  vfa: {
    number: 3,
    italicTitle: 'Verified Functional Algorithms',
    description:
      'Verified Functional Algorithms shows how a variety of fundamental data structures can be specified and mechanically verified.',
    cover: '/sf-covers/vfa_icon.jpg',
    tabColor: '#c2c26c',
    bodyColor: 'rgba(194, 194, 108, 0.5)',
  },
  slf: {
    number: 6,
    italicTitle: 'Separation Logic Foundations',
    description:
      'Separation Logic Foundations introduces the core ideas and techniques of separation logic for reasoning about heap-manipulating programs.',
    cover: '/sf-covers/slf-icon.png',
    tabColor: 'rgb(219, 178, 127)',
    bodyColor: 'rgba(219, 178, 127, 0.5)',
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
    // If the API isn't reachable (Phase 0 dev: FastAPI may not be running),
    // fall back to the four built-in SF volumes so navigation still works.
    getVolumes().then(setVolumes).catch(() => setVolumes(STATIC_VOLUMES));
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

      {/* 2-column layout: volume books left, leaderboard right */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8">
        {/* Left: SF-book-style volume grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 content-start">
          {volumesWithLocal.map(v => {
            const meta = VOLUME_META[v.id];
            if (!meta) return null;
            return <VolumeBook key={v.id} volume={v} meta={meta} />;
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

/**
 * SF-book-series-styled card: a colored "tab" header with `Volume N`,
 * a tinted body containing the italic title + description and the
 * book cover thumbnail. Mirrors coq.vercel.app/ext/sf/ visually.
 */
function VolumeBook({ volume, meta }: { volume: Volume; meta: VolumeMeta }) {
  const pct = volume.exercise_count > 0
    ? Math.round((volume.completed_count / volume.exercise_count) * 100)
    : 0;
  return (
    <Link
      // Land on the volume's first chapter (Preface) so the sidebar
      // immediately shows an in-chapter outline. The user can navigate
      // to other chapters via the sidebar's Prev/Next buttons or by
      // clicking links inside the iframe (those still work for reading
      // — they just won't update our sidebar's outline since the iframe
      // is cross-origin).
      to={`/volume/${volume.id}/chapter/Preface`}
      className="group block rounded-md overflow-hidden shadow-sm hover:shadow-lg transition-shadow"
      style={{ backgroundColor: meta.bodyColor }}
    >
      {/* Top tab band with "Volume N" */}
      <div
        className="px-3 py-1.5 text-white text-[13px] font-semibold tracking-wide"
        style={{ backgroundColor: meta.tabColor }}
      >
        Volume {meta.number}
      </div>

      {/* Body: description + cover */}
      <div className="p-4 flex flex-col items-center text-center">
        <p className="text-[13px] leading-snug font-semibold text-gray-800 mb-3 text-left w-full">
          <i>{meta.italicTitle}</i>
          {' '}
          <span className="font-normal">
            {meta.description.replace(meta.italicTitle, '').replace(/^\s+/, '')}
          </span>
        </p>
        <img
          src={meta.cover}
          alt={`${meta.italicTitle} cover`}
          className="w-44 h-auto shadow-md group-hover:shadow-lg transition-shadow"
          loading="lazy"
        />
        {volume.exercise_count > 0 && (
          <div className="mt-3 w-full">
            <div className="bg-white/60 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full transition-all"
                style={{ width: `${Math.max(pct, 1)}%`, backgroundColor: meta.tabColor }}
              />
            </div>
            <p className="text-[11px] text-gray-700 font-medium mt-1">
              {volume.completed_count}/{volume.exercise_count} exercises
            </p>
          </div>
        )}
      </div>
    </Link>
  );
}
