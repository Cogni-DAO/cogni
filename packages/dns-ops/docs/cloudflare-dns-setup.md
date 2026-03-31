# Cloudflare DNS Setup

> **What this does**: Moves DNS management from Namecheap to Cloudflare (free).
> Namecheap stays as registrar (domain owner). Cloudflare handles DNS via API.
> **Time**: ~5 min setup + 5-30 min propagation.
> **Cost**: $0 (Cloudflare free plan — unlimited records, queries, subdomains).

---

## Step 1 — Create Cloudflare Account

1. Open [https://dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
2. Email + password → **Create Account**

---

## Step 2 — Add Your Domain

1. Open [https://dash.cloudflare.com/?to=/:account/add-site](https://dash.cloudflare.com/?to=/:account/add-site)
2. Type your domain (e.g. `cognidao.org`) → **Continue**
3. Select **Free** plan → **Continue**
4. Cloudflare auto-imports your existing DNS records — review them, click **Continue**
5. You'll see **two nameservers** like:
   ```
   alice.ns.cloudflare.com
   ian.ns.cloudflare.com
   ```
   **Copy both.** You need them for the next step.

---

## Step 3 — Point Namecheap to Cloudflare

1. Open [https://ap.www.namecheap.com/domains/list/](https://ap.www.namecheap.com/domains/list/)
2. Find your domain → click **Manage**
3. On the **Domain** tab (NOT "Advanced DNS"), find the **Nameservers** section
4. Change the dropdown from "Namecheap BasicDNS" → **Custom DNS**
5. Paste the two Cloudflare nameservers from Step 2 (one per line):
   ```
   alice.ns.cloudflare.com
   ian.ns.cloudflare.com
   ```
6. Click the **green checkmark** to save

> **Common mistake**: Don't use the "Advanced DNS" → "Personal DNS Server" section — that's for custom nameserver IPs, not what we need. The **Nameservers** dropdown is on the main **Domain** tab near the top of the page.

---

## Step 4 — Wait for Propagation

1. Back in Cloudflare → click **Done, check nameservers**
2. Cloudflare emails you when active (usually 5-30 min, can take up to 24h)
3. Check status: [https://dash.cloudflare.com](https://dash.cloudflare.com) → click your domain → look for **"Active"** badge
4. Verify from terminal:
   ```bash
   dig yourdomain.org NS +short
   ```
   Should show `alice.ns.cloudflare.com.` and `ian.ns.cloudflare.com.` when propagated.

---

## Step 5 — Create API Token

1. Open [https://dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Click **Create Token**
3. Find the **"Edit zone DNS"** row → click **Use template**
4. Configure the token:

   | Field                   | Value                                            |
   | ----------------------- | ------------------------------------------------ |
   | **Token name**          | `node-template-dev-local` (or whatever you want) |
   | **Permissions**         | Zone · DNS · **Edit**                            |
   | **Zone Resources**      | Include · Specific zone · **your domain**        |
   | **Account Resources**   | Leave default (All accounts)                     |
   | **Client IP Filtering** | Leave blank (no restriction)                     |
   | **TTL**                 | Leave blank (no expiry)                          |

   > **If you see "Create Custom Token" instead of the template**: Set the permission row to:
   >
   > - First dropdown: **Zone**
   > - Second dropdown: **DNS**
   > - Third dropdown: **Edit**

5. Click **Continue to summary** → **Create Token**
6. **Copy the token immediately** — it's shown only once!

---

## Step 6 — Get Zone ID

1. Open [https://dash.cloudflare.com](https://dash.cloudflare.com) → click your domain
2. On the **Overview** page, scroll down the **right sidebar**
3. Under the **API** section → copy **Zone ID** (32-character hex string)

---

## Step 7 — Add to Environment

In your `.env.local`, uncomment and fill in:

```env
CLOUDFLARE_API_TOKEN=your-token-from-step-5
CLOUDFLARE_ZONE_ID=your-zone-id-from-step-6
```

---

## Step 8 — Verify

```bash
# Quick API test — should return your DNS records as JSON
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records" | jq '.result[].name'
```

---

## Troubleshooting

| Symptom                                         | Fix                                                                                                   |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **"Pending Nameserver Update"** in Cloudflare   | Nameservers not propagated yet. Double-check Step 3. Wait up to 24h.                                  |
| **Existing DNS records missing**                | Cloudflare imports them in Step 2. If any were missed, add manually: Cloudflare → DNS → Add Record.   |
| **Email stops working**                         | MX records didn't carry over. Check Cloudflare → DNS for MX records pointing to your mail provider.   |
| **API returns 403**                             | Token permissions wrong. Needs: Zone · DNS · Edit. Verify in Step 5.                                  |
| **API returns "Invalid zone identifier"**       | Wrong Zone ID. Re-copy from Step 6 (32-char hex, no dashes).                                          |
| **Namecheap "Personal DNS Server" asks for IP** | Wrong section! Use the **Nameservers** dropdown on the Domain tab, not Advanced DNS. See Step 3 note. |
