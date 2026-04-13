#!/usr/bin/env npx tsx
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `akash-prototype`
 * Purpose: Standalone proof-of-concept that deploys a container to Akash testnet.
 * Scope: Prototype only — not production code. Does NOT implement ContainerRuntimePort yet.
 * Invariants: none
 * Side-effects: IO
 * Links: docs/research/akashjs-sdk-deployment.md
 *
 * Usage:
 *   RPC_ENDPOINT=https://rpc.sandbox-01.aksh.pw:443 \
 *   MNEMONIC="your twelve word mnemonic" \
 *   npx tsx services/akash-deployer/src/runtime/akash-prototype.ts
 *
 * What it does:
 *   1. Creates wallet from mnemonic
 *   2. Generates/loads mTLS certificate
 *   3. Creates Akash deployment from inline SDL
 *   4. Polls for provider bids
 *   5. Accepts cheapest bid → creates lease
 *   6. Sends manifest to provider
 *   7. Polls until service is live, prints URL
 */

import fs from "node:fs";
import https from "node:https";
import path from "node:path";
// These imports require @akashnetwork/akashjs and @akashnetwork/chain-sdk
// Install: pnpm add @akashnetwork/akashjs @akashnetwork/chain-sdk @cosmjs/proto-signing @cosmjs/stargate
import * as cert from "@akashnetwork/akashjs/build/certificates";
import { certificateManager } from "@akashnetwork/akashjs/build/certificates/certificate-manager";
import type { CertificatePem } from "@akashnetwork/akashjs/build/certificates/certificate-manager/CertificateManager";
import { getRpc } from "@akashnetwork/akashjs/build/rpc";
import { SDL } from "@akashnetwork/akashjs/build/sdl";
import { getAkashTypeRegistry } from "@akashnetwork/akashjs/build/stargate";
import { BidID, Source } from "@akashnetwork/chain-sdk/private-types/akash.v1";
import {
  MsgCreateDeployment,
  QueryProviderRequest,
  QueryProviderResponse,
} from "@akashnetwork/chain-sdk/private-types/akash.v1beta4";
import {
  MsgCreateLease,
  QueryBidsRequest,
  QueryBidsResponse,
} from "@akashnetwork/chain-sdk/private-types/akash.v1beta5";
import { DirectSecp256k1HdWallet, Registry } from "@cosmjs/proto-signing";
import { SigningStargateClient } from "@cosmjs/stargate";

// ── Config ──

const RPC = process.env.RPC_ENDPOINT;
const MNEMONIC = process.env.MNEMONIC;

if (!RPC)
  throw new Error(
    "Set RPC_ENDPOINT (e.g., https://rpc.sandbox-01.aksh.pw:443)"
  );
if (!MNEMONIC) throw new Error("Set MNEMONIC (12-word seed phrase)");

// Deploy a simple web server — replace with any MCP server image
const SDL_YAML = `
version: "2.0"
services:
  mcp:
    image: alpine/socat:latest
    command: ["socat", "TCP-LISTEN:3000,fork", "EXEC:echo HTTP/1.1 200 OK"]
    expose:
      - port: 3000
        as: 80
        to:
          - global: true
profiles:
  compute:
    mcp:
      resources:
        cpu:
          units: 0.5
        memory:
          size: 512Mi
        storage:
          size: 512Mi
  placement:
    dcloud:
      pricing:
        mcp:
          denom: uakt
          amount: 1000
deployment:
  mcp:
    dcloud:
      profile: mcp
      count: 1
`;

const CERT_PATH = path.resolve(import.meta.dirname ?? ".", ".akash-cert.json");
const BID_TIMEOUT_MS = 5 * 60 * 1000;
const LIVE_TIMEOUT_MS = 10 * 60 * 1000;

// ── Helpers ──

function log(msg: string) {
  console.log(`[akash] ${msg}`);
}

