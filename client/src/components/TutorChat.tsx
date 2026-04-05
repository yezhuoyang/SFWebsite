/**
 * Floating AI tutor chatbox — draggable, resizable, with markdown rendering,
 * Coq syntax highlighting, and GPS links to chapter locations.
 */

import { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

/** GPS anchor: a named location in the chapter that the tutor can link to. */
export interface GpsAnchor {
  label: string;    // e.g. "Section: Data and Functions" or "Exercise: nandb"
  blockId: number;  // block ID to scroll to
  kind: string;     // "section" | "subsection" | "exercise" | "definition" | "theorem"
}

interface Props {
  volumeId: string;
  chapterName: string;
  exerciseName: string | null;
  studentCode: string;
  proofStateText: string;
  diagnosticsText: string;
  processedLines: number | null;
  hasError: boolean;
  hasGoals: boolean;
  gpsAnchors: GpsAnchor[];
  onNavigate: (blockId: number) => void;
  getActivityContext: () => string;
}

export interface TutorChatHandle {
  sendMessage: (msg: string) => void;
}

// ============ Markdown rendering ============

export function renderMarkdown(text: string, onNavigate: (blockId: number) => void, anchors: GpsAnchor[]): React.ReactNode[] {
  const parts = text.split(/(```[\s\S]*?```)/g);
  const elements: React.ReactNode[] = [];

  parts.forEach((part, i) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      const inner = part.slice(3, -3);
      const firstNl = inner.indexOf('\n');
      let code = inner;
      if (firstNl > 0 && firstNl < 20 && !inner.slice(0, firstNl).includes(' ')) {
        code = inner.slice(firstNl + 1);
      }
      elements.push(
        <pre key={i} className="my-2 p-3 rounded-lg text-[12.5px] leading-relaxed overflow-x-auto font-mono bg-white border border-gray-200">
          <code>{renderCoqCode(code.trim())}</code>
        </pre>
      );
    } else {
      elements.push(<span key={i}>{renderInlineMarkdown(part, onNavigate, anchors)}</span>);
    }
  });
  return elements;
}

function renderInlineMarkdown(text: string, onNavigate: (blockId: number) => void, anchors: GpsAnchor[]): React.ReactNode[] {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];

  const flushList = () => {
    if (listItems.length) {
      elements.push(<ul key={`ul-${elements.length}`} className="list-disc list-inside my-1.5 space-y-0.5 ml-1">{listItems}</ul>);
      listItems = [];
    }
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      listItems.push(<li key={i} className="text-[13px]">{formatInline(trimmed.slice(2), onNavigate, anchors)}</li>);
      return;
    }
    if (/^\d+\.\s/.test(trimmed)) {
      flushList();
      elements.push(<div key={i} className="text-[13px] ml-2 my-0.5">{formatInline(trimmed, onNavigate, anchors)}</div>);
      return;
    }
    flushList();
    if (!trimmed) { elements.push(<div key={i} className="h-2" />); return; }
    if (trimmed.startsWith('### ')) { elements.push(<div key={i} className="font-semibold text-[13px] text-gray-800 mt-2 mb-0.5">{formatInline(trimmed.slice(4), onNavigate, anchors)}</div>); return; }
    if (trimmed.startsWith('## ')) { elements.push(<div key={i} className="font-semibold text-sm text-gray-800 mt-2 mb-0.5">{formatInline(trimmed.slice(3), onNavigate, anchors)}</div>); return; }
    elements.push(<span key={i}>{formatInline(line, onNavigate, anchors)}{i < lines.length - 1 ? ' ' : ''}</span>);
  });
  flushList();
  return elements;
}

