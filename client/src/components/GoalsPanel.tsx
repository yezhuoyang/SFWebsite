import type { CoqGoal } from '../types';

interface Props {
  goals: CoqGoal[] | null;
  error: string | null;
}

export default function GoalsPanel({ goals, error }: Props) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        {/* Error */}
        {error && (
          <div className="bg-red-950/50 border border-red-800/50 rounded-lg p-4 mb-4">
            <p className="text-red-400 text-xs font-semibold mb-2 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Error
            </p>
            <pre className="text-red-300 whitespace-pre-wrap text-sm font-mono leading-relaxed">{error}</pre>
          </div>
        )}

        {/* No goals yet */}
        {goals === null && !error && (
          <div className="flex flex-col items-center justify-center h-full text-center opacity-40">
            <div className="text-4xl mb-3">&#9672;</div>
            <p className="text-gray-400 text-sm">No proof in progress</p>
            <p className="text-gray-500 text-xs mt-1">Press Step to begin</p>
          </div>
        )}

        {/* Proof complete */}
        {goals && goals.length === 0 && (
          <div className="bg-emerald-950/40 border border-emerald-700/40 rounded-lg p-4">
            <p className="text-emerald-400 text-sm font-semibold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              No more subgoals
            </p>
            <p className="text-emerald-500/70 text-xs mt-2">
              Close with <code className="bg-emerald-900/50 px-1.5 py-0.5 rounded text-emerald-300">Qed.</code>
            </p>
          </div>
        )}

        {/* Goals */}
        {goals && goals.map((goal, i) => (
          <div key={i} className={i > 0 ? 'mt-6' : ''}>
            {goals.length > 1 && (
              <div className="text-xs text-gray-500 mb-2 font-medium">
                Goal {i + 1} of {goals.length}
              </div>
            )}

            {/* Hypotheses */}
            {goal.hypotheses.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {goal.hypotheses.map((h, j) => {
                  const colonIdx = h.indexOf(' : ');
                  if (colonIdx > 0) {
                    return (
                      <div key={j} className="flex gap-2 font-mono text-sm leading-relaxed">
                        <span className="text-blue-400 font-semibold shrink-0">{h.slice(0, colonIdx)}</span>
                        <span className="text-gray-600">:</span>
                        <span className="text-gray-300">{h.slice(colonIdx + 3)}</span>
                      </div>
                    );
                  }
                  return (
                    <div key={j} className="font-mono text-sm text-gray-300">{h}</div>
                  );
                })}
              </div>
            )}

            {/* Separator */}
            <div className="flex items-center gap-3 my-3">
              <div className="flex-1 h-px bg-gradient-to-r from-indigo-500/60 via-purple-500/40 to-transparent" />
            </div>

            {/* Conclusion */}
            <div className="font-mono text-base text-gray-100 leading-relaxed font-medium pl-1">
              {goal.conclusion}
            </div>
          </div>
        ))}
      </div>

      {/* Status bar */}
      {goals !== null && (
        <div className="px-4 py-2 border-t border-gray-800 text-xs font-mono text-gray-600">
          {error ? (
            <span className="text-red-500">error</span>
          ) : goals.length === 0 ? (
            <span className="text-emerald-500">complete</span>
          ) : (
            <span>{goals.length} subgoal{goals.length > 1 ? 's' : ''}</span>
          )}
        </div>
      )}
    </div>
  );
}
