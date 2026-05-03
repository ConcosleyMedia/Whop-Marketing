// Per-run cap on how many new enrollments a single cadence may produce.
//
// Used by the hourly orchestrator to stage large reactivation pushes over
// many runs (e.g. enroll 178 of 14k Free silent users per hour rather than
// blasting all 14k at once). Pure function; the caller supplies an already
// ordered candidate list.
//
// `cap === null | undefined` preserves the historical "no limit" behavior.
// Negative caps clamp to 0 defensively.

export function applyEnrollmentCap<T>(
  candidates: T[],
  cap: number | null | undefined,
): T[] {
  if (cap === null || cap === undefined) return candidates;
  if (cap <= 0) return [];
  return candidates.slice(0, cap);
}
