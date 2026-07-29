export { createLinks } from "./links";
export type {
  Actor,
  Alias,
  DestinationVersion,
  DestinationVersionPage,
  Link,
  LinkCommand,
  LinkPage,
  LinkQuery,
  LinkQueryResult,
  LinkResult,
  LinkSummary,
  Links,
  LinkState,
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
