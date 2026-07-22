import { NotFoundException } from '@nestjs/common';
import {
  appearanceSchema,
  type FormInput,
  formInputSchema,
} from '@ratio-app/shared/schemas/form-schema';
import { describe, expect, it } from 'vitest';
import type { KyselyClient } from '../../../../src/core/db/kysely-factory';
import type { FormsDatabase } from '../../../../src/modules/forms/db/types';
import { FormsService } from '../../../../src/modules/forms/forms/forms.service';

// biome-ignore lint/suspicious/noExplicitAny: test fake works on loose rows
type Row = Record<string, any>;
type Where = [string, string, unknown];

/**
 * In-memory mini-Kysely covering exactly the chains FormsService uses:
 * filtered selects (=, is, in), orderBy/limit/offset, a grouped countAll,
 * inserts, and updates (sql`CURRENT_TIMESTAMP(3)` applied as `new Date()`).
 */
function makeFakeHandle(seed: { forms?: Row[]; form_submissions?: Row[] } = {}) {
  const tables: Record<string, Row[]> = {
    forms: seed.forms ?? [],
    form_submissions: seed.form_submissions ?? [],
  };
  const inserts: Array<{ table: string; values: Row }> = [];
  const updates: Array<{ table: string; set: Row; wheres: Where[] }> = [];

  const matches = (row: Row, wheres: Where[]) =>
    wheres.every(([column, op, value]) => {
      if (op === '=') return row[column] === value;
      if (op === 'is') return value === null ? row[column] == null : row[column] === value;
      if (op === 'in') return (value as unknown[]).includes(row[column]);
      throw new Error(`fake db: unsupported operator ${op}`);
    });

  const isSqlExpression = (v: unknown) =>
    typeof v === 'object' && v !== null && !(v instanceof Date) && !Array.isArray(v);

  const db = {
    selectFrom(table: string) {
      const state = {
        wheres: [] as Where[],
        order: null as null | [string, string],
        limit: undefined as number | undefined,
        offset: 0,
        groupBy: null as string | null,
        aggAlias: null as string | null,
      };
      // biome-ignore lint/suspicious/noExplicitAny: chain fake
      const chain: any = {
        selectAll: () => chain,
        select: (arg: unknown) => {
          if (typeof arg === 'function') {
            const eb = {
              fn: {
                countAll: () => ({
                  as: (alias: string) => {
                    state.aggAlias = alias;
                    return { __agg: alias };
                  },
                }),
              },
            };
            arg(eb);
          }
          return chain;
        },
        where: (column: string, op: string, value: unknown) => {
          state.wheres.push([column, op, value]);
          return chain;
        },
        orderBy: (column: string, dir: string) => {
          state.order = [column, dir];
          return chain;
        },
        limit: (n: number) => {
          state.limit = n;
          return chain;
        },
        offset: (n: number) => {
          state.offset = n;
          return chain;
        },
        groupBy: (column: string) => {
          state.groupBy = column;
          return chain;
        },
        executeTakeFirst: async () => (await chain.execute())[0],
        execute: async () => {
          let rows = tables[table].filter((r) => matches(r, state.wheres));
          if (state.groupBy && state.aggAlias) {
            const groups = new Map<unknown, number>();
            for (const r of rows) {
              groups.set(r[state.groupBy], (groups.get(r[state.groupBy]) ?? 0) + 1);
            }
            return [...groups.entries()].map(([key, n]) => ({
              [state.groupBy as string]: key,
              [state.aggAlias as string]: n,
            }));
          }
          if (state.order) {
            const [column, dir] = state.order;
            rows = [...rows].sort((a, b) => {
              const cmp = a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0;
              return dir === 'desc' ? -cmp : cmp;
            });
          }
          return rows.slice(
            state.offset,
            state.limit === undefined ? undefined : state.offset + state.limit,
          );
        },
      };
      return chain;
    },
    insertInto(table: string) {
      // biome-ignore lint/suspicious/noExplicitAny: chain fake
      const chain: any = {
        values: (v: Row) => {
          inserts.push({ table, values: v });
          tables[table].push({ ...v });
          return chain;
        },
        execute: async () => [],
      };
      return chain;
    },
    updateTable(table: string) {
      const state = { set: {} as Row, wheres: [] as Where[] };
      // biome-ignore lint/suspicious/noExplicitAny: chain fake
      const chain: any = {
        set: (s: Row) => {
          state.set = s;
          return chain;
        },
        where: (column: string, op: string, value: unknown) => {
          state.wheres.push([column, op, value]);
          return chain;
        },
        execute: async () => {
          updates.push({ table, set: state.set, wheres: state.wheres });
          for (const row of tables[table]) {
            if (matches(row, state.wheres)) {
              for (const [k, v] of Object.entries(state.set)) {
                row[k] = isSqlExpression(v) ? new Date() : v;
              }
            }
          }
          return [];
        },
      };
      return chain;
    },
  };
  return {
    handle: { db } as unknown as KyselyClient<FormsDatabase>,
    tables,
    inserts,
    updates,
  };
}

