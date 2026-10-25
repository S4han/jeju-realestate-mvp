// Phase 2 feature flag (PRD): off unless explicitly "true". Off means every Phase 2 API answers 404
// before touching the database, and the UI hides the analysis tab.
export const isPhase2Enabled = (env: NodeJS.ProcessEnv = process.env) => env.PHASE2_PRICE_ANALYSIS_ENABLED === "true";
