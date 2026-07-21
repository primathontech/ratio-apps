import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { LoyaltyQrState } from '@ratio-app/shared/schemas/loyalty-claim';
import type { LoyaltyConfig } from '@ratio-app/shared/schemas/loyalty-config';
import { sql } from 'kysely';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { toBuffer } from 'qrcode';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { LoyaltyConfigService } from '../config/config.service';
import type { LoyaltyDatabase, LoyaltyQrCodeRow, LoyaltyQrScanRow } from '../db/types';
import { LOYALTY_DB_TOKEN } from '../kysely.module';

/**
 * QR campaign admin: CRUD, lifecycle state, printable posters (PNG via
 * `qrcode`, PDF via `pdf-lib`) and the storefront loader snippet.
 *
 * A QR encodes `{storefrontBaseUrl}/?loyalty_qr={code}` — the merchant's
 * storefront URL from config is REQUIRED before any QR can exist, so a poster
 * can never be printed against a dead link.
 */

const qrInputSchema = z
  .object({
    eventName: z.string().min(1).max(128),
    pointsPerScan: z.coerce.number().int().min(1).max(100_000),
    /** 0 = unlimited. */
    maxScans: z.coerce.number().int().min(0).default(0),
    startsAt: z.coerce.date(),
    expiresAt: z.coerce.date(),
    claimMessage: z.string().max(255).optional(),
  })
  .refine((v) => v.expiresAt.getTime() > v.startsAt.getTime(), {
    message: 'expiresAt must be after startsAt',
    path: ['expiresAt'],
  });

export type QrInput = z.infer<typeof qrInputSchema>;

const statusInputSchema = z.enum(['PAUSED', 'ACTIVE']);

const POSTER_SIZES = [300, 600, 1200] as const;
/** A4 in PDF points. */
const A4: [number, number] = [595.28, 841.89];

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Derived lifecycle state (pure — shared with the public claim controller).
 * Precedence: paused > not-yet-started > expired > fully-claimed > active.
 */
export function qrStateFor(
  row: Pick<LoyaltyQrCodeRow, 'status' | 'startsAt' | 'expiresAt' | 'maxScans' | 'scanCount'>,
  now: Date = new Date(),
): LoyaltyQrState {
  if (row.status === 'PAUSED') return 'paused';
  if (row.status === 'DRAFT' || now.getTime() < new Date(row.startsAt).getTime()) {
    return 'not_started';
  }
  if (row.status === 'EXPIRED' || now.getTime() > new Date(row.expiresAt).getTime()) {
    return 'expired';
  }
  if (row.maxScans > 0 && row.scanCount >= row.maxScans) return 'fully_claimed';
  return 'active';
}

@Injectable()
export class QrService {
  constructor(
    @Inject(LOYALTY_DB_TOKEN) private readonly handle: KyselyClient<LoyaltyDatabase>,
    private readonly config: LoyaltyConfigService,
  ) {}

  async create(
    merchantId: string,
    input: unknown,
  ): Promise<LoyaltyQrCodeRow & { claimUrl: string }> {
    const parsed = this.parseInput(input);
    const cfg = await this.requireStorefrontConfig(merchantId);

    const id = ulid();
    // 16-char uppercase code = the random tail of a second ULID (the first 10
    // chars are the timestamp — low entropy, so we slice past them).
    const code = ulid().slice(10).toUpperCase();
    const now = new Date();

    await this.handle.db
      .insertInto('loyalty_qr_codes')
      .values({
        id,
        merchantId,
        code,
        eventName: parsed.eventName,
        pointsPerScan: parsed.pointsPerScan,
        maxScans: parsed.maxScans,
        startsAt: parsed.startsAt,
        expiresAt: parsed.expiresAt,
        claimMessage: parsed.claimMessage ?? null,
        status: 'ACTIVE',
      })
      .execute();

    // MySQL has no RETURNING — compose the row in memory.
    const row: LoyaltyQrCodeRow = {
      id,
      merchantId,
      code,
      eventName: parsed.eventName,
      pointsPerScan: parsed.pointsPerScan,
      maxScans: parsed.maxScans,
      startsAt: parsed.startsAt,
      expiresAt: parsed.expiresAt,
      claimMessage: parsed.claimMessage ?? null,
      status: 'ACTIVE',
      scanCount: 0,
      newPhoneCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    return { ...row, claimUrl: this.claimUrl(row, cfg) };
  }

  async list(merchantId: string): Promise<(LoyaltyQrCodeRow & { state: LoyaltyQrState })[]> {
    const rows = await this.handle.db
      .selectFrom('loyalty_qr_codes')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .orderBy('createdAt', 'desc')
      .execute();
    return rows.map((row) => ({ ...row, state: qrStateFor(row) }));
  }

  /** Merchant-scoped read — a foreign or unknown id is indistinguishably 404. */
  async get(merchantId: string, id: string): Promise<LoyaltyQrCodeRow> {
    const row = await this.handle.db
      .selectFrom('loyalty_qr_codes')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .where('id', '=', id)
      .limit(1)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException({ message: 'QR code not found', error_code: 'QR_NOT_FOUND' });
    }
    return row;
  }