/** Format inline: **bold**, *italic*, `code`, and [[GPS:blockId:label]] links */
function formatInline(text: string, onNavigate: (blockId: number) => void, _anchors: GpsAnchor[]): React.ReactNode[] {
  // First handle GPS links: [[GPS:123:label text]]
  const gpsPattern = /\[\[GPS:(\d+):([^\]]+)\]\]/g;
  const segments: React.ReactNode[] = [];
  let lastIdx = 0;
  let match;

  while ((match = gpsPattern.exec(text)) !== null) {
    if (match.index > lastIdx) {
      segments.push(...formatBasicInline(text.slice(lastIdx, match.index)));
    }
    const blockId = parseInt(match[1]);
    const label = match[2];
    segments.push(
      <button
        key={`gps-${match.index}`}
        onClick={() => onNavigate(blockId)}
        className="text-blue-600 hover:text-blue-800 underline decoration-blue-300 hover:decoration-blue-500 cursor-pointer font-medium"
        title={`Jump to: ${label}`}
      >
        {label}
      </button>
    );
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < text.length) {
    segments.push(...formatBasicInline(text.slice(lastIdx)));
  }

  return segments.length ? segments : formatBasicInline(text);
}

function formatBasicInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, j) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={j} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**'))
      return <em key={j} className="italic">{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={j} className="font-mono text-[12px] bg-gray-100 text-[#006600] px-1 py-0.5 rounded">{part.slice(1, -1)}</code>;
    return <span key={j}>{part}</span>;
  });
}

function renderCoqCode(code: string): React.ReactNode[] {
  const keywords = new Set(['Theorem','Lemma','Proof','Qed','Defined','Admitted','Abort','Definition','Fixpoint','Inductive','Example','Check','Compute','From','Require','Import','Export','Module','End','Section','match','with','end','fun','forall','exists','let','in','if','then','else','return','as','Set','Notation','Record','Type','Prop']);
  const tactics = new Set(['intros','intro','simpl','reflexivity','rewrite','induction','destruct','apply','exact','assumption','auto','eauto','discriminate','injection','inversion','subst','split','left','right','constructor','unfold','assert','generalize','specialize','clear','rename','revert','replace','symmetry','transitivity','f_equal','congruence','tauto','lia','omega','try','repeat','now']);
  const tokens = code.split(/(\b\w+\b|[^\w\s]+|\s+)/g);
  return tokens.map((t, i) => {
    if (keywords.has(t)) return <span key={i} className="text-[#697f2f] font-semibold">{t}</span>;
    if (tactics.has(t)) return <span key={i} className="text-[#697f2f]">{t}</span>;
    return <span key={i}>{t}</span>;
  });
}

// ============ Main component ============

