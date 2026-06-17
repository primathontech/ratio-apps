import type { ColumnType, Generated, Selectable } from 'kysely';

export interface BaseMerchantsTable {
  id: string;
  isActive: Generated<boolean>;
  installedAt: Generated<Date>;
  uninstalledAt: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

/** Constraint used by MerchantsService<DB>. Any module's Database must declare a `merchants` table conforming to BaseMerchantsTable. */
export interface DatabaseWithMerchants {
  merchants: BaseMerchantsTable;
}

export type MerchantRow = Selectable<BaseMerchantsTable>;
