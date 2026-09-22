import type { ContextInfo } from "../../shared/types";

export type ContextLayout = "grid" | "list";

/** Aliases keyed by context id; matches the shell settings' contextAliases. */
export type ContextAliases = Readonly<Record<string, string>>;

/** Mirrors the shell-side cap (settings.rs MAX_ALIAS_LENGTH). */
export const MAX_CONTEXT_ALIAS_LENGTH = 64;

export function contextAlias(contextId: string, aliases: ContextAliases): string | undefined {
  return Object.hasOwn(aliases, contextId) ? aliases[contextId] : undefined;
}

/** The picker's title for a context: its alias when set, else its own name. */
export function contextDisplayName(context: ContextInfo, aliases: ContextAliases): string {
  return contextAlias(context.id, aliases) || context.name;
}

/**
 * Orders contexts by display name once any alias exists. With no aliases the
 * core's own name order is returned untouched — nothing reshuffles until a
 * user actually renames something.
 */
export function sortContexts(contexts: ContextInfo[], aliases: ContextAliases): ContextInfo[] {
  if (!Object.keys(aliases).length) return contexts;
  return [...contexts].sort((left, right) =>
    contextDisplayName(left, aliases).localeCompare(contextDisplayName(right, aliases)));
}

export function filterContexts(contexts: ContextInfo[], query: string, aliases: ContextAliases = {}): ContextInfo[] {
  const needle = query.trim().toLocaleLowerCase();
  const filtered = needle
    ? contexts.filter((context) => [context.name, context.cluster, context.id, contextAlias(context.id, aliases)]
        .some((value) => Boolean(value?.toLocaleLowerCase().includes(needle))))
    : contexts;
  return sortContexts(filtered, aliases);
}

export function retainedContextChoice(contexts: ContextInfo[], current: string): string {
  return contexts.some((context) => context.id === current) ? current : "";
}
