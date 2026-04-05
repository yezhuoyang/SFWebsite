export interface Volume {
  id: string;
  name: string;
  namespace: string;
  chapter_count: number;
  exercise_count: number;
  total_points_standard: number;
  total_points_advanced: number;
  completed_count: number;
  total_points_earned: number;
}

export interface Chapter {
  id: number;
  volume_id: string;
  name: string;
  display_order: number;
  exercise_count: number;
  max_points_standard: number;
  max_points_advanced: number;
  has_test_file: boolean;
  completed_count: number;
  total_points_earned: number;
  summary: string;
  line_count: number;
}

export interface Exercise {
  id: number;
  name: string;
  stars: number;
  difficulty: string;
  modifier: string | null;
  is_manual: boolean;
  points: number | null;
  line_start: number;
  line_end: number | null;
  status: string;
  points_earned: number;
}

export interface CoqGoal {
  hypotheses: string[];
  conclusion: string;
}

export interface CoqStepResult {
  sid: number;
  goals: CoqGoal[] | null;
  error: string | null;
}

export interface CoqSession {
  session_id: string;
  volume_id: string;
  status: string;
}
