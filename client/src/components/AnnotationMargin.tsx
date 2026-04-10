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
 * Floating annotation overlay — renders cards in document space (absolutely
 * positioned inside the scrollable container at the Y of their annotated block).
 * Cards scroll WITH the page so they stay next to the relevant paragraph.
 * Drag detaches a card to a custom in-document position.
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
  // Per-annotation document position (Y offset within scroll container).
  // Computed once per annotation from block position, then frozen.
  const positionsRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const [, forceRender] = useState(0);

  useEffect(() => {
    const computeInitialPositions = () => {
      const container = document.getElementById('chapter-scroll-container');
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const scrollTop = container.scrollTop;
      let changed = false;

      // Group by block to stack cards within the same block
      const byBlock = new Map<number, ServerAnnotation[]>();
      for (const ann of annotations) {
        const list = byBlock.get(ann.block_id) || [];
        list.push(ann);
        byBlock.set(ann.block_id, list);
      }

      for (const [blockId, anns] of byBlock) {
        const blockEl = blockRefs.get(blockId);
        if (!blockEl) continue;
        // Document Y position relative to scroll container content
        const blockRect = blockEl.getBoundingClientRect();
        const docY = blockRect.top - containerRect.top + scrollTop;
        let offset = 0;
        for (const ann of anns) {
          if (!positionsRef.current.has(ann.id)) {
            positionsRef.current.set(ann.id, { x: 0, y: docY + offset });
            changed = true;
          }
          offset += 90;
        }
      }

      // Drop positions for annotations that no longer exist
      const currentIds = new Set(annotations.map(a => a.id));
      for (const id of [...positionsRef.current.keys()]) {
        if (!currentIds.has(id)) {
          positionsRef.current.delete(id);
          changed = true;
        }
      }
      if (changed) forceRender(n => n + 1);
    };

    computeInitialPositions();
    // Retry after lazy editors mount, so block positions are accurate
    const timer = setTimeout(computeInitialPositions, 800);
    return () => clearTimeout(timer);
  }, [annotations, blockRefs]);

  if (annotations.length === 0) return null;

  return (
    <div
      className="absolute top-0 right-0 w-64 pointer-events-none"
      style={{ transform: 'translateX(calc(100% + 12px))' }}
    >
      {annotations.map(ann => {
        const pos = positionsRef.current.get(ann.id);
        if (!pos) return null;
        return (
          <DraggableCard
            key={ann.id}
            initialPos={pos}
            annotation={ann}
            color={ann.color || userColor(ann.user_id)}
            isOwn={user?.id === ann.user_id}
            expanded={expandedId === ann.id}
            onToggle={() => setExpandedId(expandedId === ann.id ? null : ann.id)}
            onDelete={onDelete}
            onRefresh={onRefresh}
          />
        );
      })}
    </div>
  );
}

/**
 * Wrapper that makes an annotation card freely draggable.
 * Rendered as position:absolute INSIDE the overlay container (which lives in
 * the scrollable content area), so cards scroll WITH the content and stay
 * next to the paragraph they annotate. Drag updates the in-document position.
 */
function DraggableCard(props: {
  initialPos: { x: number; y: number };
  annotation: ServerAnnotation;
  color: string;
  isOwn: boolean;
  expanded: boolean;
  onToggle: () => void;
  onDelete?: (id: number) => void;
  onRefresh?: () => void;
}) {
  // Position in document coordinates (inside the scroll container).
  // Stored in ref so it survives re-renders and is only changed by drag.
  const posRef = useRef({ x: props.initialPos.x, y: props.initialPos.y });
  const [, forceUpdate] = useState(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'BUTTON' || tag === 'SPAN') return;
    e.preventDefault();

    const startX = e.clientX;
    const startY = e.clientY;
    const origX = posRef.current.x;
    const origY = posRef.current.y;

    const onMove = (ev: MouseEvent) => {
      // Drag delta in viewport pixels translates 1:1 to document coords
      // (the overlay container scrolls with the content, so no scroll math needed)
      posRef.current = {
        x: origX + ev.clientX - startX,
        y: origY + ev.clientY - startY,
      };
      forceUpdate(n => n + 1);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div
      className="absolute pointer-events-auto cursor-grab active:cursor-grabbing"
      style={{
        left: posRef.current.x,
        top: posRef.current.y,
        width: 256,
        zIndex: 50,
      }}
      onMouseDown={handleMouseDown}
    >
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
