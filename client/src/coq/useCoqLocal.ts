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

/**
 * Compute the fully-resolved base URL for jsCoq assets.
 * Works behind reverse proxies (e.g., nginx at /sf-learn/) by using
 * import.meta.url to determine where the app's JS is served from.
 *
 * Dev:  http://localhost:5173/assets/index-xxx.js → http://localhost:5173/jscoq/
 * Prod: https://host/sf-learn/assets/index-xxx.js → https://host/sf-learn/jscoq/
 */
function getJsCoqBasePath(): string {
  const moduleUrl = import.meta.url;
  // moduleUrl is like "https://host/sf-learn/assets/index-xxx.js"
  // We want          "https://host/sf-learn/jscoq/"
  const assetsIdx = moduleUrl.lastIndexOf('/assets/');
  if (assetsIdx >= 0) {
    return moduleUrl.substring(0, assetsIdx) + '/jscoq/';
  }
  // Fallback: dev mode (no /assets/ in URL)
  return new URL('/jscoq/', moduleUrl).href;
}

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
  const [moveCursorTarget] = useState<{
    line: number; character: number; seq: number;
  } | null>(null);

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
    });

    engineRef.current = engine;

    const basePath = getJsCoqBasePath();
    console.log('[useCoqLocal] jsCoq base path:', basePath);
    engine.init(basePath, volumeId).catch((err) => {
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
