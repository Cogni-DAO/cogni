# x402 + AiMo Network Spike (spike.0220)

Experimental demo proving x402 payment flow with AiMo Network as the AI inference provider.

## Prerequisites

- `OPERATOR_PRIVATE_KEY` in repo root `.env.local` (wallet with USDC on Base)
- `OPERATOR_WALLET_ADDRESS` in repo root `.env.local`
- Node.js 20+

## Scripts

```bash
cd spikes/x402-aimo-demo
npm install

# Demo 1: Direct x402 completion (wallet → AiMo)
npm run demo:direct

# Demo 3+4: Proxy middleman (client → Cogni node → AiMo)
npm run demo:proxy          # Terminal 1: start proxy server
npm run demo:proxy-client   # Terminal 2: call the proxy
```

## Architecture

```
Demo 1 (direct):
  Wallet --x402--> AiMo Network --> AI completion

Demo 3+4 (proxy):
  Client --x402--> Cogni Node Proxy --x402--> AiMo Network
         <--200--                   <--200--
```

## What this proves

1. x402 402→sign→settle flow works with AiMo's OpenAI-compatible API
2. A Cogni node can act as x402 middleman (receive payment, pay upstream, keep margin)
3. No API keys needed — wallet-based auth end-to-end
4. Standard OpenAI message format works unchanged through the proxy