/** Parsed (defaults applied) FormInput — what the ZodValidationPipe hands the service. */
const contactInput: FormInput = formInputSchema.parse({
  name: 'Contact us',
  schema: [
    { key: 'full_name', type: 'text', label: 'Full name', required: true },
    { key: 'email', type: 'email', label: 'Email', required: true },
    { key: 'message', type: 'textarea', label: 'Message' },
  ],
  submitLabel: 'Send',
  successMessage: 'Thanks!',
  spamProtection: 'recaptcha',
  notificationEmail: 'leads@merchant.example',
  webhookUrl: 'https://hooks.merchant.example/forms',
});

function seedFormRow(overrides: Row = {}): Row {
  return {
    id: 'form_seed1',
    merchantId: 'mer_A',
    name: 'Contact us',
    description: null,
    schemaJson: JSON.stringify(contactInput.schema),
    submitLabel: 'Send',
    successMessage: 'Thanks!',
    spamProtection: 'recaptcha',
    notificationEmail: 'leads@merchant.example',
    webhookUrl: 'https://hooks.merchant.example/forms',
    redirectUrl: null,
    status: 'inactive',
    deletedAt: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

describe('FormsService (TDD §3.1)', () => {
  it('create persists schema_json stringified, id = form_<random>, status inactive', async () => {
    const { handle, inserts } = makeFakeHandle();
    const service = new FormsService(handle);

    const created = await service.create('mer_A', contactInput);

    expect(created.id).toMatch(/^form_[A-Za-z0-9_-]+$/);
    expect(created.status).toBe('inactive');
    expect(inserts).toHaveLength(1);
    const values = inserts[0].values;
    expect(values.merchantId).toBe('mer_A');
    expect(values.status).toBe('inactive');
    expect(typeof values.schemaJson).toBe('string');
    expect(JSON.parse(values.schemaJson as string)).toEqual(contactInput.schema);
  });

  it('create mints unique ids (no collisions across calls)', async () => {
    const { handle } = makeFakeHandle();
    const service = new FormsService(handle);
    const ids = await Promise.all(
      Array.from({ length: 20 }, () => service.create('mer_A', contactInput).then((f) => f.id)),
    );
    expect(new Set(ids).size).toBe(20);
  });

  it('schema_json round-trips: stringified on write, parsed object on read', async () => {
    const { handle } = makeFakeHandle({ forms: [seedFormRow()] });
    const service = new FormsService(handle);

    const form = await service.getById('mer_A', 'form_seed1');

    expect(Array.isArray(form.schema)).toBe(true);
    expect(form.schema).toEqual(contactInput.schema);
  });

  it('update replaces schema_json and bumps updated_at', async () => {
    const { handle, updates } = makeFakeHandle({ forms: [seedFormRow()] });
    const service = new FormsService(handle);
    const newInput: FormInput = {
      ...contactInput,
      name: 'Contact us v2',
      schema: [
        { key: 'email', type: 'email', label: 'Email', required: true },
      ] as FormInput['schema'],
    };

    const updated = await service.update('mer_A', 'form_seed1', newInput);

    expect(updates).toHaveLength(1);
    const set = updates[0].set;
    expect(set.schemaJson).toBe(JSON.stringify(newInput.schema));
    expect(set.updatedAt).toBeDefined();
    expect(updated.name).toBe('Contact us v2');
    expect(updated.schema).toEqual(newInput.schema);
  });

  it('update of a deleted form → 404', async () => {
    const { handle } = makeFakeHandle({
      forms: [seedFormRow({ deletedAt: new Date() })],
    });
    const service = new FormsService(handle);
    await expect(service.update('mer_A', 'form_seed1', contactInput)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('cross-merchant access → 404 on every read/write path (multi-tenancy guard)', async () => {
    const { handle } = makeFakeHandle({ forms: [seedFormRow()] });
    const service = new FormsService(handle);

    await expect(service.getById('mer_B', 'form_seed1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update('mer_B', 'form_seed1', contactInput)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.softDelete('mer_B', 'form_seed1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.duplicate('mer_B', 'form_seed1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.setStatus('mer_B', 'form_seed1', 'active')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('delete is soft: sets deleted_at only, row retained', async () => {
    const { handle, tables, updates } = makeFakeHandle({ forms: [seedFormRow()] });
    const service = new FormsService(handle);

    await service.softDelete('mer_A', 'form_seed1');

    expect(tables.forms).toHaveLength(1); // no row removal
    expect(tables.forms[0].deletedAt).toBeInstanceOf(Date);
    expect(Object.keys(updates[0].set).sort()).toEqual(['deletedAt', 'updatedAt']);
    // Deleted form is gone from reads.
    await expect(service.getById('mer_A', 'form_seed1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('list excludes deleted forms, includes submission counts, newest first', async () => {
    const { handle } = makeFakeHandle({
      forms: [
        seedFormRow({ id: 'form_a', name: 'A', createdAt: new Date('2026-07-01T00:00:00Z') }),
        seedFormRow({ id: 'form_b', name: 'B', createdAt: new Date('2026-07-02T00:00:00Z') }),
        seedFormRow({
          id: 'form_gone',
          name: 'Deleted',
          deletedAt: new Date(),
          createdAt: new Date('2026-07-03T00:00:00Z'),
        }),
        seedFormRow({ id: 'form_other', merchantId: 'mer_B' }),
      ],
      form_submissions: [
        { id: 'sub_1', formId: 'form_a', merchantId: 'mer_A' },
        { id: 'sub_2', formId: 'form_a', merchantId: 'mer_A' },
        { id: 'sub_3', formId: 'form_other', merchantId: 'mer_B' },
      ],
    });
    const service = new FormsService(handle);

    const result = await service.list('mer_A');

    expect(result.forms.map((f) => f.id)).toEqual(['form_b', 'form_a']);
    expect(result.forms.find((f) => f.id === 'form_a')?.submissionCount).toBe(2);
    expect(result.forms.find((f) => f.id === 'form_b')?.submissionCount).toBe(0);
    expect(result.page).toBe(1);
    expect(result.hasMore).toBe(false);
  });

  it('list paginates (limit + page, hasMore flag)', async () => {
    const { handle } = makeFakeHandle({
      forms: [
        seedFormRow({ id: 'form_1', createdAt: new Date('2026-07-01T00:00:00Z') }),
        seedFormRow({ id: 'form_2', createdAt: new Date('2026-07-02T00:00:00Z') }),
        seedFormRow({ id: 'form_3', createdAt: new Date('2026-07-03T00:00:00Z') }),
      ],
    });
    const service = new FormsService(handle);

    const page1 = await service.list('mer_A', 1, 2);
    expect(page1.forms.map((f) => f.id)).toEqual(['form_3', 'form_2']);
    expect(page1.hasMore).toBe(true);

    const page2 = await service.list('mer_A', 2, 2);
    expect(page2.forms.map((f) => f.id)).toEqual(['form_1']);
    expect(page2.hasMore).toBe(false);
  });

  it('duplicate copies schema + metadata under a new id, status inactive, name suffixed " (copy)"', async () => {
    const { handle, inserts } = makeFakeHandle({
      forms: [seedFormRow({ status: 'active' })],
    });
    const service = new FormsService(handle);

    const copy = await service.duplicate('mer_A', 'form_seed1');

    expect(copy.id).not.toBe('form_seed1');
    expect(copy.id).toMatch(/^form_/);
    expect(copy.name).toBe('Contact us (copy)');
    expect(copy.status).toBe('inactive');
    expect(copy.schema).toEqual(contactInput.schema);
    const values = inserts[0].values;
    expect(values.status).toBe('inactive');
    expect(typeof values.schemaJson).toBe('string');
    expect(JSON.parse(values.schemaJson as string)).toEqual(contactInput.schema);
    expect(values.webhookUrl).toBe('https://hooks.merchant.example/forms');
    expect(values.notificationEmail).toBe('leads@merchant.example');
  });

  it('activate / deactivate toggle status (and 404 on deleted forms)', async () => {
    const { handle, tables } = makeFakeHandle({ forms: [seedFormRow()] });
    const service = new FormsService(handle);

    const activated = await service.setStatus('mer_A', 'form_seed1', 'active');
    expect(activated.status).toBe('active');
    expect(tables.forms[0].status).toBe('active');

    const deactivated = await service.setStatus('mer_A', 'form_seed1', 'inactive');
    expect(deactivated.status).toBe('inactive');
    expect(tables.forms[0].status).toBe('inactive');

    await service.softDelete('mer_A', 'form_seed1');
    await expect(service.setStatus('mer_A', 'form_seed1', 'active')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('FormsService — appearance / theming (§1.3)', () => {
  const themed: FormInput = formInputSchema.parse({
    ...contactInput,
    appearance: { colors: { primary: '#123456' } },
  });

  it('create persists appearance_json stringified and echoes it back', async () => {
    const { handle, inserts } = makeFakeHandle();
    const service = new FormsService(handle);

    const created = await service.create('mer_A', themed);

    const values = inserts[0].values;
    expect(typeof values.appearanceJson).toBe('string');
    expect(JSON.parse(values.appearanceJson as string)).toEqual(themed.appearance);
    expect(created.appearance).toEqual(themed.appearance);
  });

  it('un-themed create writes null appearance_json and omits appearance', async () => {
    const { handle, inserts } = makeFakeHandle();
    const service = new FormsService(handle);

    const created = await service.create('mer_A', contactInput);

    expect(inserts[0].values.appearanceJson).toBeNull();
    expect('appearance' in created).toBe(false);
  });

  it('appearance round-trips: stringified on write, parsed object on read', async () => {
    const appearance = appearanceSchema.parse({});
    const { handle } = makeFakeHandle({
      forms: [seedFormRow({ appearanceJson: JSON.stringify(appearance) })],
    });
    const service = new FormsService(handle);

    const form = await service.getById('mer_A', 'form_seed1');

    expect(form.appearance).toEqual(appearance);
  });

  it('reads with a null appearance_json leave appearance absent (today’s look)', async () => {
    const { handle } = makeFakeHandle({ forms: [seedFormRow({ appearanceJson: null })] });
    const service = new FormsService(handle);

    const form = await service.getById('mer_A', 'form_seed1');

    expect('appearance' in form).toBe(false);
  });

  it('update replaces appearance_json', async () => {
    const { handle, updates } = makeFakeHandle({ forms: [seedFormRow()] });
    const service = new FormsService(handle);

    const updated = await service.update('mer_A', 'form_seed1', themed);

    expect(updates[0].set.appearanceJson).toBe(JSON.stringify(themed.appearance));
    expect(updated.appearance).toEqual(themed.appearance);
  });

  it('update without appearance clears appearance_json to null', async () => {
    const { handle, updates } = makeFakeHandle({
      forms: [seedFormRow({ appearanceJson: JSON.stringify(appearanceSchema.parse({})) })],
    });
    const service = new FormsService(handle);

    const updated = await service.update('mer_A', 'form_seed1', contactInput);

    expect(updates[0].set.appearanceJson).toBeNull();
    expect('appearance' in updated).toBe(false);
  });

  it('duplicate copies the appearance_json column', async () => {
    const appearance = appearanceSchema.parse({});
    const { handle, inserts } = makeFakeHandle({
      forms: [seedFormRow({ appearanceJson: JSON.stringify(appearance) })],
    });
    const service = new FormsService(handle);

    const copy = await service.duplicate('mer_A', 'form_seed1');

    expect(JSON.parse(inserts[0].values.appearanceJson as string)).toEqual(appearance);
    expect(copy.appearance).toEqual(appearance);
  });
});

describe('FormsService — description / redirectUrl round-trip', () => {
  const withMeta: FormInput = formInputSchema.parse({
    ...contactInput,
    description: 'Reach the sales team',
    redirectUrl: 'https://merchant.example/thanks',
  });

  it('create persists description + redirect_url and echoes them back', async () => {
    const { handle, inserts } = makeFakeHandle();
    const service = new FormsService(handle);

    const created = await service.create('mer_A', withMeta);

    expect(inserts[0].values.description).toBe('Reach the sales team');
    expect(inserts[0].values.redirectUrl).toBe('https://merchant.example/thanks');
    expect(created.description).toBe('Reach the sales team');
    expect(created.redirectUrl).toBe('https://merchant.example/thanks');
  });

  it('create without either writes null and echoes null', async () => {
    const { handle, inserts } = makeFakeHandle();
    const service = new FormsService(handle);

    const created = await service.create('mer_A', contactInput);

    expect(inserts[0].values.description).toBeNull();
    expect(inserts[0].values.redirectUrl).toBeNull();
    expect(created.description).toBeNull();
    expect(created.redirectUrl).toBeNull();
  });

  it('round-trips on read: columns parsed straight back onto the entity', async () => {
    const { handle } = makeFakeHandle({
      forms: [
        seedFormRow({
          description: 'Reach the sales team',
          redirectUrl: 'https://merchant.example/thanks',
        }),
      ],
    });
    const service = new FormsService(handle);

    const form = await service.getById('mer_A', 'form_seed1');

    expect(form.description).toBe('Reach the sales team');
    expect(form.redirectUrl).toBe('https://merchant.example/thanks');
  });

  it('update replaces description + redirect_url', async () => {
    const { handle, updates } = makeFakeHandle({ forms: [seedFormRow()] });
    const service = new FormsService(handle);

    const updated = await service.update('mer_A', 'form_seed1', withMeta);

    expect(updates[0].set.description).toBe('Reach the sales team');
    expect(updates[0].set.redirectUrl).toBe('https://merchant.example/thanks');
    expect(updated.description).toBe('Reach the sales team');
    expect(updated.redirectUrl).toBe('https://merchant.example/thanks');
  });

  it('update without them clears both columns to null', async () => {
    const { handle, updates } = makeFakeHandle({
      forms: [seedFormRow({ description: 'old', redirectUrl: 'https://merchant.example/old' })],
    });
    const service = new FormsService(handle);

    const updated = await service.update('mer_A', 'form_seed1', contactInput);

    expect(updates[0].set.description).toBeNull();
    expect(updates[0].set.redirectUrl).toBeNull();
    expect(updated.description).toBeNull();
    expect(updated.redirectUrl).toBeNull();
  });

  it('duplicate copies both columns', async () => {
    const { handle, inserts } = makeFakeHandle({
      forms: [
        seedFormRow({
          description: 'Reach the sales team',
          redirectUrl: 'https://merchant.example/thanks',
        }),
      ],
    });
    const service = new FormsService(handle);

    const copy = await service.duplicate('mer_A', 'form_seed1');

    expect(inserts[0].values.description).toBe('Reach the sales team');
    expect(inserts[0].values.redirectUrl).toBe('https://merchant.example/thanks');
    expect(copy.description).toBe('Reach the sales team');
    expect(copy.redirectUrl).toBe('https://merchant.example/thanks');
  });
});
