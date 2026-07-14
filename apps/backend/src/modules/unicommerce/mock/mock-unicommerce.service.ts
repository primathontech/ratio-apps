import { Injectable } from '@nestjs/common';

export interface UcFacility {
  code: string;
  name: string;
  address: string;
  active: boolean;
}

export interface UcOrderItem {
  itemSku: string;
  unitPrice: number;
  discount: number;
  quantity: number;
  facilityCode: string;
}

export interface UcCreateOrderResponse {
  successful: boolean;
  saleOrderCode: string;
  errors?: string[];
}

export interface UcCancelOrderResponse {
  successful: boolean;
  errors?: string[];
}

export interface UcShippingPackage {
  code: string;
  saleOrderCode: string;
  status: string;
  trackingNumber: string | null;
  courierName: string | null;
  updatedAt: string;
}

export interface UcShippingPackageSearchResponse {
  successful: boolean;
  shippingPackages: UcShippingPackage[];
}

export interface UcInventoryItem {
  itemTypeSKU: string;
  inventory: number;
  openSale: number;
  facilityCode: string;
}

export interface UcInventorySnapshotResponse {
  successful: boolean;
  inventorySnapshots: UcInventoryItem[];
}

export interface UcTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface UcFacilitiesResponse {
  successful: boolean;
  facilities: UcFacility[];
}

@Injectable()
export class MockUnicommerceService {
  private readonly orders = new Map<string, { status: string; items: UcOrderItem[] }>();
  private readonly packages = new Map<string, UcShippingPackage[]>();
  private readonly inventory = new Map<string, UcInventoryItem>();
  private readonly facilities: UcFacility[] = [
    { code: 'FAC-MUM-01', name: 'Mumbai Warehouse', address: 'Andheri East, Mumbai, MH', active: true },
    { code: 'FAC-DEL-02', name: 'Delhi Warehouse', address: 'Okhla Phase 2, New Delhi, DL', active: true },
    { code: 'FAC-BLR-03', name: 'Bangalore Warehouse', address: 'Whitefield, Bangalore, KA', active: true },
  ];
  private tokenIndex = 0;

  private readonly mockInventory: Record<string, { inventory: number; openSale: number }> = {
    'RAT-WHEY-1KG': { inventory: 250, openSale: 12 },
    'RAT-WHEY-2KG': { inventory: 180, openSale: 8 },
    'RAT-COLLAGEN-30': { inventory: 0, openSale: 0 },
    'RAT-PROTEIN-500G': { inventory: 500, openSale: 25 },
    'RAT-MASS-3KG': { inventory: 75, openSale: 3 },
    'RAT-CREATINE-300G': { inventory: 340, openSale: 15 },
    'RAT-BCAA-200G': { inventory: 420, openSale: 10 },
    'SKU-HYDRA-50ML': { inventory: 142, openSale: 8 },
    'WV-PROTEIN-1KG': { inventory: 300, openSale: 20 },
  };

  async exchangeToken(tenant: string, username: string, password: string): Promise<UcTokenResponse> {
    this.tokenIndex++;
    if (!username || !password) {
      throw new Error('UC_AUTH_FAILED');
    }
    return {
      access_token: `mock-uc-token-${tenant}-${this.tokenIndex}`,
      refresh_token: `mock-uc-refresh-${tenant}-${this.tokenIndex}`,
      expires_in: 3600,
      token_type: 'bearer',
    };
  }

  async refreshToken(tenant: string, refreshToken: string): Promise<UcTokenResponse> {
    this.tokenIndex++;
    return {
      access_token: `mock-uc-token-${tenant}-${this.tokenIndex}`,
      refresh_token: refreshToken,
      expires_in: 3600,
      token_type: 'bearer',
    };
  }

  async getFacilities(tenant: string, _token: string): Promise<UcFacilitiesResponse> {
    return {
      successful: true,
      facilities: this.facilities,
    };
  }

  async createSaleOrder(
    tenant: string,
    _token: string,
    saleOrder: Record<string, unknown>,
  ): Promise<UcCreateOrderResponse> {
    const code = saleOrder.code as string;
    const items = (saleOrder as any)?.saleOrderItems as UcOrderItem[] | undefined;

    const skuErrors: string[] = [];
    if (items) {
      for (const item of items) {
        const inv = this.mockInventory[item.itemSku];
        if (!inv || inv.inventory === 0) {
          skuErrors.push(`SKU "${item.itemSku}" not found in Unicommerce`);
        }
      }
    }

    if (skuErrors.length > 0) {
      return { successful: false, saleOrderCode: '', errors: skuErrors };
    }

    const ucCode = `UC-${String(Math.floor(10000 + Math.random() * 90000))}`;
    this.orders.set(ucCode, { status: 'CREATED', items: items ?? [] });
    this.orders.set(code, { status: 'CREATED', items: items ?? [] });

    return { successful: true, saleOrderCode: ucCode };
  }

  async cancelSaleOrder(
    tenant: string,
    _token: string,
    saleOrderCode: string,
  ): Promise<UcCancelOrderResponse> {
    const order = this.orders.get(saleOrderCode);
    if (!order) {
      return { successful: false, errors: ['Order not found in Unicommerce'] };
    }
    if (order.status === 'DISPATCHED' || order.status === 'SHIPPED') {
      return { successful: false, errors: ['Order cannot be cancelled — already dispatched'] };
    }
    order.status = 'CANCELLED';
    return { successful: true };
  }

  async searchShippingPackages(
    tenant: string,
    _token: string,
    updatedSinceInMinutes: number,
  ): Promise<UcShippingPackageSearchResponse> {
    const results: UcShippingPackage[] = [];
    for (const [ucCode, order] of this.orders) {
      if (ucCode.startsWith('UC-') && order.status !== 'CREATED') {
        results.push({
          code: `PKG-${ucCode}`,
          saleOrderCode: ucCode,
          status: order.status === 'CANCELLED' ? 'CANCELLED' : 'DISPATCHED',
          trackingNumber: order.status === 'DISPATCHED' || order.status === 'SHIPPED'
            ? `DELHIVERY-${Math.random().toString(36).slice(2, 10).toUpperCase()}`
            : null,
          courierName: order.status === 'DISPATCHED' || order.status === 'SHIPPED' ? 'Delhivery' : null,
          updatedAt: new Date().toISOString(),
        });
      }
    }
    return { successful: true, shippingPackages: results };
  }

  async getInventorySnapshot(
    tenant: string,
    _token: string,
    _updatedSinceInMinutes: number,
  ): Promise<UcInventorySnapshotResponse> {
    const snapshots: UcInventoryItem[] = Object.entries(this.mockInventory).map(
      ([sku, data]) => ({
        itemTypeSKU: sku,
        inventory: data.inventory,
        openSale: data.openSale,
        facilityCode: 'FAC-MUM-01',
      }),
    );
    return { successful: true, inventorySnapshots: snapshots };
  }

  async checkSkusExist(tenant: string, _token: string, skus: string[]): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {};
    for (const sku of skus) {
      result[sku] = !!this.mockInventory[sku] && this.mockInventory[sku].inventory > 0;
    }
    return result;
  }

  simulateDispatch(saleOrderCode: string): void {
    const order = this.orders.get(saleOrderCode);
    if (order) {
      order.status = 'DISPATCHED';
    }
  }
}
