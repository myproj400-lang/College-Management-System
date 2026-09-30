/**
 * Grading scale: minimum score (inclusive) → letter grade and grade point.
 * Adjust these bands to match the college's official academic regulations.
 */
export const GRADE_SCALE = [
  { min: 70, grade: 'A', point: 4.0 },
  { min: 60, grade: 'B', point: 3.0 },
  { min: 50, grade: 'C', point: 2.0 },
  { min: 45, grade: 'D', point: 1.0 },
  { min: 0, grade: 'F', point: 0.0 },
] as const;

export function gradeFor(score: number): { grade: string; gradePoint: number } {
  const band = GRADE_SCALE.find((b) => score >= b.min) ?? GRADE_SCALE[GRADE_SCALE.length - 1];
  return { grade: band.grade, gradePoint: band.point };
}

/** Credit-weighted GPA over graded courses, rounded to two decimals. */
export function computeGpa(rows: { gradePoint: number | null; creditHours: number }[]): number | null {
  const graded = rows.filter((r) => r.gradePoint !== null);
  const credits = graded.reduce((sum, r) => sum + r.creditHours, 0);
  if (credits === 0) return null;
  const points = graded.reduce((sum, r) => sum + (r.gradePoint as number) * r.creditHours, 0);
  return Math.round((points / credits) * 100) / 100;
}
