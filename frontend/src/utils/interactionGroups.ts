/**
 * Account activity grouped by contract interaction (#1041).
 *
 * Consecutive events that hit the same contract form one interaction, so a
 * burst of calls to one contract collapses into a single expandable item. The
 * input order is kept: groups never reorder events, and a contract that is
 * revisited later starts a new group.
 */

export interface InteractionGroup<T extends { contract_id: string }> {
  contractId: string;
  events: T[];
  /** Index of the group's first event in the original list. */
  startIndex: number;
  /** Distinct function names in this group, in first-seen order. */
  functions: string[];
}

export function groupByInteraction<T extends { contract_id: string; function: string }>(
  events: T[],
): InteractionGroup<T>[] {
  const groups: InteractionGroup<T>[] = [];
  events.forEach((ev, index) => {
    const last = groups[groups.length - 1];
    if (last && last.contractId === ev.contract_id) {
      last.events.push(ev);
      if (!last.functions.includes(ev.function)) last.functions.push(ev.function);
      return;
    }
    groups.push({
      contractId: ev.contract_id,
      events: [ev],
      startIndex: index,
      functions: [ev.function],
    });
  });
  return groups;
}
