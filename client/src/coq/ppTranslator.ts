/**
 * Translates between jsCoq's Pp format and our UI's PpString format.
 * Also translates jsCoq goal structures to our ProofViewNotification format.
 *
 * The formats are structurally identical — just a prefix rename:
 *   jsCoq:   Pp_string, Pp_glue, Pp_box, Pp_tag, ...
 *   vscoqtop: Ppcmd_string, Ppcmd_glue, Ppcmd_box, Ppcmd_tag, ...
 */

import type { Pp, JsCoqGoals, JsCoqGoal, CoqHyp } from './CoqWorkerWrapper';
import type { PpString } from '../components/PpDisplay';
import type {
  ProofViewNotification,
  ProofViewGoals,
  VscoqGoal,
  RocqMessage,
  MessageSeverity,
} from '../api/coqWebSocket';

// --- Pp -> PpString Translation ---

const PP_TAG_MAP: Record<string, string> = {
  'Pp_empty':       'Ppcmd_empty',
  'Pp_string':      'Ppcmd_string',
  'Pp_glue':        'Ppcmd_glue',
  'Pp_box':         'Ppcmd_box',
  'Pp_tag':         'Ppcmd_tag',
  'Pp_print_break': 'Ppcmd_print_break',
  'Pp_force_newline': 'Ppcmd_force_newline',
  'Pp_comment':     'Ppcmd_comment',
};

/**
 * Recursively rename Pp_* tags to Ppcmd_* tags.
 */
export function ppToPpString(pp: Pp): PpString {
  if (!Array.isArray(pp) || pp.length === 0) return ['Ppcmd_empty'];

  const tag = pp[0] as string;
  const mappedTag = PP_TAG_MAP[tag];
  if (!mappedTag) {
    // Unknown tag — wrap as string for safety
    console.warn('[ppTranslator] Unknown Pp tag:', tag);
    return ['Ppcmd_string', String(pp)];
  }

  switch (tag) {
    case 'Pp_empty':
      return ['Ppcmd_empty'];

    case 'Pp_string':
      return ['Ppcmd_string', pp[1] as string];

    case 'Pp_glue':
      return ['Ppcmd_glue', (pp[1] as Pp[]).map(ppToPpString)];

    case 'Pp_box':
      return ['Ppcmd_box', pp[1] as [string, ...number[]], ppToPpString(pp[2] as Pp)];

    case 'Pp_tag':
      return ['Ppcmd_tag', pp[1] as string, ppToPpString(pp[2] as Pp)];

    case 'Pp_print_break':
      return ['Ppcmd_print_break', pp[1] as number, pp[2] as number];

    case 'Pp_force_newline':
      return ['Ppcmd_force_newline'];

    case 'Pp_comment':
      return ['Ppcmd_comment', pp[1] as string[]];

    default:
      return ['Ppcmd_empty'];
  }
}

/**
 * Convert Pp to plain text (for diagnostic messages).
 */
export function ppToText(pp: Pp): string {
  if (!Array.isArray(pp) || pp.length === 0) return '';

  const tag = pp[0] as string;
  switch (tag) {
    case 'Pp_empty':
      return '';
    case 'Pp_string':
      return pp[1] as string;
    case 'Pp_glue':
      return (pp[1] as Pp[]).map(ppToText).join('');
    case 'Pp_box':
      return ppToText(pp[2] as Pp);
    case 'Pp_tag':
      return ppToText(pp[2] as Pp);
    case 'Pp_print_break':
      return ' '.repeat(pp[1] as number);
    case 'Pp_force_newline':
      return '\n';
    case 'Pp_comment':
      return (pp[1] as string[]).join(' ');
    default:
      return '';
  }
}

// --- Goal Translation ---

/**
 * Translate a single jsCoq hypothesis [names, def, type] to a PpString.
 *
 * vscoqtop format: each hypothesis is a single PpString that renders like:
 *   "x, y : nat"  or  "x := 5 : nat"
 */
function hypToPpString(hyp: CoqHyp): PpString {
  const [names, def, type] = hyp;

  // Build "name1, name2"
  const nameParts: PpString[] = [];
  for (let i = 0; i < names.length; i++) {
    if (i > 0) {
      nameParts.push(['Ppcmd_string', ', ']);
    }
    // names[i] is ["Id", "name_string"]
    const nameStr = Array.isArray(names[i]) ? names[i][1] : String(names[i]);
    nameParts.push(['Ppcmd_tag', 'constr.variable', ['Ppcmd_string', nameStr]]);
  }

  const parts: PpString[] = [...nameParts];

  if (def) {
    // "name := def : type"
    parts.push(['Ppcmd_string', ' := ']);
    parts.push(ppToPpString(def));
  }

  parts.push(['Ppcmd_string', ' : ']);
  parts.push(ppToPpString(type));

  return ['Ppcmd_glue', parts];
}

/**
 * Translate a jsCoq goal to our VscoqGoal format.
 */
function goalToVscoqGoal(goal: JsCoqGoal, id: number): VscoqGoal {
  return {
    id,
    name: null,
    goal: ppToPpString(goal.ty),
    // jsCoq hypotheses are in reverse order (innermost first); reverse to match vscoqtop
    hypotheses: goal.hyp.slice().reverse().map(h => hypToPpString(h)),
  };
}

/**
 * Translate jsCoq goals to our ProofViewGoals format.
 */
export function translateGoals(goals: JsCoqGoals | null): ProofViewGoals | null {
  if (!goals) return null;

  let goalId = 1;

  // Main goals
  const mainGoals = goals.goals.map(g => goalToVscoqGoal(g, goalId++));

  // Shelved goals
  const shelvedGoals = goals.shelf.map(g => goalToVscoqGoal(g, goalId++));

  // Given up goals
  const givenUpGoals = goals.given_up.map(g => goalToVscoqGoal(g, goalId++));

  // Unfocused goals: stack is [[bg_before, bg_after], ...] pairs
  const unfocusedGoals: VscoqGoal[] = [];
  if (goals.stack) {
    for (const [before, after] of goals.stack) {
      for (const g of [...before, ...after]) {
        unfocusedGoals.push(goalToVscoqGoal(g, goalId++));
      }
    }
  }

  return {
    goals: mainGoals,
    shelvedGoals,
    givenUpGoals,
    unfocusedGoals,
  };
}

/**
 * Build a ProofViewNotification from goals and accumulated messages.
 */
export function buildProofView(
  goals: JsCoqGoals | null,
  messages: RocqMessage[],
): ProofViewNotification {
  return {
    proof: translateGoals(goals),
    messages,
  };
}

/**
 * Map jsCoq message level strings to our MessageSeverity.
 */
export function levelToSeverity(level: string): MessageSeverity {
  switch (level) {
    case 'Error': return 'Error';
    case 'Warning': return 'Warning';
    default: return 'Information';
  }
}
