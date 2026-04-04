/**
 * Renders Coq documentation comments as readable prose.
 * Strips (** *) delimiters, converts [code] markup, handles emphasis.
 */

interface Props {
  content: string;
}

export default function CommentBlock({ content }: Props) {
  let text = content
    .replace(/^\(\*\*\s*/, '')
    .replace(/\s*\*\)\s*$/, '')
    .replace(/^\(\*\s*[#=]+\s*\*\)\s*/m, '')
    .trim();

  // Convert [text] to `code` markers
  text = text.replace(/\[([^\]]+)\]/g, '`$1`');
  // Convert _text_ to emphasis
  text = text.replace(/\b_([^_]+)_\b/g, '<em>$1</em>');

  const paragraphs = text.split(/\n\s*\n/);

  return (
    <div className="prose-tutorial py-3">
      {paragraphs.map((p, i) => {
        const trimmed = p.replace(/^\s{4}/gm, '').replace(/^\s+/gm, ' ').trim();
        if (!trimmed) return null;

        // Check if it's a list item
        if (trimmed.match(/^\s*-\s/)) {
          const items = trimmed.split(/\n\s*-\s/).map(s => s.replace(/^-\s*/, '').trim());
          return (
            <ul key={i} className="list-disc list-inside space-y-1 mb-4 ml-2">
              {items.filter(Boolean).map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }

        return (
          <p key={i}>{renderInline(trimmed)}</p>
        );
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode[] {
  // Split on `code` and <em>emphasis</em>
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
