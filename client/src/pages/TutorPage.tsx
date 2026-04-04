import { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function TutorPage() {
  const [searchParams] = useSearchParams();
  const volumeId = searchParams.get('volume') || '';
  const chapterName = searchParams.get('chapter') || '';
  const exerciseName = searchParams.get('exercise') || '';
  const currentGoals = searchParams.get('goals') || '';

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load history on mount
  useEffect(() => {
    if (!volumeId || !chapterName) return;
    fetch(`/api/tutor/history?volume_id=${volumeId}&chapter_name=${chapterName}`)
      .then(r => r.json())
      .then((data: any[]) => {
        setMessages(data.map(m => ({ role: m.role, content: m.content })));
      })
      .catch(console.error);
  }, [volumeId, chapterName]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || streaming) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setStreaming(true);

    try {
      const res = await fetch('/api/tutor/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          volume_id: volumeId || null,
          chapter_name: chapterName || null,
          exercise_name: exerciseName || null,
          current_goals: currentGoals || null,
          current_error: null,
          current_code: null,
        }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';

      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) {
                assistantContent += data.text;
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    role: 'assistant',
                    content: assistantContent,
                  };
                  return updated;
                });
              }
            } catch {}
          }
        }
      }
    } catch (e: any) {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `Error: ${e.message}` },
      ]);
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-3 bg-white border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">AI Tutor</h2>
        {volumeId && (
          <p className="text-xs text-gray-500">
            {volumeId.toUpperCase()} &gt; {chapterName}
            {exerciseName && ` > ${exerciseName}`}
          </p>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-12">
            <p className="text-lg mb-2">Ask me anything about Software Foundations!</p>
            <p className="text-sm">I can help with tactics, concepts, and exercises.</p>
            <p className="text-sm mt-1">I'll use your current proof state to give targeted hints.</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-2xl rounded-lg px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-indigo-500 text-white'
                  : 'bg-white border border-gray-200 text-gray-800'
              }`}
            >
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                {msg.content}
              </pre>
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 bg-white border-t border-gray-200">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Ask about a tactic, concept, or exercise..."
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            disabled={streaming}
          />
          <button
            onClick={sendMessage}
            disabled={streaming || !input.trim()}
            className="px-4 py-2 bg-indigo-500 text-white text-sm font-medium rounded-lg hover:bg-indigo-600 disabled:opacity-40"
          >
            {streaming ? 'Thinking...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
