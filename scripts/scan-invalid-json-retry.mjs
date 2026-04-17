/**
 * Previously scanned `turn_engine_native_round` pipeline stages from the removed native tool loop.
 * Classic orchestration does not emit those stages; use other tooling for JSON/retry analysis.
 */
console.log(
  JSON.stringify(
    {
      message:
        'Native tool loop was removed; no turn_engine_native_round stages are emitted. This script is a no-op.',
    },
    null,
    2,
  ),
)
