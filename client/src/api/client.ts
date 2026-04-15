import type { Volume, Chapter, Exercise, CoqSession, CoqStepResult } from '../types';
import { getAuthToken } from '../contexts/AuthContext';

const BASE = '/api';

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const merged: RequestInit = {
    ...init,
    headers: authHeaders(init?.headers as Record<string, string> | undefined),
  };
  const res = await fetch(url, merged);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

// Volumes
export const getVolumes = () => fetchJSON<Volume[]>(`${BASE}/volumes`);
export const getChapters = (volumeId: string) =>
  fetchJSON<Chapter[]>(`${BASE}/volumes/${volumeId}/chapters`);
export const getExercises = (volumeId: string, chapterName: string) =>
  fetchJSON<Exercise[]>(`${BASE}/chapters/${volumeId}/${chapterName}/exercises`);

// Coq interactive sessions
export const createCoqSession = (volumeId: string, chapterName?: string) =>
  fetchJSON<CoqSession>(`${BASE}/coq/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ volume_id: volumeId, chapter_name: chapterName }),
  });

export const getSessionInfo = (sessionId: string) =>
  fetchJSON<{ active_count: number; max_sessions: number; remaining_seconds: number; timeout_seconds: number }>(
    `${BASE}/coq/session/${sessionId}/info`
  );

export const coqStep = (sessionId: string, code: string) =>
  fetchJSON<CoqStepResult>(`${BASE}/coq/step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, code }),
  });

export const coqExecTo = (sessionId: string, code: string) =>
  fetchJSON<CoqStepResult>(`${BASE}/coq/exec-to`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, code }),
  });

export const coqCancel = (sessionId: string, sid: number) =>
  fetchJSON<CoqStepResult>(`${BASE}/coq/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, sid }),
  });

export const closeCoqSession = (sessionId: string) =>
  fetch(`${BASE}/coq/session/${sessionId}`, { method: 'DELETE' });

export const getCoqGoals = (sessionId: string) =>
  fetchJSON<CoqStepResult>(`${BASE}/coq/session/${sessionId}/goals`);

// File operations
export const getChapterFile = (volumeId: string, chapterName: string) =>
  fetchJSON<{ content: string; filename: string }>(`${BASE}/coq/file/${volumeId}/${chapterName}`);

export interface ExerciseGrade {
  name: string;
  status: 'completed' | 'not_started' | 'compile_error' | 'tampered';
  points: number;
  feedback?: string;
  error_detail?: string | null;
}

export interface SaveResult {
  status: string;
  graded: boolean;
  completed: number;
  total: number;
  exercises: ExerciseGrade[];
  compile_output?: string | null;
}

export const saveChapterFile = (
  volumeId: string,
  chapterName: string,
  content: string,
  targetExercise?: string,
) =>
  fetchJSON<SaveResult>(`${BASE}/coq/file/${volumeId}/${chapterName}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      targetExercise
        ? { content, target_exercise: targetExercise }
        : { content }
    ),
  });

export const resetChapterFile = (volumeId: string, chapterName: string) =>
  fetchJSON<{ status: string }>(`${BASE}/coq/file/${volumeId}/${chapterName}/reset`, {
    method: 'POST',
  });

export interface TutorContextEntry {
  kind: string;
  name: string;
  signature: string;
  line: number;
}

export interface TutorActivityEntry {
  severity: 'Error' | 'Warning' | 'Information';
  text: string;
  sentence_preview?: string;
  line?: number;
  kind?: 'message' | 'synthetic';
}

export interface ExplainRequest {
  volume_id: string;
  chapter_name: string;
  exercise_name: string | null;
  student_code: string;
  proof_state_text: string;
  diagnostics_text: string;
  processed_lines: number | null;
  message: string;
  /** Definitions / theorems currently in scope (Context panel). */
  context_entries?: TutorContextEntry[];
  /** Recent Coq output events (Activity Log). */
  activity_log?: TutorActivityEntry[];
}

