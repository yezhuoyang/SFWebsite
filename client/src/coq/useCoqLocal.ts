/**
 * React hook that runs Coq locally in the browser via jsCoq Web Worker.
 * Drop-in replacement for useCoqWebSocket — returns the same
 * [CoqSessionState, CoqSessionActions] tuple.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { CoqEngine } from './CoqEngine';
import type {
  CoqSessionState,
  CoqSessionActions,
  ProofViewNotification,
  UpdateHighlights,
  CoqDiagnostic,
} from '../api/coqWebSocket';

/** Base path where jsCoq static assets are served (worker JS + coq-pkgs) */
const JSCOQ_BASE_PATH = '/jscoq/';

/**
 * useCoqLocal — run Coq in the browser via jsCoq.
 *
 * @param volumeId   e.g. 'lf', 'plf', 'vfa', 'slf'
 * @param chapterName  e.g. 'Basics' (used only for logging, not for Coq init)
 * @returns Same [CoqSessionState, CoqSessionActions] as useCoqWebSocket
 */
export function useCoqLocal(
  volumeId: string | null,
  chapterName: string | null,
): [CoqSessionState, CoqSessionActions] {
  const [connected, setConnected] = useState(false);
  const [proofView, setProofView] = useState<ProofViewNotification | null>(null);
  const [highlights, setHighlights] = useState<UpdateHighlights | null>(null);
  const [diagnostics, setDiagnostics] = useState<CoqDiagnostic[]>([]);
  const [moveCursorTarget, setMoveCursorTarget] = useState<{
    line: number; character: number; seq: number;
  } | null>(null);
  const [loadProgress, setLoadProgress] = useState<number>(0);

  const engineRef = useRef<CoqEngine | null>(null);

  useEffect(() => {
    if (!volumeId) return;

    const engine = new CoqEngine({
      onProofView: setProofView,
      onHighlights: setHighlights,
      onDiagnostics: setDiagnostics,
      onReady: () => {
        console.log(`[useCoqLocal] Coq engine ready for ${volumeId}/${chapterName}`);
        setConnected(true);
      },
      onError: (msg) => {
        console.error('[useCoqLocal] Engine error:', msg);
      },
      onLoadProgress: (ratio) => {
        setLoadProgress(ratio);
      },
    });

    engineRef.current = engine;

    engine.init(JSCOQ_BASE_PATH, volumeId).catch((err) => {
      console.error('[useCoqLocal] Init failed:', err);
      setConnected(false);
    });

    return () => {
      engine.dispose();
      engineRef.current = null;
      setConnected(false);
      setProofView(null);
      setHighlights(null);
      setDiagnostics([]);
    };
  }, [volumeId, chapterName]);

  const actions: CoqSessionActions = {
    stepForward: useCallback(() => {
      engineRef.current?.stepForward();
    }, []),

    stepBackward: useCallback(() => {
      engineRef.current?.stepBackward();
    }, []),

    interpretToPoint: useCallback((line: number, character: number) => {
      engineRef.current?.interpretToPoint(line, character);
    }, []),

    interpretToEnd: useCallback(() => {
      engineRef.current?.interpretToEnd();
    }, []),

    sendChange: useCallback((text: string) => {
      engineRef.current?.setDocument(text);
    }, []),

    interrupt: useCallback(() => {
      engineRef.current?.interrupt();
    }, []),
  };

  const state: CoqSessionState = {
    connected,
    proofView,
    highlights,
    diagnostics,
    moveCursorTarget,
  };

  return [state, actions];
}

/**
 * useCoqSession — wrapper that selects between local (jsCoq) and server (WebSocket) modes.
 * For now, always uses local mode.
 */
export { useCoqLocal as useCoqSession };
