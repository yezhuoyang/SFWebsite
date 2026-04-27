import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { getVolumes } from '../api/client';
import type { Volume } from '../types';
import { SFLogo } from './VolumeIllustrations';
import { PLSELogo } from './PLSELogo';
import { countVolumeLocalCompleted } from '../utils/storage';
import { useAuth } from '../contexts/AuthContext';
import { STATIC_VOLUMES } from '../data/sfVolumes';

const VOLUME_COLORS: Record<string, string> = {
  lf: 'bg-blue-500',
  plf: 'bg-violet-500',
  vfa: 'bg-emerald-500',
  slf: 'bg-amber-500',
  secf: 'bg-rose-500',
};

export default function Layout() {
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  useEffect(() => {
    // Re-fetch when the auth user changes — the per-user completion counts
    // baked into /volumes responses depend on the JWT we send. If the
    // FastAPI server isn't reachable, fall back to the four built-in SF
    // volumes so the sidebar still renders.
    getVolumes().then(setVolumes).catch(() => setVolumes(STATIC_VOLUMES));
  }, [user?.id]);

  return (
    <div className="flex h-screen bg-[#f8f7f4]">
      {/* Sidebar */}
      <aside className="w-60 bg-white border-r border-gray-200/80 flex flex-col shrink-0 shadow-sm">
        <Link to="/" className="flex items-center gap-3 p-5 border-b border-gray-100 hover:bg-gray-50/80 transition-colors">
          <SFLogo size={36} />
          <div>
            <h1 className="text-base font-extrabold text-gray-900 tracking-tight">SF Learning</h1>
            <p className="text-[11px] text-gray-400 mt-0.5 font-medium">Software Foundations</p>
          </div>
        </Link>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {volumes.map((v) => {
            const localCount = countVolumeLocalCompleted(user?.id, v.id);
            const completed = Math.max(v.completed_count, localCount);
            const pct = v.exercise_count > 0
              ? Math.round((completed / v.exercise_count) * 100)
              : 0;
            const isActive = location.pathname.includes(`/volume/${v.id}`);

            return (
              <Link
                key={v.id}
                to={`/volume/${v.id}/chapter/Preface`}
                className={`block p-3 rounded-xl transition-all ${
                  isActive
                    ? 'bg-indigo-50 ring-1 ring-indigo-200/60'
                    : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`w-2 h-2 rounded-full ${VOLUME_COLORS[v.id] || 'bg-gray-400'}`} />
                  <span className={`text-sm font-semibold ${isActive ? 'text-indigo-700' : 'text-gray-700'}`}>
                    {v.name}
                  </span>
                  <span className="text-[11px] text-gray-400 ml-auto font-medium">{pct}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full ${VOLUME_COLORS[v.id] || 'bg-gray-400'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-[11px] text-gray-400 mt-1">
                  {completed}/{v.exercise_count}
                </p>
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-gray-100 space-y-1">
          <Link
            to="/tutor"
            className={`flex items-center gap-2 p-3 rounded-xl text-sm font-semibold transition-all ${
              location.pathname === '/tutor'
                ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200/60'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
            }`}
          >
            <span className="text-base">&#9672;</span>
            AI Tutor
          </Link>
          <Link
            to="/leaderboard"
            className={`flex items-center gap-2 p-3 rounded-xl text-sm font-semibold transition-all ${
              location.pathname === '/leaderboard'
                ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200/60'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
            }`}
          >
            <span className="text-base">&#9734;</span>
            Leaderboard
          </Link>

          {/* User menu */}
          {user ? (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-gray-50">
              <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold shrink-0">
                {(user.display_name || user.username).charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-800 truncate">{user.display_name || user.username}</div>
                <div className="text-[10px] text-gray-400">@{user.username}</div>
              </div>
              <button
                onClick={() => { logout(); navigate('/login'); }}
                className="text-[10px] text-gray-400 hover:text-red-500 font-medium"
                title="Sign out"
              >
                Logout
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              className="flex items-center gap-2 p-3 rounded-xl text-sm font-semibold text-blue-600 hover:bg-blue-50 transition-all"
            >
              Sign In
            </Link>
          )}

          <div className="px-3 py-2 flex justify-center">
            <PLSELogo size={80} />
          </div>
          <p className="text-[10px] text-gray-300 px-3 pb-1 font-medium text-center">UCLA PLSE &middot; Rocq 8.17</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
