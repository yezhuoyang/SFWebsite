/**
 * Renders Coq documentation comments as readable prose,
 * styled to match the original Software Foundations website.
 *
 * Preserves formatting for indented content (BNF grammars,
 * inference rules, code-like blocks) while reflowing prose paragraphs.
 */

interface AnnotationHighlight {
  selectedText: string;
  note: string;
  id: string;
}

interface Props {
  content: string;
  annotations?: AnnotationHighlight[];
  onAnnotationClick?: (id: string, x: number, y: number) => void;
}

export default function CommentBlock({ content, annotations = [], onAnnotationClick }: Props) {
  let text = content
    .replace(/^\(\*\*\s*/, '')
    .replace(/\s*\*\)\s*$/, '')
    .replace(/^\(\*\s*[#=\-]+\s*\*\)\s*/m, '')
    .trim();

  // Convert [text] to `code` markers
  text = text.replace(/\[([^\]]+)\]/g, '`$1`');
  // Convert _text_ to emphasis
  text = text.replace(/\b_([^_]+)_\b/g, '<em>$1</em>');

  // Split into paragraphs by blank lines
  const paragraphs = text.split(/\n\s*\n/);

  const highlightAnnotations = (node: React.ReactNode): React.ReactNode => {
    if (annotations.length === 0) return node;
    if (typeof node === 'string') {
      let result: React.ReactNode[] = [node];
      for (const ann of annotations) {
        const newResult: React.ReactNode[] = [];
        for (const part of result) {
          if (typeof part !== 'string') { newResult.push(part); continue; }
          const idx = part.indexOf(ann.selectedText);
          if (idx === -1) { newResult.push(part); continue; }
          if (idx > 0) newResult.push(part.slice(0, idx));
          newResult.push(
            <span key={ann.id} className="annotation-underline cursor-pointer"
              title={`Note: ${ann.note}`}
              onClick={(e) => { e.stopPropagation(); onAnnotationClick?.(ann.id, e.clientX, e.clientY); }}>
              {ann.selectedText}
            </span>
          );
          if (idx + ann.selectedText.length < part.length) newResult.push(part.slice(idx + ann.selectedText.length));
        }
        result = newResult;
      }
      return <>{result}</>;
    }
    if (Array.isArray(node)) return node.map((n, i) => <span key={i}>{highlightAnnotations(n)}</span>);
    if (node && typeof node === 'object' && 'props' in (node as any)) {
      const el = node as React.ReactElement;
      if (el.props.children) {
        const newChildren = highlightAnnotations(el.props.children);
        // Clone preserving key
        return { ...el, props: { ...el.props, children: newChildren } };
      }
    }
    return node;
  };

  return (
    <div className="sf-prose">
      {paragraphs.map((p, i) => {
        // Remove the common 4-space Coq doc comment indentation
        const dedented = p.replace(/^    /gm, '');

        // Detect if this paragraph is "formatted" content that needs
        // line breaks preserved (BNF, inference rules, indented code):
        // - Has lines starting with significant whitespace (4+ spaces after dedent)
        // - Has lines with --- or === (inference rule separators)
        // - Has lines with | (BNF alternatives)
        const lines = dedented.split('\n');
        const hasRuleSeparators = lines.some(l => /^[\s]*[-]{3,}/.test(l) || /^[\s]*[=]{3,}/.test(l));
        // BNF: 2+ lines starting with | (not inside prose)
        const hasBNFPipes = lines.filter(l => /^\s*\|/.test(l)).length >= 2;

        // List items — check FIRST to prevent lists from being rendered as blue code
        const reflowed = dedented.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        if (dedented.match(/^\s*-\s/) || reflowed.match(/^\s*-\s/)) {
          const items = dedented.split(/\n\s*-\s/).map(s => s.replace(/^-\s*/, '').replace(/\s+/g, ' ').trim());
          return (
            <ul key={i}>
              {items.filter(Boolean).map((item, j) => (
                <li key={j}>{highlightAnnotations(renderInline(item))}</li>
              ))}
            </ul>
          );
        }

        // Only treat as formatted (blue preformatted) for genuine structural content:
        // - Inference rules (lines with --- or === separators)
        // - BNF grammars (multiple lines starting with |)
        // DO NOT trigger on prose that merely mentions arrows (->, ==>, :=)
        const isFormatted = hasRuleSeparators || hasBNFPipes;

        if (isFormatted) {
          // Preserve line breaks — render as preformatted block
          return (
            <pre key={i} className="sf-prose-pre">
              {lines.map((line, j) => (
                <span key={j}>{highlightAnnotations(renderInline(line))}{j < lines.length - 1 ? '\n' : ''}</span>
              ))}
            </pre>
          );
        }

        if (!reflowed) return null;

        return <p key={i}>{highlightAnnotations(renderInline(reflowed))}</p>;
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`|<em>[^<]+<\/em>)/g);
  return parts.map((part, j) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={j}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('<em>') && part.endsWith('</em>')) {
      return <em key={j}>{part.slice(4, -5)}</em>;
    }
    return <span key={j}>{part}</span>;
  });
}
