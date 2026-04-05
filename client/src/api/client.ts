import type { Volume, Chapter, Exercise, CoqSession, CoqStepResult } from '../types';

const BASE = '/api';

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
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

export interface SaveResult {
  status: string;
  graded: boolean;
  completed: number;
  total: number;
  exercises: { name: string; status: string; points: number }[];
}

export const saveChapterFile = (volumeId: string, chapterName: string, content: string) =>
  fetchJSON<SaveResult>(`${BASE}/coq/file/${volumeId}/${chapterName}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });

export const resetChapterFile = (volumeId: string, chapterName: string) =>
  fetchJSON<{ status: string }>(`${BASE}/coq/file/${volumeId}/${chapterName}/reset`, {
    method: 'POST',
  });

export interface ExplainRequest {
  volume_id: string;
  chapter_name: string;
  exercise_name: string | null;
  student_code: string;
  proof_state_text: string;
  diagnostics_text: string;
  processed_lines: number | null;
  message: string;
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

// Grading
export const gradeChapter = (volumeId: string, chapterName: string) =>
  fetchJSON<any>(`${BASE}/grade/${volumeId}/${chapterName}`, { method: 'POST' });

export const quickGradeChapter = (volumeId: string, chapterName: string) =>
  fetchJSON<any>(`${BASE}/grade/${volumeId}/${chapterName}/quick`, { method: 'POST' });
