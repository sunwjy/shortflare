export { createInMemoryLinksPersistence } from "./in-memory-persistence";
export { createLinks } from "./links";
export type {
  Actor,
  Alias,
  CreateLinksOptions,
  DestinationVersion,
  DestinationVersionPage,
  Link,
  LinkCommand,
  LinkMutationContext,
  LinkPage,
  LinkQuery,
  LinkQueryResult,
  LinkResult,
  LinkSummary,
  Links,
  LinksPersistence,
  LinkState,
  PersistedLinkMutation,
  RedirectDecision,
  ReservedAlias,
  ReservedAliasPage,
} from "./types";
export {
  encodeDestinationVersionCursor,
  encodeListCursor,
  encodeReservedAliasCursor,
  foldCase,
  mergeQuery as mergeDestinationQuery,
  parseAlias,
} from "./values";