  /** Detail payload for the admin screen: row + claim URL + snippet + state. */
  async detail(
    merchantId: string,
    id: string,
  ): Promise<
    LoyaltyQrCodeRow & { state: LoyaltyQrState; claimUrl: string | null; loaderSnippet: string }
  > {
    const row = await this.get(merchantId, id);
    let claimUrl: string | null = null;
    try {
      claimUrl = this.claimUrl(row, await this.requireStorefrontConfig(merchantId));
    } catch {
      claimUrl = null; // storefront URL was removed after creation — degrade
    }
    return {
      ...row,
      state: qrStateFor(row),
      claimUrl,
      loaderSnippet: this.loaderSnippet(merchantId),
    };
  }

  async update(merchantId: string, id: string, input: unknown): Promise<LoyaltyQrCodeRow> {
    const parsed = this.parseInput(input);
    const existing = await this.get(merchantId, id);

    await this.handle.db
      .updateTable('loyalty_qr_codes')
      .set({
        eventName: parsed.eventName,
        pointsPerScan: parsed.pointsPerScan,
        maxScans: parsed.maxScans,
        startsAt: parsed.startsAt,
        expiresAt: parsed.expiresAt,
        claimMessage: parsed.claimMessage ?? null,
        updatedAt: sql<Date>`CURRENT_TIMESTAMP(3)`,
      })
      .where('merchantId', '=', merchantId)
      .where('id', '=', id)
      .execute();

    return {
      ...existing,
      eventName: parsed.eventName,
      pointsPerScan: parsed.pointsPerScan,
      maxScans: parsed.maxScans,
      startsAt: parsed.startsAt,
      expiresAt: parsed.expiresAt,
      claimMessage: parsed.claimMessage ?? null,
    };
  }

