/**
 * Reserved action verbs per resource.
 *
 * Under the API v1 convention (`docs/conventions.md` §2.3), custom
 * actions live as sub-resource paths — `POST /v1/skills/generate`,
 * `POST /v1/skills/validate`, etc. Router configs give these static
 * segments priority over `:id` captures, which means a resource named
 * the same as a reserved verb becomes unreachable via its canonical
 * read endpoint.
 *
 * To prevent silently losing access to data, create-time validation
 * rejects names matching this list. Any migration of existing rows with
 * colliding names ships separately (see issue #69).
 *
 * @module shared/reservedVerbs
 */

export const RESERVED_VERBS = {
  skill: ["format", "validate", "search", "counts", "generate", "lookup"],
  category: [] as string[],
  tag: [] as string[],
} as const satisfies Record<string, readonly string[]>;

export type ReservedResource = keyof typeof RESERVED_VERBS;

export function isReservedVerb(resource: ReservedResource, name: string): boolean {
  return (RESERVED_VERBS[resource] as readonly string[]).includes(name);
}
