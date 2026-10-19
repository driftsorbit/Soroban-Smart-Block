import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  verifyWebhookSignature,
  assertWebhookSignature,
  createReplayCache,
  timingSafeEqual,
  WebhookVerificationError,
} from '../src/webhook.js';

describe('Webhook signature verification (#1084)', () => {
  const secret = 'whsec_test_secret_1234567890abcdef';
  const payload = JSON.stringify({
    seq: 42,
    contract_id: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    function: 'transfer',
    ledger: 1000,
    created_at: new Date().toISOString(),
  });

  function sign(body: string, sec: string = secret): string {
    const hex = crypto.createHmac('sha256', sec).update(body).digest('hex');
    return `sha256=${hex}`;
  }

  function signRawHex(body: string, sec: string = secret): string {
    return crypto.createHmac('sha256', sec).update(body).digest('hex');
  }

  describe('timingSafeEqual', () => {
    it('compares equal byte arrays correctly', () => {
      const a = new Uint8Array([1, 2, 3]);
      const b = new Uint8Array([1, 2, 3]);
      expect(timingSafeEqual(a, b)).toBe(true);
    });

    it('returns false for unequal arrays of same or different lengths', () => {
      const a = new Uint8Array([1, 2, 3]);
      const b = new Uint8Array([1, 2, 4]);
      const c = new Uint8Array([1, 2]);
      expect(timingSafeEqual(a, b)).toBe(false);
      expect(timingSafeEqual(a, c)).toBe(false);
    });
  });

  describe('Normal verification path', () => {
    it('accepts valid signature with string body', async () => {
      const signature = sign(payload);
      const now = Math.floor(Date.now() / 1000);

      const result = await verifyWebhookSignature({
        secret,
        rawBody: payload,
        signature,
        timestamp: now,
      });

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.payload).toEqual(JSON.parse(payload));
      expect(result.timestamp).toBe(now);
    });

    it('accepts raw request bytes (Buffer / Uint8Array)', async () => {
      const buffer = Buffer.from(payload, 'utf8');
      const signature = sign(payload);
      const now = Math.floor(Date.now() / 1000);

      const result = await verifyWebhookSignature({
        secret,
        rawBody: buffer,
        signature,
        timestamp: now,
      });

      expect(result.valid).toBe(true);
      expect(result.payload).toEqual(JSON.parse(payload));
    });

    it('accepts ArrayBuffer', async () => {
      const uint8 = new TextEncoder().encode(payload);
      const signature = sign(payload);
      const now = Math.floor(Date.now() / 1000);

      const result = await verifyWebhookSignature({
        secret,
        rawBody: uint8.buffer,
        signature,
        timestamp: now,
      });

      expect(result.valid).toBe(true);
    });

    it('accepts raw hex signature format without sha256= prefix', async () => {
      const rawHex = signRawHex(payload);
      const now = Math.floor(Date.now() / 1000);

      const result = await verifyWebhookSignature({
        secret,
        rawBody: payload,
        signature: rawHex,
        timestamp: now,
      });

      expect(result.valid).toBe(true);
    });

    it('extracts signature and timestamp from headers map (case-insensitive)', async () => {
      const signature = sign(payload);
      const now = Math.floor(Date.now() / 1000);

      const headers = {
        'x-webhook-signature': signature,
        'X-Webhook-Timestamp': String(now),
      };

      const result = await verifyWebhookSignature({
        secret,
        rawBody: payload,
        headers,
      });

      expect(result.valid).toBe(true);
      expect(result.timestamp).toBe(now);
    });

    it('supports t=...,v1=... composite signature format', async () => {
      const hex = signRawHex(payload);
      const now = Math.floor(Date.now() / 1000);
      const compositeSig = `t=${now},v1=${hex}`;

      const result = await verifyWebhookSignature({
        secret,
        rawBody: payload,
        signature: compositeSig,
      });

      expect(result.valid).toBe(true);
      expect(result.timestamp).toBe(now);
    });
  });

  describe('Invalid input and failure behavior', () => {
    it('rejects when secret is missing or empty', async () => {
      const result = await verifyWebhookSignature({
        secret: '',
        rawBody: payload,
        signature: sign(payload),
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('missing_secret');
    });

    it('rejects when payload is missing', async () => {
      const result = await verifyWebhookSignature({
        secret,
        rawBody: null as any,
        signature: sign(payload),
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('missing_payload');
    });

    it('rejects when signature is missing', async () => {
      const result = await verifyWebhookSignature({
        secret,
        rawBody: payload,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('missing_signature');
    });

    it('rejects malformed signature formats', async () => {
      const result = await verifyWebhookSignature({
        secret,
        rawBody: payload,
        signature: 'invalid-not-hex',
        tolerance: 0,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('invalid_signature_format');
    });

    it('rejects tampered body', async () => {
      const signature = sign(payload);
      const tampered = payload.replace('1000', '9999');
      const now = Math.floor(Date.now() / 1000);

      const result = await verifyWebhookSignature({
        secret,
        rawBody: tampered,
        signature,
        timestamp: now,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe('signature_mismatch');
    });

    it('rejects incorrect secret', async () => {
      const signature = sign(payload, 'wrong_secret');
      const now = Math.floor(Date.now() / 1000);

      const result = await verifyWebhookSignature({
        secret,
        rawBody: payload,
        signature,
        timestamp: now,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe('signature_mismatch');
    });
  });

  describe('Timestamp tolerance enforcement', () => {
    it('rejects when timestamp is missing and tolerance is enforced', async () => {
      const signature = sign(payload);

      const result = await verifyWebhookSignature({
        secret,
        rawBody: payload,
        signature,
        tolerance: 300,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe('missing_timestamp');
    });

    it('rejects when timestamp is older than tolerance window', async () => {
      const signature = sign(payload);
      const now = 1_700_000_000;
      const expiredTimestamp = now - 600; // 10 minutes ago, tolerance is 5 minutes

      const result = await verifyWebhookSignature({
        secret,
        rawBody: payload,
        signature,
        timestamp: expiredTimestamp,
        tolerance: 300,
        now,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe('timestamp_out_of_tolerance');
    });

    it('rejects when timestamp is too far in the future', async () => {
      const signature = sign(payload);
      const now = 1_700_000_000;
      const futureTimestamp = now + 500; // 500s in the future

      const result = await verifyWebhookSignature({
        secret,
        rawBody: payload,
        signature,
        timestamp: futureTimestamp,
        tolerance: 300,
        now,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe('timestamp_out_of_tolerance');
    });

    it('accepts timestamps within tolerance window', async () => {
      const signature = sign(payload);
      const now = 1_700_000_000;
      const validTimestamp = now - 120; // 2 minutes ago

      const result = await verifyWebhookSignature({
        secret,
        rawBody: payload,
        signature,
        timestamp: validTimestamp,
        tolerance: 300,
        now,
      });

      expect(result.valid).toBe(true);
    });

    it('allows disabling timestamp tolerance with tolerance: 0', async () => {
      const signature = sign(payload);

      const result = await verifyWebhookSignature({
        secret,
        rawBody: payload,
        signature,
        tolerance: 0,
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('Replay tests and protection', () => {
    it('prevents replay attacks using replayCache', async () => {
      const replayCache = createReplayCache();
      const signature = sign(payload);
      const now = 1_700_000_000;

      // First delivery: succeeds and registers in cache
      const first = await verifyWebhookSignature({
        secret,
        rawBody: payload,
        signature,
        timestamp: now,
        replayCache,
        now,
      });
      expect(first.valid).toBe(true);

      // Replayed delivery: rejected as duplicate
      const second = await verifyWebhookSignature({
        secret,
        rawBody: payload,
        signature,
        timestamp: now,
        replayCache,
        now,
      });
      expect(second.valid).toBe(false);
      expect(second.error).toBe('replay_detected');
    });

    it('accepts distinct payloads and signatures with the same replayCache', async () => {
      const replayCache = createReplayCache();
      const now = 1_700_000_000;

      const payload1 = JSON.stringify({ id: 1 });
      const payload2 = JSON.stringify({ id: 2 });

      const sig1 = sign(payload1);
      const sig2 = sign(payload2);

      const res1 = await verifyWebhookSignature({
        secret,
        rawBody: payload1,
        signature: sig1,
        timestamp: now,
        replayCache,
        now,
      });
      const res2 = await verifyWebhookSignature({
        secret,
        rawBody: payload2,
        signature: sig2,
        timestamp: now,
        replayCache,
        now,
      });

      expect(res1.valid).toBe(true);
      expect(res2.valid).toBe(true);
    });
  });

  describe('assertWebhookSignature', () => {
    it('returns parsed payload on successful verification', async () => {
      const signature = sign(payload);
      const now = Math.floor(Date.now() / 1000);

      const data = await assertWebhookSignature<{ seq: number }>({
        secret,
        rawBody: payload,
        signature,
        timestamp: now,
      });

      expect(data.seq).toBe(42);
    });

    it('throws WebhookVerificationError with code on failure', async () => {
      await expect(
        assertWebhookSignature({
          secret,
          rawBody: payload,
          signature: 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
          tolerance: 0,
        })
      ).rejects.toThrow(WebhookVerificationError);

      try {
        await assertWebhookSignature({
          secret,
          rawBody: payload,
          signature: 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
          tolerance: 0,
        });
      } catch (err: any) {
        expect(err.code).toBe('signature_mismatch');
      }
    });
  });
});
