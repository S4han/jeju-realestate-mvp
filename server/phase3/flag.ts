// Phase 3 region analysis feature flag (P3-NFR-002): on only when the server env says exactly "true".
export const isPhase3Enabled = (env: Record<string, string | undefined> = process.env) => env.PHASE3_REGION_ANALYSIS_ENABLED === "true";
