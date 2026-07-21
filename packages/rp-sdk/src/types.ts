export interface RpConfig {
  store: string;
  apiUrl: string;
  channel?: number;
  primaryColor?: string;
}

export interface RpLineItem {
  id: number;
  title: string;
  quantity: number;
  price: string;
  fulfillment_status: string;
  returnable: boolean;
  exchangeable: boolean;
  image?: string;
  sku?: string;
  variant_title?: string;
  product_id?: number;
  variant_id?: number;
}

export interface RpExchangeVariant {
  id: number;
  title: string;
  price: string | number;
  available?: boolean;
}

export interface RpExchangeProduct {
  id: number;
  title: string;
  image?: string;
  variants: RpExchangeVariant[];
}

export interface RpOrder {
  id: number;
  name: string;
  email: string;
  currency: string;
}

export interface RpReason {
  _id: string;
  reason: string;
  refund_mode: {
    prepaid: {
      store_credit: boolean;
      pay_to_source: boolean;
      bank_transfer: boolean;
      default: string;
    };
  };
}

export interface SelectedItem {
  lineItem: RpLineItem;
  reasonId: string;
  reasonText: string;
  comment: string;
  refundMode: string;
  type: 'return' | 'exchange';
  exchangeProductId?: number | undefined;
  exchangeVariantId?: number | undefined;
  exchangeLabel?: string | undefined;
}
