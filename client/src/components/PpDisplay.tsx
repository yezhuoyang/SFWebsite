/**
 * Renders Coq's PpString pretty-print tree to React elements.
 * Ported from vscoq's pp-display with simplified layout.
 *
 * PpString is a tagged union representing formatted Coq output:
 *   ["Ppcmd_string", "text"]
 *   ["Ppcmd_glue", [...children]]
 *   ["Ppcmd_box", [mode, indent?], child]
 *   ["Ppcmd_tag", tagName, child]
 *   ["Ppcmd_print_break", nspaces, offset]
 *   ["Ppcmd_force_newline"]
 *   ["Ppcmd_empty"]
 *   ["Ppcmd_comment", [...strings]]
 */

export type PpString =
  | ["Ppcmd_empty"]
  | ["Ppcmd_string", string]
  | ["Ppcmd_glue", PpString[]]
  | ["Ppcmd_box", [string, ...number[]], PpString]
  | ["Ppcmd_tag", string, PpString]
  | ["Ppcmd_print_break", number, number]
  | ["Ppcmd_force_newline"]
  | ["Ppcmd_comment", string[]];

// Tag-to-CSS-class mapping based on Coq's semantic tags
const TAG_CLASSES: Record<string, string> = {
  "constr.keyword": "text-[#697f2f] font-semibold",  // SF keyword green
  "constr.evar": "text-purple-600",
  "constr.type": "text-[#034764]",                    // SF inductive teal
  "constr.notation": "text-gray-800",
  "constr.variable": "text-[#660066]",                // SF variable purple
  "constr.reference": "text-[#006600]",               // SF definition green
  "constr.path": "text-[#006600]",
  "module.definition": "text-[#006600]",
  "tactic.keyword": "text-[#697f2f]",
  "tactic.primitive": "text-[#697f2f]",
  "tactic.string": "text-red-700",
};

interface PpProps {
  pp: PpString;
  className?: string;
}

export default function PpDisplay({ pp, className }: PpProps) {
  return (
    <span className={`font-mono text-sm ${className || ""}`}>
      {renderPp(pp)}
    </span>
  );
}

function renderPp(pp: PpString): React.ReactNode {
  if (!pp || !Array.isArray(pp)) return null;

  const tag = pp[0];

  switch (tag) {
    case "Ppcmd_empty":
      return null;

    case "Ppcmd_string":
      return <span>{pp[1]}</span>;

    case "Ppcmd_glue":
      return <>{(pp[1] as PpString[]).map((child, i) => <span key={i}>{renderPp(child)}</span>)}</>;

    case "Ppcmd_box": {
      const mode = (pp[1] as [string, ...number[]])[0];
      const child = pp[2] as PpString;
      // Vertical box: use block display with line breaks
      if (mode === "Pp_vbox") {
        return <span className="inline">{renderPp(child)}</span>;
      }
      // All other boxes: inline
      return <span>{renderPp(child)}</span>;
    }

    case "Ppcmd_tag": {
      const tagName = pp[1] as string;
      const child = pp[2] as PpString;
      const cls = TAG_CLASSES[tagName] || "";
      return <span className={cls}>{renderPp(child)}</span>;
    }

    case "Ppcmd_print_break": {
      const nspaces = pp[1] as number;
      // Render as spaces (simplified — full vscoq does responsive line breaking)
      return <span>{" ".repeat(Math.max(nspaces, 1))}</span>;
    }

    case "Ppcmd_force_newline":
      return <br />;

    case "Ppcmd_comment":
      return <span className="text-gray-400 italic">{(pp[1] as string[]).join(" ")}</span>;

    default:
      return null;
  }
}

/** Flatten PpString to plain text (for Context panel, searching, etc.) */
export function ppToString(pp: PpString): string {
  if (!pp || !Array.isArray(pp)) return "";

  switch (pp[0]) {
    case "Ppcmd_empty": return "";
    case "Ppcmd_string": return pp[1] as string;
    case "Ppcmd_glue": return (pp[1] as PpString[]).map(ppToString).join("");
    case "Ppcmd_box": return ppToString(pp[2] as PpString);
    case "Ppcmd_tag": return ppToString(pp[2] as PpString);
    case "Ppcmd_print_break": return " ".repeat(pp[1] as number || 1);
    case "Ppcmd_force_newline": return "\n";
    case "Ppcmd_comment": return (pp[1] as string[]).join(" ");
    default: return "";
  }
}