export const explainOutput = (req: ExplainRequest) =>
  fetchJSON<{ explanation: string }>(`${BASE}/tutor/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

// Solutions
export interface SolutionData {
  exercise_name: string;
  solution: string;
  explanation: string;
}

export const getExerciseSolution = (volumeId: string, chapterName: string, exerciseName: string) =>
  fetchJSON<SolutionData>(`${BASE}/coq/solution/${volumeId}/${chapterName}/${exerciseName}`);

// Block-based chapter view
export interface BlockData {
  id: number;
  kind: 'section_header' | 'subsection_header' | 'comment' | 'code' | 'exercise';
  content: string;
  line_start: number;
  line_end: number;
  title: string | null;
  exercise_name: string | null;
  exercise_stars: number | null;
  exercise_difficulty: string | null;
  exercise_modifier: string | null;
  editable: boolean;
}

export interface TocEntry {
  block_id: number;
  level: number;
  title: string;
}

export interface ChapterBlocksResponse {
  filename: string;
  blocks: BlockData[];
  toc: TocEntry[];
}

export const getChapterBlocks = (volumeId: string, chapterName: string) =>
  fetchJSON<ChapterBlocksResponse>(`${BASE}/coq/blocks/${volumeId}/${chapterName}`);

// --- Imports catalog (definitions/theorems available from `Require Import`) ---

export interface ImportedEntry {
  kind: string;            // "Definition" | "Theorem" | "Lemma" | "Inductive" | ...
  name: string;
  signature: string;       // first-line signature for hover
  module: string;          // e.g. "PLF.Maps" or "Coq.Bool.Bool"
  chapter_name: string | null;  // set if from a SF chapter (so UI can link)
  import_line: number;     // 0-indexed line where its `Require Import` lives;
                            // client uses this to gate visibility on what's
                            // actually been executed.
}

export const getChapterImports = (volumeId: string, chapterName: string) =>
  fetchJSON<{ entries: ImportedEntry[] }>(`${BASE}/coq/imports/${volumeId}/${chapterName}`);

// Grading
export const gradeChapter = (volumeId: string, chapterName: string) =>
  fetchJSON<any>(`${BASE}/grade/${volumeId}/${chapterName}`, { method: 'POST' });

export const quickGradeChapter = (volumeId: string, chapterName: string) =>
  fetchJSON<any>(`${BASE}/grade/${volumeId}/${chapterName}/quick`, { method: 'POST' });

// --- Discussions ---

export interface DiscussionSummary {
  id: number;
  user_id: number;
  username: string;
  display_name: string;
  volume_id: string;
  chapter_name: string;
  exercise_name: string | null;
  title: string;
  content: string;
  code_snippet: string | null;
  upvotes: number;
  reply_count: number;
  created_at: string;
  user_voted: boolean;
}

export interface DiscussionReply {
  id: number;
  user_id: number;
  username: string;
  display_name: string;
  content: string;
  upvotes: number;
  created_at: string;
  user_voted: boolean;
}

export const getDiscussions = (params: { volume_id?: string; chapter_name?: string; exercise_name?: string }) => {
  const qs = new URLSearchParams();
  if (params.volume_id) qs.set('volume_id', params.volume_id);
  if (params.chapter_name) qs.set('chapter_name', params.chapter_name);
  if (params.exercise_name) qs.set('exercise_name', params.exercise_name);
  return fetchJSON<DiscussionSummary[]>(`${BASE}/discussions?${qs}`);
};

export const getDiscussion = (id: number) =>
  fetchJSON<{ discussion: DiscussionSummary; replies: DiscussionReply[] }>(`${BASE}/discussions/${id}`);

export const createDiscussion = (data: {
  volume_id: string; chapter_name: string; exercise_name?: string;
  title: string; content: string; code_snippet?: string;
}) =>
  fetchJSON<DiscussionSummary>(`${BASE}/discussions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

export const replyToDiscussion = (discussionId: number, content: string) =>
  fetchJSON<DiscussionReply>(`${BASE}/discussions/${discussionId}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });

export const vote = (targetType: string, targetId: number) =>
  fetchJSON<{ upvotes: number; voted: boolean }>(`${BASE}/votes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_type: targetType, target_id: targetId }),
  });

// --- Shared Solutions (LeetCode-style, multi-submission with comments) ---

export interface SharedSolutionSummary {
  id: number;
  user_id: number;
  username: string;
  display_name: string;
  exercise_id: number;
  exercise_name: string;
  code: string;
  explanation: string | null;
  upvotes: number;
  comment_count: number;
  created_at: string;
  user_voted: boolean;
}

