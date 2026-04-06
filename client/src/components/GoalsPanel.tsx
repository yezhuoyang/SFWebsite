import PpDisplay from './PpDisplay';
import type { ProofViewNotification, CoqDiagnostic } from '../api/coqWebSocket';

interface ActivityInfo {
  viewedLabel: string | null;
  focusedLabel: string | null;
  cursorDetail: string | null;
  recentEdits: Array<{ action: string; label: string; ago: string }>;
}

interface Props {
  proofView: ProofViewNotification | null;
  diagnostics: CoqDiagnostic[];
  loading?: boolean;
  explanation: string | null;
  explainLoading: boolean;
  hint: string | null;
  hintLoading: boolean;
  activityInfo: ActivityInfo;
  renderMarkdown: (text: string) => React.ReactNode;
  onExplain: () => void;
  onHint: () => void;
}

export default function GoalsPanel({ proofView, diagnostics, loading, explanation, explainLoading, hint, hintLoading, activityInfo: _activityInfo, renderMarkdown, onExplain, onHint }: Props) {
  void _activityInfo; // Moved to History tab
  const proof = proofView?.proof;
  const messages = proofView?.messages || [];
  const goals = proof?.goals || [];
  const shelved = proof?.shelvedGoals || [];
  const _givenUp = proof?.givenUpGoals || []; void _givenUp;
  const errors = diagnostics.filter(d => d.severity === 1);
  const warnings = diagnostics.filter(d => d.severity === 2);

  // Separate info messages (Compute/Check output) from error/warning messages
  // vscoqtop uses numeric severity: 1=Error, 2=Warning, 3=Information
  // (older versions may use string names, so check both)
  const isError = (s: any) => s === 'Error' || s === 1;
  const isWarning = (s: any) => s === 'Warning' || s === 2;
  const isInfo = (s: any) => s === 'Information' || s === 3;
  const infoMessages = messages.filter(m => isInfo(m[0]));
  const errorMessages = messages.filter(m => isError(m[0]));
  const warnMessages = messages.filter(m => isWarning(m[0]));

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto p-4">

        {/* Errors from diagnostics */}
        {errors.length > 0 && (
          <div className="space-y-2 mb-4">
            {errors.map((err, i) => (
              <div key={i} className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-red-700 text-xs font-semibold mb-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Error at line {err.range.start.line + 1}
                </p>
                <pre className="text-red-600 whitespace-pre-wrap text-sm font-mono leading-relaxed">{err.message}</pre>
              </div>
            ))}
          </div>
        )}

        {/* Error messages from proofView */}
        {errorMessages.length > 0 && (
          <div className="space-y-2 mb-4">
            {errorMessages.map((msg, i) => (
              <div key={i} className="bg-red-50 border border-red-200 rounded-lg p-2">
                <span className="text-red-700 text-xs font-semibold">Error: </span>
                <PpDisplay pp={msg[1]} className="text-xs text-red-600" />
              </div>
            ))}
          </div>
        )}

        {/* Warnings from diagnostics */}
        {warnings.length > 0 && (
          <div className="space-y-2 mb-4">
            {warnings.map((w, i) => (
              <div key={i} className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-amber-700 text-xs font-semibold mb-1">Warning at line {w.range.start.line + 1}</p>
                <pre className="text-amber-600 whitespace-pre-wrap text-xs font-mono">{w.message}</pre>
              </div>
            ))}
          </div>
        )}

        {/* Warning messages from proofView */}
        {warnMessages.length > 0 && (
          <div className="space-y-2 mb-4">
            {warnMessages.map((msg, i) => (
              <div key={i} className="bg-amber-50 border border-amber-200 rounded-lg p-2">
                <span className="text-amber-700 text-xs font-semibold">Warning: </span>
                <PpDisplay pp={msg[1]} className="text-xs text-amber-600" />
              </div>
            ))}
          </div>
        )}

        {/* ============ PRIMARY OUTPUT AREA ============ */}

        {/* Coq output messages (Compute/Check/Print results) — shown PROMINENTLY */}
        {infoMessages.length > 0 && (
          <div className="mb-4">
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">Coq Output</div>
            {infoMessages.map((msg, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-lg p-3 mb-2 font-mono text-sm leading-relaxed">
                <PpDisplay pp={msg[1]} className="text-[13px]" />
              </div>
            ))}
          </div>
        )}

        {/* Goals */}
        {goals.length > 0 && (
          <div className="mb-4">
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
              {goals.length} Goal{goals.length > 1 ? 's' : ''}
            </div>
            {goals.map((goal, i) => (
              <div key={goal.id} className={i > 0 ? 'mt-5 pt-5 border-t border-gray-100' : ''}>
                {goals.length > 1 && (
                  <div className="text-xs text-gray-400 mb-2 font-medium">Goal {i + 1} of {goals.length}</div>
                )}
                {goal.hypotheses.length > 0 && (
                  <div className="space-y-1 mb-3">
                    {goal.hypotheses.map((hyp, j) => (
                      <div key={j} className="leading-relaxed">
                        <PpDisplay pp={hyp} className="text-[13px]" />
                      </div>
                    ))}
                  </div>
                )}
                <div className="my-2 border-t-2 border-gray-800" />
                <div className="leading-relaxed">
                  <PpDisplay pp={goal.goal} className="text-[14px] font-medium" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* No proof state */}
        {!proofView && errors.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-6">
            <p className="text-gray-300 text-sm">{loading ? 'Starting Coq...' : 'No proof in progress'}</p>
            <p className="text-gray-300 text-xs mt-1">Press Step to begin</p>
          </div>
        )}

        {/* Proof complete — only show if no output messages (Compute results are not "no subgoals") */}
        {proofView && goals.length === 0 && errors.length === 0 && errorMessages.length === 0 && infoMessages.length === 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
            <p className="text-green-700 text-sm font-semibold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              No more subgoals.
            </p>
            <p className="text-green-600 text-xs mt-2">
              Close with <code className="bg-green-100 px-1.5 py-0.5 rounded text-green-700 font-mono">Qed.</code>
            </p>
          </div>
        )}

        {/* Shelved */}
        {shelved.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <p className="text-xs text-gray-400 font-medium mb-2">Shelved ({shelved.length})</p>
            {shelved.map((g) => <div key={g.id} className="mb-2"><PpDisplay pp={g.goal} className="text-xs text-gray-500" /></div>)}
          </div>
        )}

        {/* AI buttons */}
        {(proofView || diagnostics.length > 0) && (
          <div className="mt-4 pt-4 border-t border-gray-100 flex gap-2">
            <button onClick={onExplain} disabled={explainLoading || hintLoading}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-lg hover:from-blue-600 hover:to-indigo-600 disabled:opacity-50 shadow-sm transition-all">
              <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="currentColor">
                <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 7a1 1 0 011 1v4a1 1 0 11-2 0v-4a1 1 0 011-1zm0-3a1 1 0 100 2 1 1 0 000-2z" />
              </svg>
              {explainLoading ? 'Thinking...' : 'Explain'}
            </button>
            <button onClick={onHint} disabled={hintLoading || explainLoading}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg hover:from-amber-600 hover:to-orange-600 disabled:opacity-50 shadow-sm transition-all">
              <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="currentColor">
                <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zm4.657 2.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zm3-7a5 5 0 00-1 9.9V14a1 1 0 001 1h2a1 1 0 001-1v-1.1A5 5 0 008 3zm0 2a3 3 0 00-1 5.83V12h2v-1.17A3 3 0 008 5zm-1 11a1 1 0 011-1h2a1 1 0 110 2H8a1 1 0 01-1-1z" />
              </svg>
              {hintLoading ? 'Thinking...' : 'Hint'}
            </button>
          </div>
        )}

        {/* Inline AI Explanation */}
        {(explanation || explainLoading) && (
          <div className="mt-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">AI Explanation</span>
              {explainLoading && <span className="text-[10px] text-gray-400">thinking...</span>}
            </div>
            <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3 text-[12.5px] leading-relaxed text-gray-800">
              {explanation ? renderMarkdown(explanation) : <span className="text-gray-400">Analyzing...</span>}
            </div>
          </div>
        )}

        {/* Inline AI Hint */}
        {(hint || hintLoading) && (
          <div className="mt-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">AI Hint</span>
              {hintLoading && <span className="text-[10px] text-gray-400">thinking...</span>}
            </div>
            <div className="bg-amber-50/50 border border-amber-100 rounded-lg p-3 text-[12.5px] leading-relaxed text-gray-800">
              {hint ? renderMarkdown(hint) : <span className="text-gray-400">Thinking of a hint...</span>}
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="px-4 py-2 border-t border-gray-100 text-xs font-mono text-gray-400">
        {errors.length > 0 ? (
          <span className="text-red-500">{errors.length} error{errors.length > 1 ? 's' : ''}</span>
        ) : !proofView ? (
          loading ? 'connecting...' : 'idle'
        ) : goals.length === 0 ? (
          <span className="text-green-600">complete</span>
        ) : (
          `${goals.length} subgoal${goals.length > 1 ? 's' : ''}`
        )}
      </div>
    </div>
  );
}