const TutorChat = forwardRef<TutorChatHandle, Props>(function TutorChat({
  volumeId, chapterName, exerciseName,
  studentCode, proofStateText, diagnosticsText,
  processedLines, hasError, hasGoals,
  gpsAnchors, onNavigate, getActivityContext,
}: Props, ref) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const historyLoaded = useRef(false);

  useEffect(() => {
    if (historyLoaded.current) return;
    historyLoaded.current = true;
    fetch(`/api/tutor/history?volume_id=${volumeId}&chapter_name=${chapterName}`)
      .then(r => r.json())
      .then((data: any[]) => { if (data.length) setMessages(data.map(m => ({ role: m.role, content: m.content }))); })
      .catch(console.error);
  }, [volumeId, chapterName]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Build GPS instruction for the AI
  const gpsInstruction = useCallback(() => {
    if (!gpsAnchors.length) return '';
    const entries = gpsAnchors.slice(0, 60).map(a => `  [[GPS:${a.blockId}:${a.label}]]`).join('\n');
    return `\n\nWhen referring to locations in this chapter, use GPS links so the student can click to navigate. Format: [[GPS:blockId:visible label]]. Available anchors:\n${entries}`;
  }, [gpsAnchors]);

  const sendMessage = useCallback(async (msg: string) => {
    if (!msg.trim() || streaming) return;
    const userMsg = msg.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setStreaming(true);

    try {
      const activityContext = getActivityContext();
      const activitySection = activityContext
        ? `\n\n## USER ACTIVITY (current moment — what the user is actually looking at)\nIMPORTANT: Use this to understand where the user's attention is RIGHT NOW. The user may have moved away from an exercise to review earlier material. Always answer based on what they're looking at, not where you last saw them.\n${activityContext}`
        : '';
      const res = await fetch('/api/tutor/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg + activitySection + gpsInstruction(),
          volume_id: volumeId,
          chapter_name: chapterName,
          exercise_name: exerciseName,
          student_code: studentCode,
          proof_state_text: proofStateText,
          diagnostics_text: diagnosticsText,
          processed_lines: processedLines,
        }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let content = '';
      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const line of decoder.decode(value).split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const d = JSON.parse(line.slice(6));
              if (d.text) {
                content += d.text;
                setMessages(prev => {
                  const u = [...prev];
                  u[u.length - 1] = { role: 'assistant', content };
                  return u;
                });
              }
            } catch {}
          }
        }
      }
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally {
      setStreaming(false);
    }
  }, [volumeId, chapterName, exerciseName, studentCode, proofStateText, diagnosticsText, processedLines, streaming, gpsInstruction, getActivityContext]);

  // Expose sendMessage to parent via ref
  useImperativeHandle(ref, () => ({ sendMessage }), [sendMessage]);

  return (
    <div className="h-full flex flex-col">
      {/* Quick actions */}
      <div className="px-3 py-2 border-b border-gray-100 flex flex-wrap gap-1.5 shrink-0">
        {hasError && (
          <button onClick={() => sendMessage("I'm getting an error from Coq. Explain what it means and how to fix it.")} disabled={streaming}
            className="text-[11px] px-2.5 py-1 rounded-full bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 disabled:opacity-40 font-medium">Explain error</button>
        )}
        {exerciseName && (
          <button onClick={() => sendMessage(`I'm stuck on exercise "${exerciseName}". Give me a hint.`)} disabled={streaming}
            className="text-[11px] px-2.5 py-1 rounded-full bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-200 disabled:opacity-40 font-medium">Hint</button>
        )}
        {hasGoals && (
          <button onClick={() => sendMessage("What tactic should I try next?")} disabled={streaming}
            className="text-[11px] px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 disabled:opacity-40 font-medium">What tactic?</button>
        )}
        <button onClick={() => sendMessage("Explain the concept discussed in this section.")} disabled={streaming}
          className="text-[11px] px-2.5 py-1 rounded-full bg-gray-50 text-gray-500 hover:bg-gray-100 border border-gray-200 disabled:opacity-40 font-medium">Explain concept</button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {messages.length === 0 && (
          <div className="text-center text-gray-300 mt-8 space-y-2">
            <p className="text-sm">Ask me anything!</p>
            <p className="text-xs text-gray-400">I can see your code, goals, and errors.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[92%] rounded-xl px-3.5 py-2.5 ${
              msg.role === 'user' ? 'bg-blue-500 text-white rounded-br-sm' : 'bg-gray-50 border border-gray-100 text-gray-800 rounded-bl-sm'
            }`}>
              {msg.role === 'user' ? (
                <div className="text-[13px] leading-relaxed">{msg.content}</div>
              ) : (
                <div className="text-[13px] leading-relaxed">
                  {msg.content ? renderMarkdown(msg.content, onNavigate, gpsAnchors)
                    : (streaming && i === messages.length - 1 ? <span className="text-gray-400 animate-pulse">Thinking...</span> : '')}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-2.5 border-t border-gray-100 shrink-0">
        <div className="flex gap-1.5">
          <input type="text" value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage(input)}
            placeholder="Ask about code, tactics, concepts..."
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            disabled={streaming} />
          <button onClick={() => sendMessage(input)} disabled={streaming || !input.trim()}
            className="px-3.5 py-2 bg-blue-500 text-white text-xs font-medium rounded-lg hover:bg-blue-600 disabled:opacity-30 shrink-0">
            {streaming ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
});

export default TutorChat;
