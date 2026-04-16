---
name: dns-ops
description: "DNS operations for Cogni multi-node infrastructure. Guides Cloudflare setup, creates/destroys node subdomains, manages DNS records safely. Protected record safeguards prevent production outages."
---

# DNS Operations — Multi-Node Subdomain Management

You are a DNS operations agent. Your job: ensure Cloudflare DNS is set up, then create/manage subdomains for Cogni nodes. You never touch production records (`@`, `www`).

## References (read these — they own the details)

- [Cloudflare Setup Guide](../../../packages/dns-ops/docs/cloudflare-dns-setup.md) — full step-by-step with screenshots
- [dns-ops package](../../../packages/dns-ops/) — `@cogni/dns-ops` source code
- [create-node script](../../../packages/dns-ops/scripts/create-node.ts) — wizard CLI
- [task.0232](../../../work/items/task.0232.dns-ops-node-creation-v0.md) — current work item
- [task.0233](../../../work/items/task.0233.node-template-extraction.md) — node-template design
- [task.0234](../../../work/items/task.0234.node-repo-cicd-onboarding.md) — repo CI/CD onboarding
- [node-launch spec](../../../docs/spec/node-launch.md) — full provisioning architecture

## Pre-flight: Is Cloudflare Set Up?

Check for credentials:

```bash
grep CLOUDFLARE .env.local 2>/dev/null
```

**If both `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` are set → skip to Operations.**

**If not → guide the user through setup:**

### Cloudflare Setup (one-time, ~5 min)

