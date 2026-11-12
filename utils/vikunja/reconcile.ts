export type CompletionAction = "none" | "toPapillon" | "toVikunja";

/**
 * Three-way merge of a homework's "done" state between Papillon and its
 * Vikunja task. `lastSynced` is the state both sides agreed on last time
 * (undefined when never synced). Vikunja is the source of truth: when both
 * sides changed, or nothing is known, Vikunja wins.
 */
export function reconcileCompletion(
  papillonDone: boolean,
  vikunjaDone: boolean,
  lastSynced: boolean | undefined
): CompletionAction {
  if (papillonDone === vikunjaDone) {return "none";}
  if (lastSynced !== undefined && vikunjaDone === lastSynced) {
    // Only Papillon moved (e.g. checked offline, mirror failed): push it.
    return "toVikunja";
  }
  return "toPapillon";
}
