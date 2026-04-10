/**
 * Collaborative annotation margin — shows annotation cards on the right side
 * of code/comment blocks, connected to highlighted text with lines.
 *
 * Design inspired by collaborative PDF annotation tools:
 * - Colored highlight on text matching the annotator's color
 * - Cards positioned at the same vertical level as the highlight
 * - Avatar circle + username + upvote/downvote + note text
 */

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { vote } from '../api/client';
import type { ServerAnnotation } from '../api/client';

interface AnnotationMarginProps {
  annotations: ServerAnnotation[];
  onDelete?: (id: number) => void;
  onRefresh?: () => void;
}

// Deterministic colors per user
const USER_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#84cc16',
];

function userColor(userId: number): string {
  return USER_COLORS[userId % USER_COLORS.length];
}

export default function AnnotationMargin({ annotations, onDelete, onRefresh }: AnnotationMarginProps) {
  const { user } = useAuth();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (annotations.length === 0) return null;

  const sorted = [...annotations].sort((a, b) => a.start_line - b.start_line || a.start_col - b.start_col);

  return (
    <div className="annotation-margin space-y-2 py-2">
      {sorted.map(ann => (
        <AnnotationCard
          key={ann.id}
          annotation={ann}
          color={ann.color || userColor(ann.user_id)}
          isOwn={user?.id === ann.user_id}
          expanded={expandedId === ann.id}
          onToggle={() => setExpandedId(expandedId === ann.id ? null : ann.id)}
          onDelete={onDelete}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}

/**
 * Floating annotation overlay — positions cards absolutely on the right margin,
 * aligned to the Y position of the block they belong to.
 */
export function AnnotationOverlay({
  annotations,
  blockRefs,
  onDelete,
  onRefresh,
}: {
  annotations: ServerAnnotation[];
  blockRefs: Map<number, HTMLDivElement>;
  onDelete?: (id: number) => void;
  onRefresh?: () => void;
}) {
  const { user } = useAuth();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [positions, setPositions] = useState<Map<number, number>>(new Map());

  // Compute Y positions from block DOM refs
  useEffect(() => {
    const compute = () => {
      const container = document.getElementById('chapter-scroll-container');
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const scrollTop = container.scrollTop;

      const newPos = new Map<number, number>();
      for (const ann of annotations) {
        const blockEl = blockRefs.get(ann.block_id);
        if (blockEl) {
          const blockRect = blockEl.getBoundingClientRect();
          // Position relative to the container's content (accounting for scroll)
          const top = blockRect.top - containerRect.top + scrollTop;
          newPos.set(ann.id, top);
        }
      }
      setPositions(newPos);
    };

    compute();
    // Recompute on scroll and resize
    const container = document.getElementById('chapter-scroll-container');
    const onScroll = () => compute();
    container?.addEventListener('scroll', onScroll);
    window.addEventListener('resize', compute);
    // Also recompute after a delay (for lazy-loaded editors)
    const timer = setTimeout(compute, 2000);
    return () => {
      container?.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', compute);
      clearTimeout(timer);
    };
  }, [annotations, blockRefs]);

  if (annotations.length === 0) return null;

  // Group annotations by block to stack them if multiple per block
  const byBlock = new Map<number, ServerAnnotation[]>();
  for (const ann of annotations) {
    const list = byBlock.get(ann.block_id) || [];
    list.push(ann);
    byBlock.set(ann.block_id, list);
  }

  // Build positioned cards
  const cards: { ann: ServerAnnotation; top: number }[] = [];
  for (const [, anns] of byBlock) {
    const baseTop = positions.get(anns[0]?.id) ?? 0;
    let offset = 0;
    for (const ann of anns) {
      cards.push({ ann, top: baseTop + offset });
      offset += 90; // stack cards vertically within same block
    }
  }

  return (
    <div
      className="absolute top-0 right-0 w-64 pointer-events-none"
      style={{ transform: 'translateX(calc(100% + 12px))' }}
    >
      {cards.map(({ ann, top }) => (
        <DraggableCard
          key={ann.id}
          initialTop={top}
          annotation={ann}
          color={ann.color || userColor(ann.user_id)}
          isOwn={user?.id === ann.user_id}
          expanded={expandedId === ann.id}
          onToggle={() => setExpandedId(expandedId === ann.id ? null : ann.id)}
          onDelete={onDelete}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}

/** Wrapper that makes an annotation card freely draggable */
function DraggableCard(props: {
  initialTop: number;
  annotation: ServerAnnotation;
  color: string;
  isOwn: boolean;
  expanded: boolean;
  onToggle: () => void;
  onDelete?: (id: number) => void;
  onRefresh?: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [, setIsDragging] = useState(false);
  // Store fixed-position coords (only used while dragging or after first drag)
  const fixedPos = useRef<{ x: number; y: number } | null>(null);
  const [, forceUpdate] = useState(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'BUTTON' || tag === 'SPAN') return;
    e.preventDefault();

    // On first drag, convert from absolute (in-container) to fixed (viewport)
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!fixedPos.current) {
      fixedPos.current = { x: rect.left, y: rect.top };
    }

    setIsDragging(true);
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = fixedPos.current.x;
    const origY = fixedPos.current.y;

    const onMove = (ev: MouseEvent) => {
      let newX = origX + ev.clientX - startX;
      let newY = origY + ev.clientY - startY;
      // Clamp: don't let the card go off-screen or behind the right panel
      const rightPanel = document.querySelector('[data-panel="right"]') as HTMLElement;
      const maxX = (rightPanel ? rightPanel.getBoundingClientRect().left : window.innerWidth) - 260;
      newX = Math.max(0, Math.min(newX, maxX));
      newY = Math.max(0, Math.min(newY, window.innerHeight - 50));
      fixedPos.current = { x: newX, y: newY };
      forceUpdate(n => n + 1);
    };
    const onUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Before first drag: render as absolute inside overlay container
  // After first drag: render as fixed (viewport-level, no container constraints)
  const isFixed = fixedPos.current !== null;

  return (
    <div
      ref={cardRef}
      className={`pointer-events-auto ${isFixed ? 'fixed' : 'absolute'}`}
      style={isFixed
        ? { left: fixedPos.current!.x, top: fixedPos.current!.y, width: 256, zIndex: 10000 }
        : { top: props.initialTop, left: 0, width: '100%', zIndex: 10000 }
      }
      onMouseDown={handleMouseDown}
    >
      <div className="cursor-grab active:cursor-grabbing">
        <AnnotationCard
          annotation={props.annotation}
          color={props.color}
          isOwn={props.isOwn}
          expanded={props.expanded}
          onToggle={props.onToggle}
          onDelete={props.onDelete}
          onRefresh={props.onRefresh}
        />
      </div>
    </div>
  );
}

function AnnotationCard({
  annotation: ann,
  color,
  isOwn,
  expanded,
  onToggle,
  onDelete,
  onRefresh,
}: {
  annotation: ServerAnnotation;
  color: string;
  isOwn: boolean;
  expanded: boolean;
  onToggle: () => void;
  onDelete?: (id: number) => void;
  onRefresh?: () => void;
}) {
  const [voting, setVoting] = useState(false);

  const handleVote = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (voting) return;
    setVoting(true);
    try {
      await vote('annotation', ann.id);
      onRefresh?.();
    } catch (err) {
      console.error('Vote failed:', err);
    } finally {
      setVoting(false);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this annotation?')) {
      onDelete?.(ann.id);
    }
  };

  const timeAgo = getTimeAgo(ann.created_at);

  return (
    <div
      className="annotation-card group relative cursor-pointer transition-all duration-150"
      style={{
        borderLeft: `3px solid ${color}`,
        backgroundColor: color + '0d', // 5% opacity
      }}
      onClick={onToggle}
    >
      {/* Header: avatar + name + vote */}
      <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1">
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
          style={{ backgroundColor: color }}
        >
          {(ann.display_name || ann.username).charAt(0).toUpperCase()}
        </div>
        <span className="text-xs font-semibold text-gray-700 truncate">
          {ann.display_name || ann.username}
        </span>

        {/* Upvote */}
        <button
          className={`ml-auto flex items-center gap-0.5 text-[10px] transition-colors ${
            ann.user_voted ? 'text-blue-600 font-bold' : 'text-gray-400 hover:text-blue-500'
          }`}
          onClick={handleVote}
          disabled={voting}
          title="Upvote"
        >
          <span className="text-xs">{ann.user_voted ? '\u25B2' : '\u25B3'}</span>
          {ann.upvotes > 0 && <span>{ann.upvotes}</span>}
        </button>

        {/* Delete (own only) */}
        {isOwn && (
          <button
            className="text-[10px] text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={handleDelete}
            title="Delete"
          >
            &times;
          </button>
        )}
      </div>

      {/* Quoted text */}
      {ann.selected_text && (
        <div className="px-2.5 pb-1">
          <span
            className="text-[10px] font-mono text-gray-400 leading-tight"
            style={{ borderBottom: `2px dashed ${color}`, paddingBottom: 1 }}
          >
            "{ann.selected_text.length > 50 ? ann.selected_text.slice(0, 50) + '...' : ann.selected_text}"
          </span>
        </div>
      )}

      {/* Note text */}
      <div className="px-2.5 pb-2 text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">
        {expanded ? ann.note : (ann.note.length > 80 ? ann.note.slice(0, 80) + '...' : ann.note)}
      </div>

      {/* Time */}
      <div className="px-2.5 pb-1.5 text-[9px] text-gray-300">{timeAgo}</div>
    </div>
  );
}

function getTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

/**
 * Annotation creation popover — draggable, with color picker
 */
export function AnnotationCreatePopover({
  selectedText,
  position,
  onSave,
  onCancel,
}: {
  selectedText: string;
  position: { x: number; y: number };
  onSave: (note: string, color: string, isPublic: boolean) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState('');
  const [color, setColor] = useState('#f59e0b');
  const [isPublic, setIsPublic] = useState(true);
  const posRef = useRef({
    x: Math.min(position.x - 150, window.innerWidth - 340),
    y: Math.min(position.y + 10, window.innerHeight - 350),
  });
  const [, forceUpdate] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const colors = ['#f59e0b', '#ef4444', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899'];

  const handleSave = () => {
    if (!note.trim()) return;
    onSave(note.trim(), color, isPublic);
  };

  return (
    <div
      className="fixed z-50 bg-white rounded-xl shadow-2xl border-2 w-[320px]"
      style={{ left: posRef.current.x, top: posRef.current.y, borderColor: color }}
      onClick={e => e.stopPropagation()}
    >
      {/* Draggable header — large grab area */}
      <div
        className="px-4 pt-3 pb-2 flex items-center justify-between cursor-grab active:cursor-grabbing select-none rounded-t-xl"
        style={{ backgroundColor: color + '18', touchAction: 'none' }}
        onMouseDown={(e) => {
          // Only drag on left mouse button, and not on the close button
          if (e.button !== 0 || (e.target as HTMLElement).tagName === 'BUTTON') return;
          e.preventDefault();
          const startX = e.clientX;
          const startY = e.clientY;
          const origX = posRef.current.x;
          const origY = posRef.current.y;
          const onMove = (ev: MouseEvent) => {
            posRef.current.x = origX + ev.clientX - startX;
            posRef.current.y = origY + ev.clientY - startY;
            forceUpdate(n => n + 1);
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        }}
      >
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color }}>
          Add Note
        </span>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
      </div>

      {/* Quoted text */}
      {selectedText && (
        <div className="px-4 pt-2">
          <div className="text-[11px] font-mono text-gray-400 bg-gray-50 rounded px-2 py-1 truncate"
               style={{ borderLeft: `3px solid ${color}` }}>
            "{selectedText.length > 60 ? selectedText.slice(0, 60) + '...' : selectedText}"
          </div>
        </div>
      )}

      {/* Note input */}
      <div className="px-4 pt-2">
        <textarea
          ref={inputRef}
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Write your note..."
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
          rows={3}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave(); }}
        />
      </div>

      {/* Color picker + visibility */}
      <div className="px-4 pt-2 flex items-center gap-3">
        <div className="flex gap-1.5">
          {colors.map(c => (
            <button
              key={c}
              className={`w-5 h-5 rounded-full transition-all ${color === c ? 'ring-2 ring-offset-1 ring-gray-400 scale-125' : 'hover:scale-110'}`}
              style={{ backgroundColor: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-gray-500 ml-auto cursor-pointer">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={e => setIsPublic(e.target.checked)}
            className="w-3.5 h-3.5 rounded"
          />
          Public
        </label>
      </div>

      {/* Actions */}
      <div className="px-4 py-3 flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!note.trim()}
          className="px-4 py-1.5 text-xs text-white rounded-lg font-medium disabled:opacity-50"
          style={{ backgroundColor: color }}
        >
          Save Note
        </button>
      </div>
    </div>
  );
}
