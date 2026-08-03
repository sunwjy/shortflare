import type { AuthenticationFailurePresenter } from "../../../transport/authentication";
import { apiError } from "./presenter";

export const presentAuthenticationFailure: AuthenticationFailurePresenter = (
  context,
  kind,
  status,
) => context.json(apiError(kind), status);
