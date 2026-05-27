export type WorkflowStoreListQueryValue = string | number;

export type WorkflowStoreListQueryPredicate = {
  clause: string;
  value: WorkflowStoreListQueryValue | undefined;
};

export type WorkflowStoreListQuery = {
  where: string;
  values: WorkflowStoreListQueryValue[];
  limit: number;
};

export function buildWorkflowStoreListQuery(
  predicates: readonly WorkflowStoreListQueryPredicate[],
  limit: number | undefined,
): WorkflowStoreListQuery {
  const clauses: string[] = [];
  const values: WorkflowStoreListQueryValue[] = [];

  for (const predicate of predicates) {
    if (predicate.value === undefined) {
      continue;
    }
    clauses.push(predicate.clause);
    values.push(predicate.value);
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    values,
    limit: workflowStoreListLimit(limit),
  };
}

export function workflowStoreListLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(limit ?? 100, 1000));
}
