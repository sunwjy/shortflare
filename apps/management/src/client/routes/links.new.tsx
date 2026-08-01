import { createFileRoute, redirect } from "@tanstack/react-router";

import { CreateLinkPanel } from "../features/links";

export const Route = createFileRoute("/links/new")({
  beforeLoad: ({ context }) => {
    if (context.session.user.role === "viewer") {
      throw redirect({ to: "/links", search: { state: [] } });
    }
  },
  component: CreateLinkPanel,
});
