/**
 * Built-in Software Foundations volume list.
 *
 * Used as a fallback whenever the FastAPI server isn't reachable (e.g.
 * Phase 0 dev environment without `uvicorn server.main:app` running),
 * so navigation and the chapter iframe still work for everyone.
 */
import type { Volume } from '../types';

export const STATIC_VOLUMES: Volume[] = [
  { id: 'lf',  name: 'Logical Foundations',                namespace: 'LF',  chapter_count: 24, exercise_count: 0, total_points_standard: 0, total_points_advanced: 0, completed_count: 0, total_points_earned: 0 },
  { id: 'plf', name: 'Programming Language Foundations',   namespace: 'PLF', chapter_count: 26, exercise_count: 0, total_points_standard: 0, total_points_advanced: 0, completed_count: 0, total_points_earned: 0 },
  { id: 'vfa', name: 'Verified Functional Algorithms',     namespace: 'VFA', chapter_count: 21, exercise_count: 0, total_points_standard: 0, total_points_advanced: 0, completed_count: 0, total_points_earned: 0 },
  { id: 'slf', name: 'Separation Logic Foundations',       namespace: 'SLF', chapter_count: 25, exercise_count: 0, total_points_standard: 0, total_points_advanced: 0, completed_count: 0, total_points_earned: 0 },
];
