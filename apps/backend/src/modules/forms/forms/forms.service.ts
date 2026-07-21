import { randomBytes } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { FormAppearance, FormField, FormInput } from '@ratio-app/shared/schemas/form-schema';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { FormRow, FormSpamProtection, FormStatus, FormsDatabase } from '../db/types';
import { FORMS_DB_TOKEN } from '../kysely.module';

/** A form as the admin API returns it (schema parsed back to objects). */
export interface FormEntity {
  id: string;
  name: string;
  description: string | null;
  schema: FormField[];
  appearance?: FormAppearance;
  submitLabel: string;
  successMessage: string;
  spamProtection: FormSpamProtection;
  notificationEmail: string | null;
  webhookUrl: string | null;
  redirectUrl: string | null;
  status: FormStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface FormListItem {
  id: string;
  name: string;
  status: FormStatus;
  submissionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FormListResult {
  forms: FormListItem[];
  page: number;
  limit: number;
  hasMore: boolean;
}

/**
 * Form CRUD (TRD §2): create / list / detail / update / soft-delete /
 * activate / deactivate / duplicate. EVERY query is merchant-scoped — a
 * cross-merchant id is indistinguishable from a missing one (404), which is
 * the multi-tenancy guard.
 *
 * `schema_json` is stringified explicitly on write (mysql2 does not
 * auto-serialize into JSON columns) and parsed on read.
 */
@Injectable()
export class FormsService {
  constructor(@Inject(FORMS_DB_TOKEN) private readonly handle: KyselyClient<FormsDatabase>) {}

  async create(merchantId: string, input: FormInput): Promise<FormEntity> {
    const id = FormsService.mintId();
    const description = input.description ?? null;
    const notificationEmail = input.notificationEmail ?? null;
    const webhookUrl = input.webhookUrl ?? null;
    const redirectUrl = input.redirectUrl ?? null;
    await this.handle.db
      .insertInto('forms')
      .values({
        id,
        merchantId,
        name: input.name,
        description,
        schemaJson: JSON.stringify(input.schema),
        appearanceJson: input.appearance ? JSON.stringify(input.appearance) : null,
        submitLabel: input.submitLabel,
        successMessage: input.successMessage,
        spamProtection: input.spamProtection,
        notificationEmail,
        webhookUrl,
        redirectUrl,
        status: 'inactive',
      })
      .execute();
    // Compose in memory (no RETURNING in MySQL); timestamps are "now" within
    // clock skew of the DB defaults — callers needing exact values re-GET.
    const now = new Date();
    return {
      id,
      name: input.name,
      description,
      schema: input.schema,
      ...(input.appearance ? { appearance: input.appearance } : {}),
      submitLabel: input.submitLabel,
      successMessage: input.successMessage,
      spamProtection: input.spamProtection,
      notificationEmail,
      webhookUrl,
      redirectUrl,
      status: 'inactive',
      createdAt: now,
      updatedAt: now,
    };
  }

  async list(merchantId: string, page = 1, limit = 20): Promise<FormListResult> {
    const offset = (page - 1) * limit;
    // Fetch one extra row to derive hasMore without a COUNT query.
    const rows = await this.handle.db
      .selectFrom('forms')
      .select(['id', 'name', 'status', 'createdAt', 'updatedAt'])
      .where('merchantId', '=', merchantId)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'desc')
      .limit(limit + 1)
      .offset(offset)
      .execute();
    const pageRows = rows.slice(0, limit);

    const counts = new Map<string, number>();
    if (pageRows.length > 0) {
      const countRows = await this.handle.db
        .selectFrom('form_submissions')
        .select(['formId'])
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where(
          'formId',
          'in',
          pageRows.map((r) => r.id),
        )
        .groupBy('formId')
        .execute();
      for (const row of countRows) {
        counts.set(row.formId, Number(row.count));
      }
    }

    return {
      forms: pageRows.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        submissionCount: counts.get(row.id) ?? 0,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      page,
      limit,
      hasMore: rows.length > limit,
    };
  }

  async getById(merchantId: string, id: string): Promise<FormEntity> {
    const row = (await this.findScoped(merchantId, id)) ?? this.notFound();
    return this.toEntity(row);
  }

  async update(merchantId: string, id: string, input: FormInput): Promise<FormEntity> {
    const existing = (await this.findScoped(merchantId, id)) ?? this.notFound();
    const description = input.description ?? null;
    const notificationEmail = input.notificationEmail ?? null;
    const webhookUrl = input.webhookUrl ?? null;
    const redirectUrl = input.redirectUrl ?? null;
    await this.handle.db
      .updateTable('forms')
      .set({
        name: input.name,
        description,
        schemaJson: JSON.stringify(input.schema),
        appearanceJson: input.appearance ? JSON.stringify(input.appearance) : null,
        submitLabel: input.submitLabel,
        successMessage: input.successMessage,
        spamProtection: input.spamProtection,
        notificationEmail,
        webhookUrl,
        redirectUrl,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .where('id', '=', id)
      .where('merchantId', '=', merchantId)
      .execute();
    return {
      id,
      name: input.name,
      description,
      schema: input.schema,
      ...(input.appearance ? { appearance: input.appearance } : {}),
      submitLabel: input.submitLabel,
      successMessage: input.successMessage,
      spamProtection: input.spamProtection,
      notificationEmail,
      webhookUrl,
      redirectUrl,
      status: existing.status,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
  }

  /** Soft delete: sets `deleted_at` only — submissions stay export-queryable. */
  async softDelete(merchantId: string, id: string): Promise<void> {
    (await this.findScoped(merchantId, id)) ?? this.notFound();
    await this.handle.db
      .updateTable('forms')
      .set({
        deletedAt: sql`CURRENT_TIMESTAMP(3)`,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .where('id', '=', id)
      .where('merchantId', '=', merchantId)
      .execute();
  }

  async setStatus(merchantId: string, id: string, status: FormStatus): Promise<FormEntity> {
    const existing = (await this.findScoped(merchantId, id)) ?? this.notFound();
    await this.handle.db
      .updateTable('forms')
      .set({ status, updatedAt: sql`CURRENT_TIMESTAMP(3)` })
      .where('id', '=', id)
      .where('merchantId', '=', merchantId)
      .execute();
    return { ...this.toEntity(existing), status, updatedAt: new Date() };
  }

  /** Copy schema + metadata under a new id; the copy starts inactive. */
  async duplicate(merchantId: string, id: string): Promise<FormEntity> {
    const source = (await this.findScoped(merchantId, id)) ?? this.notFound();
    const copyId = FormsService.mintId();
    const schemaJson =
      typeof source.schemaJson === 'string' ? source.schemaJson : JSON.stringify(source.schemaJson);
    const appearanceJson =
      source.appearanceJson == null || typeof source.appearanceJson === 'string'
        ? source.appearanceJson
        : JSON.stringify(source.appearanceJson);
    const name = `${source.name} (copy)`;
    await this.handle.db
      .insertInto('forms')
      .values({
        id: copyId,
        merchantId,
        name,
        description: source.description,
        schemaJson,
        appearanceJson,
        submitLabel: source.submitLabel,
        successMessage: source.successMessage,
        spamProtection: source.spamProtection,
        notificationEmail: source.notificationEmail,
        webhookUrl: source.webhookUrl,
        redirectUrl: source.redirectUrl,
        status: 'inactive',
      })
      .execute();
    const now = new Date();
    return {
      ...this.toEntity(source),
      id: copyId,
      name,
      status: 'inactive',
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Merchant-scoped, soft-delete-aware point read. */
  private async findScoped(merchantId: string, id: string): Promise<FormRow | undefined> {
    return this.handle.db
      .selectFrom('forms')
      .selectAll()
      .where('id', '=', id)
      .where('merchantId', '=', merchantId)
      .where('deletedAt', 'is', null)
      .limit(1)
      .executeTakeFirst();
  }

  private toEntity(row: FormRow): FormEntity {
    const appearance = FormsService.parseAppearance(row.appearanceJson);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      schema: FormsService.parseSchema(row.schemaJson),
      ...(appearance ? { appearance } : {}),
      submitLabel: row.submitLabel,
      successMessage: row.successMessage,
      spamProtection: row.spamProtection,
      notificationEmail: row.notificationEmail,
      webhookUrl: row.webhookUrl,
      redirectUrl: row.redirectUrl,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** mysql2 usually parses JSON columns; older paths may hand back strings. */
  private static parseSchema(value: FormField[] | string): FormField[] {
    return typeof value === 'string' ? (JSON.parse(value) as FormField[]) : value;
  }

  /** Nullable twin of parseSchema — `undefined` for un-themed forms. */
  private static parseAppearance(
    value: FormAppearance | string | null,
  ): FormAppearance | undefined {
    if (value == null) return undefined;
    return typeof value === 'string' ? (JSON.parse(value) as FormAppearance) : value;
  }

  /** `form_<random>` via node:crypto (never Math.random). */
  private static mintId(): string {
    return `form_${randomBytes(12).toString('base64url')}`;
  }

  private notFound(): never {
    throw new NotFoundException({
      message: 'form not found',
      error_code: 'FORM_NOT_FOUND',
    });
  }
}
