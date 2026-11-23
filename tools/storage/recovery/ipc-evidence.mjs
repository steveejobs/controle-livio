// Advanced Node IPC supports BigInt and Date. JSON conversion belongs only in
// the report writer, after all native snapshot comparisons have completed.
export function recoveryEvidence(results, snapshot) {
  return { pid: process.pid, results, snapshot };
}
