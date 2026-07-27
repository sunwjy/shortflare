import type { User, UserRole } from "./identity";

export type Capability =
  | "manage-links"
  | "delete-links"
  | "manage-reserved-aliases"
  | "manage-users"
  | "view-users";

const capabilitiesByRole: Readonly<Record<UserRole, ReadonlySet<Capability>>> = {
  administrator: new Set([
    "manage-links",
    "delete-links",
    "manage-reserved-aliases",
    "manage-users",
    "view-users",
  ]),
  member: new Set(["manage-links"]),
  viewer: new Set(),
};

export function hasCapability(user: User, capability: Capability) {
  return capabilitiesByRole[user.role].has(capability);
}
