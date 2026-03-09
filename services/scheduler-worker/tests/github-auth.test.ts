import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock @octokit/auth-app
// ---------------------------------------------------------------------------

const mockAuth = vi.fn();

vi.mock("@octokit/auth-app", () => ({
  createAppAuth: () => mockAuth,
}));

// Mock global fetch for installation ID resolution
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import after mocks
import { GitHubAppTokenProvider } from "../src/adapters/ingestion/github-auth";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GitHubAppTokenProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseConfig = {
    appId: "12345",
    privateKey:
      "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
  };

  describe("getToken() with installationId override", () => {
    it("returns token and expiresAt from auth-app", async () => {
      const expiresAt = new Date(Date.now() + 3600_000).toISOString();
      mockAuth.mockResolvedValueOnce({
        token: "ghs_installation_token_123",
        expiresAt,
      });

      const provider = new GitHubAppTokenProvider({
        ...baseConfig,
        installationId: 42,
      });

      const result = await provider.getToken({
        provider: "github",
        capability: "ingest",
      });

      expect(result.token).toBe("ghs_installation_token_123");
      expect(result.expiresAt).toEqual(new Date(expiresAt));
      expect(mockAuth).toHaveBeenCalledWith({
        type: "installation",
        installationId: 42,
      });
    });
  });

  describe("getToken() with dynamic installation ID resolution", () => {
    it("resolves installationId from repoRef via GitHub API", async () => {
      // First call: app JWT for API call
      mockAuth.mockResolvedValueOnce({ token: "jwt_app_token" });
      // Second call: installation token
      const expiresAt = new Date(Date.now() + 3600_000).toISOString();
      mockAuth.mockResolvedValueOnce({
        token: "ghs_resolved_token",
        expiresAt,
      });

      // Mock fetch for installation lookup
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 99 }),
      });

      const provider = new GitHubAppTokenProvider(baseConfig);
      const result = await provider.getToken({
        provider: "github",
        capability: "ingest",
        repoRef: "cogni-dao/cogni-template",
      });

      expect(result.token).toBe("ghs_resolved_token");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/cogni-dao/cogni-template/installation",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer jwt_app_token",
          }),
        })
      );
      // Installation token call uses resolved ID
      expect(mockAuth).toHaveBeenCalledWith({
        type: "installation",
        installationId: 99,
      });
    });

    it("caches installationId on second call", async () => {
      // First getToken: resolve installation ID
      mockAuth
        .mockResolvedValueOnce({ token: "jwt_token" }) // app JWT
        .mockResolvedValueOnce({
          token: "ghs_first",
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 77 }),
      });

      const provider = new GitHubAppTokenProvider(baseConfig);
      await provider.getToken({
        provider: "github",
        capability: "ingest",
        repoRef: "org/repo",
      });

      // Second getToken: should NOT call fetch again
      mockAuth.mockResolvedValueOnce({
        token: "ghs_second",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      const result2 = await provider.getToken({
        provider: "github",
        capability: "ingest",
        repoRef: "org/repo",
      });

      expect(result2.token).toBe("ghs_second");
      // fetch was only called once (first getToken)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("throws when GitHub App is not installed on repo", async () => {
      mockAuth.mockResolvedValueOnce({ token: "jwt_token" });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const provider = new GitHubAppTokenProvider(baseConfig);
      await expect(
        provider.getToken({
          provider: "github",
          capability: "ingest",
          repoRef: "unknown/repo",
        })
      ).rejects.toThrow("GitHub App not installed on unknown/repo");
    });
  });

  describe("error handling", () => {
    it("throws when no installationId and no repoRef", async () => {
      const provider = new GitHubAppTokenProvider(baseConfig);

      await expect(
        provider.getToken({ provider: "github", capability: "ingest" })
      ).rejects.toThrow("installationId required");
    });
  });
});