// createRpcRequest helper (simplified from akashjs examples)
function createRpcRequest(
  rpc: Awaited<ReturnType<typeof getRpc>>,
  config: {
    methodName: string;
    // biome-ignore lint/suspicious/noExplicitAny: Akash proto SDK is untyped
    requestType: { encode(req: any): { finish(): Uint8Array } };
    // biome-ignore lint/suspicious/noExplicitAny: Akash proto SDK is untyped
    responseType: { decode(data: Uint8Array): any };
  }
) {
  // biome-ignore lint/suspicious/noExplicitAny: Akash proto SDK is untyped
  return async (input: any) => {
    const encoded = config.requestType.encode(input).finish();
    const response = await rpc.request(config.methodName, encoded);
    return config.responseType.decode(response);
  };
}

// ── Step 1: Wallet ──

async function initWallet() {
  log("Creating wallet from mnemonic...");
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(
    MNEMONIC as string,
    {
      prefix: "akash",
    }
  );
  const [account] = await wallet.getAccounts();
  if (!account) throw new Error("No accounts in wallet");
  log(`Wallet: ${account.address}`);

  const registry = getAkashTypeRegistry();
  const client = await SigningStargateClient.connectWithSigner(
    RPC as string,
    wallet,
    {
      registry: new Registry(registry),
    }
  );

  return { wallet, client, address: account.address };
}

// ── Step 2: Certificate ──

async function ensureCertificate(
  address: string,
  client: SigningStargateClient
) {
  if (fs.existsSync(CERT_PATH)) {
    log("Loading existing certificate...");
    return JSON.parse(fs.readFileSync(CERT_PATH, "utf-8")) as CertificatePem;
  }

  log("Generating mTLS certificate...");
  const certificate = certificateManager.generatePEM(address);
  const result = await cert.broadcastCertificate(certificate, address, client);

  if (result.code !== 0) {
    throw new Error(`Certificate broadcast failed: ${result.rawLog}`);
  }

  fs.writeFileSync(CERT_PATH, JSON.stringify(certificate));
  log("Certificate created and broadcast on-chain");
  return certificate;
}

// ── Step 3: Deploy ──

async function createDeployment(
  sdl: InstanceType<typeof SDL>,
  address: string,
  client: SigningStargateClient
) {
  const blockheight = await client.getHeight();
  const groups = sdl.groups();

  const deployment = {
    id: { owner: address, dseq: String(blockheight) },
    groups,
    deposit: {
      sources: [Source.balance],
      amount: { denom: "uakt", amount: "5000000" },
    },
    hash: await sdl.manifestVersion(),
  };

  const msg = {
    typeUrl: `/${MsgCreateDeployment.$type}`,
    value: MsgCreateDeployment.fromPartial(deployment),
  };

  const fee = { amount: [{ denom: "uakt", amount: "20000" }], gas: "800000" };

  log(`Creating deployment (dseq: ${deployment.id.dseq})...`);
  const tx = await client.signAndBroadcast(address, [msg], fee, "cogni deploy");

  if (tx.code !== 0) {
    throw new Error(`Deployment failed: ${tx.rawLog}`);
  }

  log(`Deployment created: ${address}/${deployment.id.dseq}`);
  return deployment;
}

// ── Step 4: Bids ──

async function waitForBids(dseq: string, owner: string) {
  const rpc = await getRpc(RPC as string);

  const getBids = createRpcRequest(rpc, {
    methodName: "akash.market.v1beta5.Bids",
    requestType: QueryBidsRequest,
    responseType: QueryBidsResponse,
  });

  const start = Date.now();
  while (Date.now() - start < BID_TIMEOUT_MS) {
    log("Polling for bids...");
    await new Promise((r) => setTimeout(r, 5000));

    const result = await getBids({ filters: { owner, dseq } });
    if (result.bids.length > 0 && result.bids[0].bid) {
      log(`Got ${result.bids.length} bid(s)`);
      return result.bids[0].bid;
    }
  }

  throw new Error("No bids received (timeout)");
}

// ── Step 5: Lease ──

async function createLease(
  // biome-ignore lint/suspicious/noExplicitAny: Akash BidID proto type
  bidId: any,
  address: string,
  client: SigningStargateClient
) {
  const msg = {
    typeUrl: `/${MsgCreateLease.$type}`,
    value: MsgCreateLease.fromPartial({ bidId }),
  };

  const fee = { amount: [{ denom: "uakt", amount: "50000" }], gas: "2000000" };

  log("Creating lease...");
  const tx = await client.signAndBroadcast(address, [msg], fee, "cogni lease");

  if (tx.code !== 0) {
    throw new Error(`Lease failed: ${tx.rawLog}`);
  }

  const leaseId = BidID.toJSON(bidId) as {
    owner: string;
    dseq: number;
    provider: string;
    gseq: number;
    oseq: number;
  };

  log(`Lease created with provider: ${leaseId.provider}`);
  return leaseId;
}

