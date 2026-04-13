// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/crew-orchestrator/tools`
 * Purpose: Tool definitions for the crew orchestrator agent.
 * Scope: LangChain tool factories — pure functions returning tool instances. Does NOT invoke tools at creation time.
 * Invariants:
 *   - PURE_FACTORY: No side effects in tool creation (effects only when tools are called).
 *   - TOOLS_VIA_DI: All Akash + registry operations received via deps, not hard-imported.
 * Side-effects: IO
 * Links: docs/spec/akash-deploy-service.md
 * @internal
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

/** Minimal MCP server config shape (avoids hard import of @cogni/akash-client) */
interface McpServerConfig {
  name: string;
  image: string;
  transport: string;
  port: number;
  env: Record<string, string>;
  resources: { cpu: number; memory: string; storage: string };
  requiredAuth: string[];
}

/** Minimal crew config shape */
interface CrewConfig {
  name: string;
  mission?: string;
  mcpServers: McpServerConfig[];
  agents: Array<{
    name: string;
    image: string;
    soulMd?: string;
    mcpConnections: string[];
    env: Record<string, string>;
    resources: { cpu: number; memory: string; storage: string };
    exposeGlobal: boolean;
  }>;
  region: string;
  maxBudgetUakt: string;
}

/** Minimal registry entry shape */
interface McpRegistryEntrySummary {
  name: string;
  package: string;
  requiredEnv: string[];
  oauthScopes: string[];
  resources: { cpu: number; memory: string; storage: string };
}

/** Minimal SDL output shape */
interface SdlOutput {
  yaml: string;
  services: string[];
  estimatedCostPerBlock: string;
}

/** Deployer port — matches AkashDeployPort but avoids hard import */
interface DeployerPort {
  generateSdl(crew: CrewConfig): SdlOutput;
  createDeployment(sdlYaml: string): Promise<{
    deploymentId: string;
    status: string;
  }>;
  listBids(
    deploymentId: string
  ): Promise<Array<{ provider: string; price: { amount: string } }>>;
  acceptBid(
    deploymentId: string,
    provider: string
  ): Promise<{ leaseId?: string }>;
  sendManifest(deploymentId: string, sdlYaml: string): Promise<void>;
  getDeployment(deploymentId: string): Promise<Record<string, unknown>>;
  closeDeployment(deploymentId: string): Promise<Record<string, unknown>>;
}

/**
 * All external capabilities injected via DI.
 * The graph package never hard-imports @cogni/akash-client.
 */
export interface CrewOrchestratorToolDeps {
  deployer: DeployerPort;
  resolveMcpServer: (
    name: string,
    envOverrides?: Record<string, string>
  ) => McpServerConfig;
  listRegisteredMcpServers: () => McpRegistryEntrySummary[];
  getRequiredEnv: (name: string) => string[];
  getOAuthScopes: (name: string) => string[];
}

