import { describe, it, expect } from 'vitest';
import {
  createEventDecoder,
  decodeEventWithAbi,
  generateEventTypes,
  ContractMeta,
  RawEvent,
} from '../src/events.js';

describe('Generated event-type helpers from ABI metadata (#1085)', () => {
  const tokenAbi: ContractMeta = {
    name: 'ExampleToken',
    description: 'A SEP-41 token contract',
    version: 1,
    functions: [
      {
        name: 'transfer',
        description: 'Transfer tokens from sender to receiver',
        params: [
          { name: 'from', kind: 'Address', description: 'Sender address' },
          { name: 'to', kind: 'Address', description: 'Recipient address' },
          { name: 'amount', kind: 'i128', description: 'Transfer amount' },
        ],
      },
      {
        name: 'mint',
        description: 'Mint new tokens',
        params: [
          { name: 'to', kind: 'Address' },
          { name: 'amount', kind: 'i128' },
        ],
      },
      {
        name: 'balance',
        params: [{ name: 'id', kind: 'Address' }],
      },
    ],
  };

  describe('decodeEventWithAbi', () => {
    it('decodes known ABI function with named parameters', () => {
      const rawEvent: RawEvent = {
        contract_id: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        function: 'transfer',
        ledger: 12345,
        tx_hash: 'tx_hash_abc',
        seq: 1,
        raw_topics: ['transfer', 'G_SENDER', 'G_RECEIVER'],
        raw_data: '1000000',
        raw_xdr: 'AAAA...RAWXDR...',
        event_xdr: 'BBBB...EVENTXDR...',
        description: 'Human readable description',
      };

      const decoded = decodeEventWithAbi(rawEvent, tokenAbi);

      expect(decoded.function).toBe('transfer');
      expect(decoded.abi_match).toBe(true);
      expect(decoded.function_abi?.name).toBe('transfer');
      expect(decoded.args).toEqual({
        from: 'G_SENDER',
        to: 'G_RECEIVER',
        amount: '1000000',
      });
    });

    it('retains raw XDR access and raw event fields intact', () => {
      const rawEvent: RawEvent = {
        contract_id: 'C123',
        raw_topics: ['transfer', 'G1', 'G2'],
        raw_data: '500',
        raw_xdr: 'RAW_XDR_STRING_PAYLOAD',
        event_xdr: 'EVENT_XDR_BYTES_PAYLOAD',
        ledger: 999,
        tx_hash: '0xhash',
      };

      const decoded = decodeEventWithAbi(rawEvent, tokenAbi);

      // Raw XDR access MUST be preserved
      expect(decoded.raw_xdr).toBe('RAW_XDR_STRING_PAYLOAD');
      expect(decoded.event_xdr).toBe('EVENT_XDR_BYTES_PAYLOAD');
      expect(decoded.raw_topics).toEqual(['transfer', 'G1', 'G2']);
      expect(decoded.raw_data).toBe('500');
      expect(decoded.ledger).toBe(999);
      expect(decoded.tx_hash).toBe('0xhash');
    });

    it('retains unknown and future fields on the event', () => {
      const rawEvent: RawEvent = {
        contract_id: 'C123',
        function: 'transfer',
        raw_topics: ['transfer', 'G1', 'G2'],
        raw_data: '100',
        custom_metadata: { indexer_version: '2.5', partition: 4 },
        future_protocol_field: true,
        trace_id: 'trace-xyz-789',
      };

      const decoded = decodeEventWithAbi(rawEvent, tokenAbi);

      // Unknown fields must be preserved on decoded output
      expect(decoded['custom_metadata']).toEqual({ indexer_version: '2.5', partition: 4 });
      expect(decoded['future_protocol_field']).toBe(true);
      expect(decoded['trace_id']).toBe('trace-xyz-789');
    });

    it('retains excess / unknown positional parameters', () => {
      const rawEvent: RawEvent = {
        function: 'mint',
        // mint ABI expects 2 params (to, amount), but 4 values are provided
        raw_topics: ['mint', 'G_RECIPIENT', '500', 'extra_arg_1', 'extra_arg_2'],
      };

      const decoded = decodeEventWithAbi(rawEvent, tokenAbi);

      expect(decoded.abi_match).toBe(true);
      expect(decoded.args.to).toBe('G_RECIPIENT');
      expect(decoded.args.amount).toBe('500');
      expect((decoded.args as any)._unknown_params).toEqual(['extra_arg_1', 'extra_arg_2']);
    });

    it('handles unknown functions not defined in the ABI gracefully', () => {
      const rawEvent: RawEvent = {
        contract_id: 'C123',
        function: 'unregistered_function',
        raw_topics: ['unregistered_function', 'val1', 'val2'],
        raw_data: 'val3',
        raw_xdr: 'RAWXDR_UNKNOWN',
        custom_flag: 42,
      };

      const decoded = decodeEventWithAbi(rawEvent, tokenAbi);

      expect(decoded.function).toBe('unregistered_function');
      expect(decoded.abi_match).toBe(false);
      expect(decoded.function_abi).toBeUndefined();
      expect((decoded.args as any)._positional).toEqual(['val1', 'val2', 'val3']);
      expect(decoded.raw_xdr).toBe('RAWXDR_UNKNOWN');
      expect(decoded['custom_flag']).toBe(42);
    });

    it('handles raw_data formatted as JSON array', () => {
      const rawEvent: RawEvent = {
        function: 'transfer',
        raw_topics: ['transfer', 'G_FROM'],
        raw_data: JSON.stringify(['G_TO', '2500']),
      };

      const decoded = decodeEventWithAbi(rawEvent, tokenAbi);

      expect(decoded.args).toEqual({
        from: 'G_FROM',
        to: 'G_TO',
        amount: '2500',
      });
    });

    it('throws TypeError if event is not an object', () => {
      expect(() => decodeEventWithAbi(null as any, tokenAbi)).toThrow(TypeError);
      expect(() => decodeEventWithAbi(undefined as any, tokenAbi)).toThrow(TypeError);
    });
  });

  describe('createEventDecoder', () => {
    it('creates a reusable decoder instance with lookup methods', () => {
      const decoder = createEventDecoder(tokenAbi);

      expect(decoder.supportedFunctions).toEqual(['transfer', 'mint', 'balance']);
      expect(decoder.hasFunction('transfer')).toBe(true);
      expect(decoder.hasFunction('MINT')).toBe(true);
      expect(decoder.hasFunction('nonexistent')).toBe(false);

      const fnAbi = decoder.getFunctionAbi('transfer');
      expect(fnAbi?.params.length).toBe(3);

      const decoded = decoder.decode({
        function: 'mint',
        raw_topics: ['mint', 'G_ADDR'],
        raw_data: '1000',
      });

      expect(decoded.args.to).toBe('G_ADDR');
      expect(decoded.args.amount).toBe('1000');
    });

    it('works with FunctionAbi[] array directly', () => {
      const decoder = createEventDecoder(tokenAbi.functions);
      expect(decoder.supportedFunctions).toContain('transfer');
      expect(decoder.hasFunction('transfer')).toBe(true);
    });
  });

  describe('generateEventTypes', () => {
    it('generates TypeScript definitions with raw XDR access and open index signatures', () => {
      const tsCode = generateEventTypes(tokenAbi);

      // Contains namespace
      expect(tsCode).toContain('export namespace ExampleTokenEvents');

      // Contains transfer args interface
      expect(tsCode).toContain('export interface TransferArgs');
      expect(tsCode).toContain('from: string;');
      expect(tsCode).toContain('to: string;');
      expect(tsCode).toContain('amount: string | bigint | number;');
      expect(tsCode).toContain('[key: string]: unknown;');

      // Contains TransferEvent interface with raw XDR fields
      expect(tsCode).toContain('export interface TransferEvent');
      expect(tsCode).toContain("function: 'transfer';");
      expect(tsCode).toContain('raw_topics?: (string | unknown)[];');
      expect(tsCode).toContain('raw_data?: string | unknown;');
      expect(tsCode).toContain('raw_xdr?: string;');
      expect(tsCode).toContain('event_xdr?: string;');
      expect(tsCode).toContain('[key: string]: unknown;');

      // Contains EventMap
      expect(tsCode).toContain('export interface EventMap');
      expect(tsCode).toContain("'transfer': TransferArgs;");
      expect(tsCode).toContain("'mint': MintArgs;");
    });

    it('allows custom typeName option', () => {
      const tsCode = generateEventTypes(tokenAbi, { typeName: 'MyCustomToken' });
      expect(tsCode).toContain('export namespace MyCustomToken');
    });
  });
});
