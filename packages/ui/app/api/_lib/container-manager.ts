import { PodmanManager } from "@agentron-studio/runtime";
import { getContainerEngine } from "./app-settings";

/**
 * Returns a container manager configured with the current app setting (Podman or Docker).
 * Call per request so engine changes take effect without restart.
 */
export function getContainerManager(): PodmanManager {
  return new PodmanManager({ engine: getContainerEngine() });
}