export function createCrewOrchestratorTools(deps: CrewOrchestratorToolDeps) {
  const {
    deployer,
    resolveMcpServer,
    listRegisteredMcpServers,
    getRequiredEnv,
    getOAuthScopes,
  } = deps;

  const listMcpServersTool = new DynamicStructuredTool({
    name: "list_mcp_servers",
    description:
      "List all available MCP servers in the registry with their capabilities and requirements.",
    schema: z.object({}),
    func: async () => {
      const servers = listRegisteredMcpServers();
      return JSON.stringify(servers, null, 2);
    },
  });

  const resolveMcpServersTool = new DynamicStructuredTool({
    name: "resolve_mcp_servers",
    description:
      "Resolve MCP server names to container images and deployment configs.",
    schema: z.object({
      serverNames: z
        .array(z.string())
        .describe("List of MCP server names to resolve"),
    }),
    func: async ({ serverNames }) => {
      const resolved = serverNames.map((name) => {
        const config = resolveMcpServer(name);
        return {
          name,
          serviceName: config.name,
          image: config.image,
          port: config.port,
          requiredEnv: getRequiredEnv(name),
          oauthScopes: getOAuthScopes(name),
          resources: config.resources,
        };
      });
      return JSON.stringify(resolved, null, 2);
    },
  });

  const planCrewTool = new DynamicStructuredTool({
    name: "plan_crew",
    description:
      "Create a deployment plan for a crew of MCP servers and agents. Returns SDL preview and cost estimate.",
    schema: z.object({
      name: z.string().describe("Crew name"),
      mission: z.string().describe("Mission statement for the crew"),
      mcpServerNames: z
        .array(z.string())
        .describe("MCP server names to include"),
      agents: z
        .array(
          z.object({
            name: z.string().describe("Agent name"),
            soulMd: z
              .string()
              .optional()
              .describe("Agent personality/mission description"),
            mcpConnections: z
              .array(z.string())
              .describe("Which MCP servers this agent connects to"),
          })
        )
        .describe("Agent definitions"),
    }),
    func: async ({ name, mission, mcpServerNames, agents }) => {
      const mcpServers = mcpServerNames.map((n) => resolveMcpServer(n));

      const crewConfig: CrewConfig = {
        name,
        mission,
        mcpServers,
        agents: agents.map((a) => ({
          name: a.name,
          image: "ghcr.io/cogni-dao/openclaw:latest",
          soulMd: a.soulMd
            ? Buffer.from(a.soulMd).toString("base64")
            : undefined,
          mcpConnections: a.mcpConnections.map(
            (mc) => `mcp-${mc.toLowerCase()}`
          ),
          env: {},
          resources: { cpu: 1, memory: "1Gi", storage: "2Gi" },
          exposeGlobal: true,
        })),
        region: "us-west",
        maxBudgetUakt: "1000000",
      };

      const sdl = deployer.generateSdl(crewConfig);

      const authRequirements = mcpServerNames.flatMap((n) => {
        const envVars = getRequiredEnv(n);
        const scopes = getOAuthScopes(n);
        return envVars.map((envVar) => ({
          mcpServer: n,
          envVar,
          oauthScopes: scopes,
        }));
      });

      return JSON.stringify(
        {
          crewConfig,
          sdlPreview: sdl.yaml,
          services: sdl.services,
          estimatedCostPerBlock: sdl.estimatedCostPerBlock,
          authRequirements,
        },
        null,
        2
      );
    },
  });

  const deployCrewTool = new DynamicStructuredTool({
    name: "deploy_crew",
    description:
      "Deploy a planned crew to the Akash network. Requires all auth credentials to be provided.",
    schema: z.object({
      crewConfig: z
        .string()
        .describe("JSON-stringified CrewConfig from plan_crew output"),
      credentials: z
        .record(z.string())
        .describe("Map of env var names to values"),
    }),
    func: async ({ crewConfig: crewConfigJson, credentials }) => {
      let crewConfig: CrewConfig;
      try {
        crewConfig = JSON.parse(crewConfigJson) as CrewConfig;
      } catch {
        return JSON.stringify({
          error:
            "Invalid crewConfig JSON. Please provide valid JSON from plan_crew output.",
        });
      }

      // Inject credentials into MCP server env vars
      for (const mcp of crewConfig.mcpServers) {
        for (const [key, value] of Object.entries(credentials)) {
          if (getRequiredEnv(mcp.name.replace("mcp-", "")).includes(key)) {
            mcp.env[key] = value;
          }
        }
      }

      const sdl = deployer.generateSdl(crewConfig);
      const deployment = await deployer.createDeployment(sdl.yaml);

      const bids = await deployer.listBids(deployment.deploymentId);
      if (bids.length > 0) {
        const sorted = bids.sort(
          (a, b) => Number(a.price.amount) - Number(b.price.amount)
        );
        const cheapest = sorted[0];
        if (!cheapest) throw new Error("No bids available after sort");
        const lease = await deployer.acceptBid(
          deployment.deploymentId,
          cheapest.provider
        );
        await deployer.sendManifest(deployment.deploymentId, sdl.yaml);

        return JSON.stringify({
          status: "active",
          deploymentId: deployment.deploymentId,
          provider: cheapest.provider,
          leaseId: lease.leaseId,
          services: sdl.services,
        });
      }

      return JSON.stringify({
        status: "pending_bids",
        deploymentId: deployment.deploymentId,
        message: "Deployment created, waiting for provider bids",
      });
    },
  });

  const checkDeploymentTool = new DynamicStructuredTool({
    name: "check_deployment",
    description:
      "Check the status of an Akash deployment and get endpoint URLs.",
    schema: z.object({
      deploymentId: z.string().describe("Akash deployment ID (owner/dseq)"),
    }),
    func: async ({ deploymentId }) => {
      const info = await deployer.getDeployment(deploymentId);
      return JSON.stringify(info, null, 2);
    },
  });

  const closeDeploymentTool = new DynamicStructuredTool({
    name: "close_deployment",
    description: "Close/stop an Akash deployment.",
    schema: z.object({
      deploymentId: z.string().describe("Akash deployment ID to close"),
    }),
    func: async ({ deploymentId }) => {
      const info = await deployer.closeDeployment(deploymentId);
      return JSON.stringify(info, null, 2);
    },
  });

  return [
    listMcpServersTool,
    resolveMcpServersTool,
    planCrewTool,
    deployCrewTool,
    checkDeploymentTool,
    closeDeploymentTool,
  ];
}
