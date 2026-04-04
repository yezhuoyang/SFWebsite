import { Outlet, Link, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { getVolumes } from '../api/client';
import type { Volume } from '../types';

const VOLUME_COLORS: Record<string, string> = {
  lf: 'bg-blue-500',
  plf: 'bg-purple-500',
  vfa: 'bg-green-500',
  slf: 'bg-orange-500',
  secf: 'bg-red-500',
};

export default function Layout() {
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const location = useLocation();

  useEffect(() => {
    getVolumes().then(setVolumes).catch(console.error);
  }, []);

  return (
    <div className="flex h-screen bg-[#0f1117]">
      {/* Sidebar */}
      <aside className="w-64 bg-[#13141c] border-r border-gray-800 flex flex-col shrink-0">
        <Link to="/" className="p-4 border-b border-gray-800 hover:bg-gray-800/50">
          <h1 className="text-lg font-bold text-gray-100">SF Learning</h1>
          <p className="text-xs text-gray-500">Software Foundations</p>
        </Link>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {volumes.map((v) => {
            const pct = v.exercise_count > 0
              ? Math.round((v.completed_count / v.exercise_count) * 100)
              : 0;
            const isActive = location.pathname.includes(`/volume/${v.id}`);

            return (
              <Link
                key={v.id}
                to={`/volume/${v.id}`}
                className={`block p-3 rounded-lg transition-colors ${
                  isActive ? 'bg-indigo-950/50 text-indigo-400' : 'hover:bg-gray-800/50'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full ${VOLUME_COLORS[v.id] || 'bg-gray-400'}`} />
                  <span className="text-sm font-medium text-gray-100">{v.namespace}</span>
                  <span className="text-xs text-gray-500 ml-auto">{pct}%</span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full ${VOLUME_COLORS[v.id] || 'bg-gray-400'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {v.completed_count}/{v.exercise_count} exercises
                </p>
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-gray-800 space-y-2">
          <Link
            to="/tutor"
            className={`block p-3 rounded-lg text-sm font-medium transition-colors ${
              location.pathname === '/tutor'
                ? 'bg-indigo-950/50 text-indigo-400'
                : 'text-gray-400 hover:bg-gray-800/50'
            }`}
          >
            AI Tutor
          </Link>
          <p className="text-xs text-gray-600 px-3">Powered by Coq 8.20 + SerAPI</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
