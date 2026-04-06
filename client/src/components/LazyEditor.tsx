/**
 * LazyEditor — only mounts Monaco when the block is near the viewport.
 * Uses IntersectionObserver with a large rootMargin to pre-load editors
 * before they scroll into view. Shows a static <pre> placeholder until then.
 */

import { useState, useRef, useEffect } from 'react';
import Editor, { type OnMount, type BeforeMount } from '@monaco-editor/react';

interface Props {
  blockId: number;
  defaultValue: string;
  language: string;
  theme: string;
  beforeMount: BeforeMount;
  onMount: OnMount;
  options: any;
}

export default function LazyEditor({ blockId: _blockId, defaultValue, language, theme, beforeMount, onMount, options }: Props) {
  void _blockId;
  const [visible, setVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect(); // Once mounted, never unmount
        }
      },
      { rootMargin: '600px 0px' } // Pre-load 600px before visible
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!visible) {
    // Lightweight placeholder — just shows the code as static text
    const lineCount = defaultValue.split('\n').length;
    return (
      <div ref={containerRef} style={{ minHeight: Math.max(lineCount * 20, 36) }}>
        <pre className="text-[13px] font-mono text-gray-500 leading-[20px] px-2 py-1 overflow-hidden whitespace-pre-wrap"
          style={{ fontFamily: "'JetBrains Mono', 'Courier New', monospace" }}>
          {defaultValue.length > 500 ? defaultValue.slice(0, 500) + '...' : defaultValue}
        </pre>
      </div>
    );
  }

  return (
    <div ref={containerRef}>
      <Editor
        height="auto"
        language={language}
        theme={theme}
        defaultValue={defaultValue}
        beforeMount={beforeMount}
        onMount={onMount}
        options={options}
      />
    </div>
  );
}
