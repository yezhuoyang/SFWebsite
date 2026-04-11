/**
 * WebSocket client for real-time Coq interaction via vscoqtop.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { PpString } from '../components/PpDisplay';

// --- Types matching vscoqtop protocol ---

export interface VscoqGoal {
  id: number;
  name?: string | null;
  goal: PpString;
  hypotheses: PpString[];
}

export interface ProofViewGoals {
  goals: VscoqGoal[];
  shelvedGoals: VscoqGoal[];
  givenUpGoals: VscoqGoal[];
  unfocusedGoals: VscoqGoal[];
}

export type MessageSeverity = "Error" | "Warning" | "Information";
export type RocqMessage = [MessageSeverity, PpString];

export interface ProofViewNotification {
  proof: ProofViewGoals | null;
  messages: RocqMessage[];
}

/**
 * A single entry in the persistent activity log (below the Goals panel).
 * Unlike `messages` inside ProofViewNotification which is reset each sentence,
 * these accumulate for the whole session so users can see a history of what
 * they ran: "isred is defined", "nandb is defined", etc.
 */
export interface ActivityEntry {
  seq: number;               // monotonic counter for stable keys / ordering
  sid: number;               // Coq sentence id that produced it
  severity: MessageSeverity;
  text: string;              // plain-text message body (e.g. "isred is defined")
  sentencePreview: string;   // first ~80 chars of the sentence that produced it
  line: number;              // 0-indexed absolute line of the sentence start
  kind: 'message' | 'synthetic'; // synthetic = we generated it because Coq was silent
  timestamp: number;
}

export interface HighlightRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface UpdateHighlights {
  uri: string;
  preparedRange: HighlightRange[];
  processingRange: HighlightRange[];
  processedRange: HighlightRange[];
}

export interface CoqDiagnostic {
  range: HighlightRange;
  message: string;
  severity: number;
}

// --- WebSocket Hook ---

export interface CoqSessionState {
  connected: boolean;
  proofView: ProofViewNotification | null;
  highlights: UpdateHighlights | null;
  diagnostics: CoqDiagnostic[];
  moveCursorTarget: { line: number; character: number; seq: number } | null;
  /** Persistent activity log — accumulates Coq Notice/Info/Error messages as
   *  the user steps forward. Trimmed on step-backward past the producing sid. */
  activityLog: ActivityEntry[];
}

export interface CoqSessionActions {
  stepForward: () => void;
  stepBackward: () => void;
  interpretToPoint: (line: number, character: number) => void;
  interpretToEnd: () => void;
  sendChange: (text: string) => void;
  interrupt: () => void;
}

export function useCoqWebSocket(
  sessionId: string | null,
): [CoqSessionState, CoqSessionActions] {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [proofView, setProofView] = useState<ProofViewNotification | null>(null);
  const [highlights, setHighlights] = useState<UpdateHighlights | null>(null);
  const [diagnostics, setDiagnostics] = useState<CoqDiagnostic[]>([]);
  const [moveCursorTarget, setMoveCursorTarget] = useState<{ line: number; character: number; seq: number } | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/coq/ws/${sessionId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    // Send keepalive ping every 5 minutes to prevent session idle timeout
    const keepalive = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 5 * 60 * 1000);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case 'proofView':
            setProofView({
              proof: data.proof || null,
              messages: data.messages || [],
            });
            break;
          case 'highlights':
            setHighlights({
              uri: data.uri || '',
              preparedRange: data.preparedRange || [],
              processingRange: data.processingRange || [],
              processedRange: data.processedRange || [],
            });
            break;
          case 'diagnostics':
            setDiagnostics(data.items || []);
            break;
          case 'moveCursor':
            if (data.range?.end) {
              setMoveCursorTarget({
                line: data.range.end.line,
                character: data.range.end.character,
                seq: Date.now(),
              });
            }
            break;
          case 'error':
            console.error('Coq error:', data.message);
            break;
        }
      } catch (e) {
        console.error('WebSocket message parse error:', e);
      }
    };

    return () => {
      clearInterval(keepalive);
      ws.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [sessionId]);

  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const actions: CoqSessionActions = {
    stepForward: useCallback(() => send({ type: 'stepForward' }), [send]),
    stepBackward: useCallback(() => send({ type: 'stepBackward' }), [send]),
    interpretToPoint: useCallback((line: number, character: number) =>
      send({ type: 'interpretToPoint', line, character }), [send]),
    interpretToEnd: useCallback(() => send({ type: 'interpretToEnd' }), [send]),
    sendChange: useCallback((text: string) => send({ type: 'change', text }), [send]),
    interrupt: useCallback(() => send({ type: 'interrupt' }), [send]),
  };

  // Legacy WebSocket hook: activityLog is always empty (feature implemented
  // in useCoqLocal for the jsCoq backend).
  return [{ connected, proofView, highlights, diagnostics, moveCursorTarget, activityLog: [] }, actions];
}
