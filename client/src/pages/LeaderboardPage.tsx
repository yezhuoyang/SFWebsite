import { useEffect, useState } from 'react';
import { getLeaderboard, getMyRank, type LeaderboardEntry } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [myRank, setMyRank] = useState<LeaderboardEntry | null>(null);
  const [sort, setSort] = useState<'points' | 'exercises' | 'streak'>('points');
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    setLoading(true);
    getLeaderboard(sort).then(setEntries).catch(console.error).finally(() => setLoading(false));
    if (user) getMyRank().then(setMyRank).catch(() => {});
  }, [sort, user]);

  const sortLabels = { points: 'Total Points', exercises: 'Exercises Solved', streak: 'Current Streak' };

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Leaderboard</h1>

      {/* Sort tabs */}
      <div className="flex gap-2 mb-6">
        {(Object.keys(sortLabels) as Array<keyof typeof sortLabels>).map(key => (
          <button
            key={key}
            onClick={() => setSort(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              sort === key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {sortLabels[key]}
          </button>
        ))}
      </div>

      {/* My rank card */}
      {myRank && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-lg">
            {myRank.rank}
          </div>
          <div className="flex-1">
            <div className="font-semibold text-gray-900">{myRank.display_name || myRank.username}</div>
            <div className="text-sm text-gray-500">Your rank</div>
          </div>
          <div className="text-right">
            <div className="font-bold text-blue-700">{myRank.total_points} pts</div>
            <div className="text-xs text-gray-500">{myRank.exercises_completed} solved</div>
          </div>
        </div>
      )}

      {/* Leaderboard table */}
      {loading ? (
        <div className="text-center text-gray-400 py-12">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="text-center text-gray-400 py-12">No entries yet. Be the first to solve an exercise!</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                <th className="px-4 py-3 text-left w-12">#</th>
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-right">Points</th>
                <th className="px-4 py-3 text-right">Solved</th>
                <th className="px-4 py-3 text-right">Streak</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => {
                const isMe = user && e.user_id === user.id;
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null;
                return (
                  <tr key={e.user_id} className={`border-t border-gray-100 ${isMe ? 'bg-blue-50/50' : 'hover:bg-gray-50'}`}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-500">
                      {medal || e.rank}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-600">
                          {(e.display_name || e.username).charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900">{e.display_name || e.username}</div>
                          <div className="text-xs text-gray-400">@{e.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-semibold text-gray-700">{e.total_points}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">{e.exercises_completed}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">
                      {e.current_streak > 0 ? `${e.current_streak}d` : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