export interface SolutionComment {
  id: number;
  solution_id: number;
  user_id: number;
  username: string;
  display_name: string;
  content: string;
  created_at: string;
}

export type SolutionSort = 'upvotes' | 'newest' | 'oldest';

export const getSharedSolutions = (exerciseId: number, sort: SolutionSort = 'upvotes') =>
  fetchJSON<SharedSolutionSummary[]>(`${BASE}/solutions/shared?exercise_id=${exerciseId}&sort=${sort}`);

export const getMySolutions = (exerciseId: number) =>
  fetchJSON<SharedSolutionSummary[]>(`${BASE}/solutions/mine?exercise_id=${exerciseId}`);

export const getSolutionDetail = (solutionId: number) =>
  fetchJSON<{ solution: SharedSolutionSummary; comments: SolutionComment[] }>(
    `${BASE}/solutions/shared/${solutionId}`
  );

export const shareSolution = (data: { exercise_id: number; code: string; explanation?: string }) =>
  fetchJSON<SharedSolutionSummary>(`${BASE}/solutions/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

export const addSolutionComment = (solutionId: number, content: string) =>
  fetchJSON<SolutionComment>(`${BASE}/solutions/shared/${solutionId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });

export const deleteSharedSolution = (solutionId: number) =>
  fetch(`${BASE}/solutions/shared/${solutionId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });

// --- Leaderboard ---

export interface LeaderboardEntry {
  rank: number;
  user_id: number;
  username: string;
  display_name: string;
  exercises_completed: number;
  total_points: number;
  current_streak: number;
}

export const getLeaderboard = (sort: string = 'points', limit: number = 50) =>
  fetchJSON<LeaderboardEntry[]>(`${BASE}/leaderboard?sort=${sort}&limit=${limit}`);

export const getMyRank = () =>
  fetchJSON<LeaderboardEntry>(`${BASE}/leaderboard/me`);

export const getVolumeLeaderboard = (volumeId: string, limit: number = 20) =>
  fetchJSON<LeaderboardEntry[]>(`${BASE}/leaderboard/volume/${volumeId}?limit=${limit}`);

export const getChapterLeaderboard = (volumeId: string, chapterName: string, limit: number = 20) =>
  fetchJSON<LeaderboardEntry[]>(`${BASE}/leaderboard/chapter/${volumeId}/${encodeURIComponent(chapterName)}?limit=${limit}`);

// --- Live Presence ---

export interface PresenceUser {
  user_id: number;
  username: string;
  display_name: string;
  color: string;
}

export const sendPresenceHeartbeat = (volumeId: string, chapterName: string) =>
  fetchJSON<{ users: PresenceUser[] }>(`${BASE}/presence/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ volume_id: volumeId, chapter_name: chapterName }),
  });

export const getPresence = (volumeId: string, chapterName: string) =>
  fetchJSON<{ users: PresenceUser[] }>(`${BASE}/presence?volume_id=${volumeId}&chapter_name=${chapterName}`);

// --- Server-side Annotations ---

export interface ServerAnnotation {
  id: number;
  user_id: number;
  username: string;
  display_name: string;
  volume_id: string;
  chapter_name: string;
  block_id: number;
  selected_text: string;
  note: string;
  color: string;
  start_line: number;
  start_col: number;
  end_line: number;
  end_col: number;
  is_public: boolean;
  upvotes: number;
  user_voted: boolean;
  created_at: string;
}

export const getPublicAnnotations = (volumeId: string, chapterName: string) =>
  fetchJSON<ServerAnnotation[]>(`${BASE}/annotations?volume_id=${volumeId}&chapter_name=${chapterName}&public=true`);

export const getMyAnnotations = (volumeId: string, chapterName: string) =>
  fetchJSON<ServerAnnotation[]>(`${BASE}/annotations/mine?volume_id=${volumeId}&chapter_name=${chapterName}`);

export const createAnnotation = (data: {
  volume_id: string; chapter_name: string; block_id: number;
  selected_text: string; note: string; color: string;
  start_line: number; start_col: number; end_line: number; end_col: number;
  is_public: boolean;
}) =>
  fetchJSON<ServerAnnotation>(`${BASE}/annotations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

export const deleteAnnotation = (id: number) =>
  fetch(`${BASE}/annotations/${id}`, { method: 'DELETE', headers: authHeaders() });
