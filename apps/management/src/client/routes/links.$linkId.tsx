import { createFileRoute } from "@tanstack/react-router";

import { LinkDetailPanel } from "../features/links";

export const Route = createFileRoute("/links/$linkId")({
  component: LinkDetailPanel,
});
