import type { ContextInfo } from "../../shared/types";

export type ContextLayout = "grid" | "list";

export function filterContexts(contexts: ContextInfo[], query: string): ContextInfo[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return contexts;
  return contexts.filter((context) => [context.name, context.cluster, context.id]
    .some((value) => value.toLocaleLowerCase().includes(needle)));
}

export function retainedContextChoice(contexts: ContextInfo[], current: string): string {
  return contexts.some((context) => context.id === current) ? current : "";
}
