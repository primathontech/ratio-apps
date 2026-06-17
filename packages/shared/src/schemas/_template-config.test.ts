import { describe, expect, it } from 'vitest';
import {
  _templateApiKeySchema,
  _templateConfigSchema,
  _templateHostSchema,
} from './_template-config';
import { buildDefaultEventMap } from './event-map';

describe('_template-config schemas', () => {
  it('accepts any non-empty API key', () => {
    expect(_templateApiKeySchema.safeParse('my-api-key').success).toBe(true);
  });

  it('rejects an empty API key', () => {
    expect(_templateApiKeySchema.safeParse('').success).toBe(false);
  });

  it('requires https host', () => {
    expect(_templateHostSchema.safeParse('https://us.example.com').success).toBe(true);
    expect(_templateHostSchema.safeParse('http://template.local').success).toBe(false);
    expect(_templateHostSchema.safeParse('not-a-url').success).toBe(false);
  });

  it('parses full config with defaults', () => {
    const result = _templateConfigSchema.safeParse({
      apiKey: 'my-api-key',
      host: 'https://eu.example.com',
      debug: false,
      events: buildDefaultEventMap(),
    });
    expect(result.success).toBe(true);
  });
});
