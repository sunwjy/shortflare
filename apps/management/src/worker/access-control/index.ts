import type { User, UserRole } from "../modules/identity";

export type Capability =
  | "view-audit-events"
  | "view-analytics"
  | "manage-links"
  | "delete-links"
  | "manage-reserved-aliases"
  | "manage-users"
  | "view-users";

const capabilitiesByRole: Readonly<Record<UserRole, ReadonlySet<Capability>>> = {
  administrator: new Set([
    "view-audit-events",
    "view-analytics",
    "manage-links",
    "delete-links",
    "manage-reserved-aliases",
    "manage-users",
    "view-users",
  ]),
  member: new Set(["view-analytics", "manage-links"]),
  viewer: new Set(["view-analytics"]),
};

export function hasCapability(user: User, capability: Capability) {
  return capabilitiesByRole[user.role].has(capability);
}
