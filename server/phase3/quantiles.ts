// Map classes (REGION_ANALYSIS.md 5절): up to 5 quantile classes over the eligible regions of one view.
// Equal values always share a class (ties are never split), so with few distinct values there are fewer
// classes; the legend reports the real min/max and member count of each class.
export type Legend = {
  method: "QUANTILE_TIES_KEPT";
  effectiveClassCount: number;
  eligibleRegionCount: number;
  classes: { index: number; min: number; max: number; count: number }[];
};

export function quantileClasses(values: Map<string, number>, maxClasses = 5): { classOf: Map<string, number>; legend: Legend } {
  const sorted = [...values.values()].sort((a, b) => a - b);
  const n = sorted.length;
  const k = Math.min(maxClasses, new Set(sorted).size);
  // Upper bound (inclusive) of classes 0..k-2 at the quantile positions; duplicates collapse.
  const bounds: number[] = [];
  for (let c = 1; c < k; c++) {
    const v = sorted[Math.ceil((c * n) / k) - 1]!;
    if (v < sorted[n - 1]! && !bounds.includes(v)) bounds.push(v);
  }
  const classOf = new Map<string, number>();
  for (const [id, v] of values) classOf.set(id, bounds.filter((b) => b < v).length);
  const classes = Array.from({ length: n ? bounds.length + 1 : 0 }, (_, index) => {
    const members = [...values.entries()].filter(([id]) => classOf.get(id) === index).map(([, v]) => v);
    return { index, min: Math.min(...members), max: Math.max(...members), count: members.length };
  });
  return { classOf, legend: { method: "QUANTILE_TIES_KEPT", effectiveClassCount: classes.length, eligibleRegionCount: n, classes } };
}
