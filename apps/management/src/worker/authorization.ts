import type { User, UserRole } from "./identity";

export type Capability = "create-link" | "manage-users" | "view-users";

const capabilitiesByRole: Readonly<Record<UserRole, ReadonlySet<Capability>>> = {
  administrator: new Set(["create-link", "manage-users", "view-users"]),
  member: new Set(["create-link"]),
  viewer: new Set(),
};

export function hasCapability(user: User, capability: Capability) {
  return capabilitiesByRole[user.role].has(capability);
}