  async setStatus(merchantId: string, id: string, status: unknown): Promise<LoyaltyQrCodeRow> {
    const parsed = statusInputSchema.safeParse(status);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'status must be PAUSED or ACTIVE',
        error_code: 'INVALID_QR_STATUS',
      });
    }
    const existing = await this.get(merchantId, id);
    await this.handle.db
      .updateTable('loyalty_qr_codes')
      .set({ status: parsed.data, updatedAt: sql<Date>`CURRENT_TIMESTAMP(3)` })
      .where('merchantId', '=', merchantId)
      .where('id', '=', id)
      .execute();
    return { ...existing, status: parsed.data };
  }

  async scans(
    merchantId: string,
    qrId: string,
    page = 1,
    limit = DEFAULT_LIMIT,
  ): Promise<{ rows: LoyaltyQrScanRow[]; total: number; page: number; limit: number }> {
    await this.get(merchantId, qrId); // 404 scoping
    const safeLimit = Math.min(Math.max(1, Math.floor(limit) || DEFAULT_LIMIT), MAX_LIMIT);
    const safePage = Math.max(1, Math.floor(page) || 1);

    const [rows, countRow] = await Promise.all([
      this.handle.db
        .selectFrom('loyalty_qr_scans')
        .selectAll()
        .where('qrCodeId', '=', qrId)
        .orderBy('scannedAt', 'desc')
        .limit(safeLimit)
        .offset((safePage - 1) * safeLimit)
        .execute(),
      this.handle.db
        .selectFrom('loyalty_qr_scans')
        .select((eb) => eb.fn.countAll<number>().as('total'))
        .where('qrCodeId', '=', qrId)
        .executeTakeFirst(),
    ]);
    return {
      rows,
      total: Number((countRow as { total?: unknown } | undefined)?.total ?? 0),
      page: safePage,
      limit: safeLimit,
    };
  }

  /** The URL a QR encodes — the storefront loader picks up `?loyalty_qr=`. */
  claimUrl(row: Pick<LoyaltyQrCodeRow, 'code'>, cfg: LoyaltyConfig): string {
    const base = (cfg.storefrontBaseUrl ?? '').replace(/\/+$/, '');
    return `${base}/?loyalty_qr=${row.code}`;
  }

  /** Copy-paste `<script>` include for non-Shopkit storefronts. */
  loaderSnippet(merchantId: string): string {
    let origin = '';
    const callbackUrl = process.env.RATIO_LOYALTY_CALLBACK_URL ?? '';
    if (callbackUrl) {
      try {
        origin = new URL(callbackUrl).origin;
      } catch {
        origin = '';
      }
    }
    return `<script src="${origin}/loyalty/sdk/loyalty-loader.js?store=${merchantId}" defer></script>`;
  }

  async posterPng(merchantId: string, id: string, size: number): Promise<Buffer> {
    if (!POSTER_SIZES.includes(size as (typeof POSTER_SIZES)[number])) {
      throw new BadRequestException({
        message: `size must be one of ${POSTER_SIZES.join(', ')}`,
        error_code: 'INVALID_POSTER_SIZE',
      });
    }
    const row = await this.get(merchantId, id);
    const cfg = await this.requireStorefrontConfig(merchantId);
    return toBuffer(this.claimUrl(row, cfg), { width: size });
  }

  /** Print-ready A4 poster: event name + QR + points/program line. */
  async posterPdf(merchantId: string, id: string): Promise<Buffer> {
    const row = await this.get(merchantId, id);
    const cfg = await this.requireStorefrontConfig(merchantId);
    const png = await toBuffer(this.claimUrl(row, cfg), { width: 600 });

    const doc = await PDFDocument.create();
    const page = doc.addPage(A4);
    const [width, height] = A4;
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const regular = await doc.embedFont(StandardFonts.Helvetica);

    const title = row.eventName;
    const titleSize = 28;
    const titleWidth = bold.widthOfTextAtSize(title, titleSize);
    page.drawText(title, {
      x: Math.max(40, (width - titleWidth) / 2),
      y: height - 110,
      size: titleSize,
      font: bold,
      color: rgb(0.1, 0.1, 0.12),
      maxWidth: width - 80,
    });

    const image = await doc.embedPng(png);
    const imageSize = 380;
    page.drawImage(image, {
      x: (width - imageSize) / 2,
      y: (height - imageSize) / 2,
      width: imageSize,
      height: imageSize,
    });

    const caption = `Scan to earn ${row.pointsPerScan} ${cfg.programName}`;
    const captionSize = 18;
    const captionWidth = regular.widthOfTextAtSize(caption, captionSize);
    page.drawText(caption, {
      x: Math.max(40, (width - captionWidth) / 2),
      y: (height - imageSize) / 2 - 60,
      size: captionSize,
      font: regular,
      color: rgb(0.25, 0.25, 0.28),
    });

    return Buffer.from(await doc.save());
  }

  private parseInput(input: unknown): QrInput {
    const parsed = qrInputSchema.safeParse(input ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'validation failed',
        error_code: 'INVALID_REQUEST_BODY',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    return parsed.data;
  }

  /** QR links are minted against the storefront URL — no URL, no QR. */
  private async requireStorefrontConfig(
    merchantId: string,
  ): Promise<LoyaltyConfig & { storefrontBaseUrl: string }> {
    let cfg: LoyaltyConfig | undefined;
    try {
      cfg = await this.config.getByMerchantId(merchantId);
    } catch (err) {
      if (!(err instanceof NotFoundException)) throw err;
    }
    if (!cfg?.storefrontBaseUrl) {
      throw new UnprocessableEntityException({
        message: 'set your storefront URL in Settings before working with QR codes',
        error_code: 'STOREFRONT_URL_REQUIRED',
      });
    }
    return cfg as LoyaltyConfig & { storefrontBaseUrl: string };
  }
}