// ── Step 6: Manifest ──

async function sendManifest(
  sdl: InstanceType<typeof SDL>,
  leaseId: { dseq: number; provider: string; gseq: number; oseq: number },
  certificate: CertificatePem
) {
  // Look up provider URI
  const rpc = await getRpc(RPC as string);
  const getProvider = createRpcRequest(rpc, {
    methodName: "akash.provider.v1beta4.Provider",
    requestType: QueryProviderRequest,
    responseType: QueryProviderResponse,
  });

  const providerResult = await getProvider({ owner: leaseId.provider });
  if (!providerResult.provider) {
    throw new Error(`Provider not found: ${leaseId.provider}`);
  }

  const providerUri = providerResult.provider.hostUri;
  const manifest = sdl.manifestSortedJSON();

  const agent = new https.Agent({
    cert: certificate.cert,
    key: certificate.privateKey,
    rejectUnauthorized: false,
    servername: "",
  });

  const uri = new URL(providerUri);

  log(`Sending manifest to provider ${uri.hostname}...`);

  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        hostname: uri.hostname,
        port: uri.port,
        path: `/deployment/${leaseId.dseq}/manifest`,
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Content-Length": manifest.length,
        },
        agent,
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Manifest send failed: HTTP ${res.statusCode}`));
          return;
        }
        resolve();
      }
    );
    req.on("error", reject);
    req.write(manifest);
    req.end();
  });

  log("Manifest sent. Waiting for service to start...");

  // Poll for live service
  const start = Date.now();
  while (Date.now() - start < LIVE_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 5000));

    try {
      // biome-ignore lint/suspicious/noExplicitAny: provider lease status response shape
      const status = await new Promise<any>((resolve, reject) => {
        const req = https.request(
          {
            hostname: uri.hostname,
            port: uri.port,
            path: `/lease/${leaseId.dseq}/${leaseId.gseq}/${leaseId.oseq}/status`,
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            agent,
          },
          (res) => {
            if (res.statusCode !== 200) {
              reject(`HTTP ${res.statusCode}`);
              return;
            }
            let data = "";
            res.on("data", (chunk) => {
              data += chunk;
            });
            res.on("end", () => resolve(JSON.parse(data)));
          }
        );
        req.on("error", reject);
        req.end();
      });

      if (status?.services) {
        for (const [name, service] of Object.entries(
          status.services as Record<string, { uris?: string[] }>
        )) {
          if (service.uris && service.uris.length > 0) {
            log(`\n✓ SERVICE LIVE: ${name} → ${service.uris[0]}\n`);
            return service.uris[0];
          }
        }
      }
      log("Waiting for endpoints...");
    } catch {
      log("Service not ready yet...");
    }
  }

  throw new Error("Service did not start (timeout)");
}

// ── Main ──

async function main() {
  log("=== Akash Deployment Prototype ===\n");

  const init = await initWallet();
  const certificate = await ensureCertificate(init.address, init.client);
  const sdl = SDL.fromString(SDL_YAML, "beta3");

  const deployment = await createDeployment(sdl, init.address, init.client);
  const bid = await waitForBids(deployment.id.dseq, init.address);

  if (!bid.id) throw new Error("Bid has no ID");
  const leaseId = await createLease(bid.id, init.address, init.client);

  const url = await sendManifest(sdl, leaseId, certificate);

  log("=== DEPLOYMENT COMPLETE ===");
  log(`Deployment: ${init.address}/${deployment.id.dseq}`);
  log(`Provider: ${leaseId.provider}`);
  log(`URL: ${url ?? "unknown"}`);
  log("\nTo close: set CLOSE_DSEQ and run the close script");
}

main().catch((err) => {
  console.error("\n[akash] FATAL:", err.message || err);
  process.exit(1);
});