1. **Account**: [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
2. **Add domain**: [dash.cloudflare.com/?to=/:account/add-site](https://dash.cloudflare.com/?to=/:account/add-site) → type domain → Free plan → Continue
3. **Change nameservers in Namecheap**:
   - [ap.www.namecheap.com/domains/list/](https://ap.www.namecheap.com/domains/list/) → Manage → **Domain tab** (NOT Advanced DNS)
   - Nameservers dropdown → **Custom DNS** → paste Cloudflare's two nameservers → green checkmark
   - **Common mistake**: Don't use "Advanced DNS" → "Personal DNS Server" — that's for IP addresses, not nameservers
4. **Wait for propagation** (5-30 min): `dig cognidao.org NS +short` should show cloudflare nameservers
5. **Create API token**: [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
   - Create Token → **"Edit zone DNS"** template (or Custom Token with these permissions):

   | Field          | Value                           |
   | -------------- | ------------------------------- |
   | Permissions    | **Zone** · **DNS** · **Edit**   |
   | Zone Resources | Specific zone · **your domain** |
   | Account/IP/TTL | Leave defaults                  |

6. **Get Zone ID**: [dash.cloudflare.com](https://dash.cloudflare.com) → click domain → right sidebar → API section → Zone ID
7. **Add to `.env.local`**:
   ```
   CLOUDFLARE_API_TOKEN=<token>
   CLOUDFLARE_ZONE_ID=<zone-id>
   ```

**Verify setup works:**

```bash
source .env.local && export CLOUDFLARE_API_TOKEN CLOUDFLARE_ZONE_ID
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records" | jq '.result | length'
```

Should return a number (your existing record count).

## Operations

### Create a node subdomain

```bash
source .env.local && export CLOUDFLARE_API_TOKEN CLOUDFLARE_ZONE_ID
npx tsx packages/dns-ops/scripts/create-node.ts <slug>
```

Example: `npx tsx packages/dns-ops/scripts/create-node.ts resy-helper`

Creates: `resy-helper.nodes.cognidao.org` → cluster IP. Outputs node-spec JSON.

### Programmatic usage (from TypeScript)

```typescript
import {
  CloudflareAdapter,
  upsertDnsRecord,
  removeDnsRecord,
} from "@cogni/dns-ops";

const cf = new CloudflareAdapter({
  apiToken: process.env.CLOUDFLARE_API_TOKEN,
  zoneId: process.env.CLOUDFLARE_ZONE_ID,
});

// Create subdomain
await upsertDnsRecord(cf, "cognidao.org", {
  name: "my-node.nodes",
  type: "A",
  value: "1.2.3.4",
  ttl: 300,
});

// Remove subdomain
await removeDnsRecord(cf, "cognidao.org", "my-node.nodes", "A");
```

### List all DNS records

```bash
source .env.local && export CLOUDFLARE_API_TOKEN CLOUDFLARE_ZONE_ID
npx tsx packages/dns-ops/scripts/test-live.ts
```

### Verify a record

```bash
dig <subdomain>.cognidao.org +short @1.1.1.1
```

## Domain Ownership

**cognidao.org** — Namecheap, expires **2027-04-06**. Renew annually.

On 2026-04-05 the domain expired and all DNS stopped resolving for ~6 hours. Set a calendar reminder 30 days before expiry. See `work/charters/DOMAINS.md` for full domain inventory.

### Canonical DNS mapping (keep these in sync):

| Domain                                | IP            | Environment |
| ------------------------------------- | ------------- | ----------- |
| cognidao.org / www                    | 84.32.109.162 | Production  |
| test / poly-test / resy-test          | 84.32.109.222 | Canary      |
| preview / poly-preview / resy-preview | 84.32.110.92  | Preview     |

## Safety Rules

### NEVER modify these records:

- `@` (root domain — cognidao.org)
- `www` (www.cognidao.org)
- Any MX records (email delivery)

The `upsertDnsRecord` and `removeDnsRecord` helpers **enforce this automatically** — they throw `PROTECTED` errors on `@` and `www`. If you need to modify these, use the Cloudflare dashboard directly (never programmatically).

### Safe patterns:

- `*.nodes.cognidao.org` — node subdomains (create freely)
- `*.preview.cognidao.org` — preview deploy subdomains (create/delete freely)
- Any subdomain that isn't `@`, `www`, or existing production records

### Before modifying DNS:

1. Always list existing records first
2. Verify you're targeting the right record (name + type)
3. For non-node records, confirm with the user before proceeding

## Architecture Roadmap

```
DONE:   @cogni/dns-ops package (31 tests, Cloudflare + Namecheap adapters)
DONE:   create-node wizard (DNS + node-spec output)
DONE:   Protected record safeguards (@, www blocked)
─────────────────────────────────────────────────────
TODO:   task.0232 — destroy-node, wildcard DNS, lint/CI compliance
TODO:   task.0233 — operator/node-template split, repo-spec v0.2.0
TODO:   task.0234 — git repo creation + CI/CD for nodes
TODO:   task.0202 — full provisionNode Temporal workflow
```

### Wildcard DNS (upcoming)

Once cluster ingress is stable, create one wildcard record:

```
*.nodes.cognidao.org → <cluster-ingress-ip>
```

This eliminates per-node DNS creation — all `*.nodes` subdomains auto-resolve.

### TLS (upcoming)

Subdomains won't serve HTTPS until the cluster's reverse proxy (Caddy) has a wildcard TLS cert. Current state: DNS resolves but HTTPS shows "not secure" because no server is configured for these hostnames yet.

## Troubleshooting

| Symptom                                        | Fix                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `ERR_NAME_NOT_RESOLVED`                        | DNS not propagated. Check: `dig <domain> +short @1.1.1.1`. Flush local: `sudo dscacheutil -flushcache` |
| `ERR_CONNECTION_CLOSED` / "not secure"         | DNS works but no server/TLS for that hostname. Expected until cluster ingress is configured.           |
| `PROTECTED: refusing to modify`                | You tried to change `@` or `www`. Use Cloudflare dashboard for protected records.                      |
| `Cloudflare API error: 403`                    | Token permissions wrong. Needs: Zone · DNS · Edit. Recreate token.                                     |
| `Invalid zone identifier`                      | Wrong Zone ID. Copy from Cloudflare dashboard → domain → right sidebar → API section.                  |
| `A CNAME record with that host already exists` | Can't have both A and CNAME on same name. Remove old record type first, then create new one.           |
