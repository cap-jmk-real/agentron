import { describe, it, expect } from "vitest";
import {
  isContainerUnavailableError,
  withContainerInstallHint,
  CONTAINER_INSTALL_LINKS,
} from "../../../app/api/_lib/container-manager";

describe("container-manager", () => {
  describe("isContainerUnavailableError", () => {
    it("returns true for ENOENT", () => {
      expect(isContainerUnavailableError("Error: spawn ENOENT")).toBe(true);
      expect(isContainerUnavailableError("ENOENT: no such file")).toBe(true);
    });

    it("returns true for command not found", () => {
      expect(isContainerUnavailableError("podman: command not found")).toBe(true);
      expect(isContainerUnavailableError("Command not found")).toBe(true);
    });

    it("returns true for is not recognized", () => {
      expect(isContainerUnavailableError("'podman' is not recognized")).toBe(true);
    });

    it("returns true for not found: podman/docker", () => {
      expect(isContainerUnavailableError("not found: 'podman'")).toBe(true);
      expect(isContainerUnavailableError("not found: 'docker'")).toBe(true);
    });

    it("returns false for unrelated errors", () => {
      expect(isContainerUnavailableError("Connection refused")).toBe(false);
      expect(isContainerUnavailableError("Permission denied")).toBe(false);
      expect(isContainerUnavailableError("")).toBe(false);
    });
  });

  describe("withContainerInstallHint", () => {
    it("returns original message when error is not container-unavailable", () => {
      const msg = "Something else failed";
      expect(withContainerInstallHint(msg)).toBe(msg);
    });

    it("appends install hint when error indicates container unavailable", () => {
      const result = withContainerInstallHint("spawn podman ENOENT");
      expect(result).toContain("spawn podman ENOENT");
      expect(result).toContain("Install a container runtime");
      expect(result).toContain(CONTAINER_INSTALL_LINKS.docker);
      expect(result).toContain(CONTAINER_INSTALL_LINKS.podman);
      expect(result).toContain("Settings → Container Engine");
    });
  });

  describe("CONTAINER_INSTALL_LINKS", () => {
    it("exports docker and podman URLs", () => {
      expect(CONTAINER_INSTALL_LINKS.docker).toMatch(/^https:/);
      expect(CONTAINER_INSTALL_LINKS.podman).toMatch(/^https:/);
    });
  });
});
