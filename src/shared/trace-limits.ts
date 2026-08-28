/**
 * Reconciliation intentionally stays below the measured quadratic cost knee.
 * Adapters may page more history, but product identity requires a complete
 * proof and timing set within this shared bound.
 */
export const TRACE_RECONCILIATION_ENTRY_CAP = 500;
export const TRACE_RECONCILIATION_TIMING_CAP = 500;
