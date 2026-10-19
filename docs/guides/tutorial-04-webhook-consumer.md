# Tutorial 4 — Build a webhook consumer with signature verification

**Time:** ~10 minutes · **Source:** [`examples/tutorials/04-webhook-consumer`](../../examples/tutorials/04-webhook-consumer/index.mjs)

Create a subscription with `POST /api/webhooks` (`{ "url": "https://…", "contract_id": "C…" }`); the response contains a `secret`. Each delivery carries `X-Webhook-Signature: sha256=<hex>`, an HMAC-SHA256 of the raw request body.

## Verify the signature

Compare in constant time and always hash the **raw** body, not re-serialised JSON:

<!-- snippet: examples/tutorials/04-webhook-consumer/index.mjs#verify -->

You can also use the `@soroban-explorer/sdk` typed helper with automatic timestamp tolerance and replay protection:

```typescript
import { verifyWebhookSignature, createReplayCache } from '@soroban-explorer/sdk';

const replayCache = createReplayCache();

const result = await verifyWebhookSignature({
  secret: process.env.WEBHOOK_SECRET,
  rawBody: req.body, // raw bytes or string
  headers: req.headers, // extracts X-Webhook-Signature and X-Webhook-Timestamp
  tolerance: 300, // 5-minute tolerance window
  replayCache,
});

if (!result.valid) {
  return res.status(401).send(`Invalid webhook: ${result.error}`);
}
```

## Serve deliveries

<!-- snippet: examples/tutorials/04-webhook-consumer/index.mjs#server -->

## Run it

```bash
WEBHOOK_SECRET=<secret from POST /api/webhooks> PORT=8080 KEEP_RUNNING=1 node 04-webhook-consumer/index.mjs
```

Without `KEEP_RUNNING` the script sends itself a genuine and a tampered delivery and exits.
