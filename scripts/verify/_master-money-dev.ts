// Runs the money invariant checks (scripts/money-invariants.ts) against the local DEV database
// (.env.development) instead of the test DB. Local only: the script's own live-DB guard still applies.
import './_env';
import '../money-invariants';
