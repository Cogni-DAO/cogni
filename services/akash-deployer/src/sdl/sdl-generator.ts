// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-deployer-service/sdl/sdl-generator`
 * Purpose: Generate Akash SDL YAML from service specs.
 * Scope: Pure function — no I/O. Does NOT submit deployments.
 * Invariants: SDL_IS_INTERNAL — not a public API.
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 * @internal
 */

import { stringify } from "yaml";
import type { ServiceSpec } from "../provider/cluster-provider.js";

/**
 * Generate Akash SDL v2.0 YAML from a list of service specs.
 * Pure function — same input always produces same output.
 */
export function generateSdl(services: ServiceSpec[]): string {
  const sdlServices: Record<string, unknown> = {};
  const compute: Record<string, unknown> = {};
  const pricing: Record<string, unknown> = {};
  const deployment: Record<string, unknown> = {};

  for (const svc of services) {
    // Build expose list
    const consumers = services
      .filter((other) => other.connectsTo.includes(svc.name))
      .map((other) => ({ service: other.name }));

    const to = svc.exposeGlobal ? [{ global: true }] : consumers;

    const envList = Object.entries(svc.env).map(([k, v]) => `${k}=${v}`);

    sdlServices[svc.name] = {
      image: svc.image,
      ...(envList.length > 0 ? { env: envList } : {}),
      expose: to.length > 0 ? [{ port: svc.port, proto: "tcp", to }] : [],
    };

    compute[svc.name] = {
      resources: {
        cpu: { units: svc.cpu },
        memory: { size: svc.memory },
        storage: { size: svc.storage },
      },
    };

    pricing[svc.name] = { denom: "uakt", amount: 100 };
    deployment[svc.name] = { default: { count: 1 } };
  }

  const sdl = {
    version: "2.0",
    services: sdlServices,
    profiles: {
      compute,
      placement: { default: { pricing } },
    },
    deployment,
  };

  return stringify(sdl);
}
