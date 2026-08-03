import { createFactory } from "hono/factory";

import type { ManagementEnvironment } from "../environment";

const managementFactory = createFactory<ManagementEnvironment>();

export const createManagementHono = () => managementFactory.createApp();
