export const DISABLED_ROUTE = '/disabled';

export type MerchantGate =
  | { kind: 'checking' }
  | { kind: 'embed-blocked'; parentOrigin: string | null }
  | { kind: 'no-session' }
  | { kind: 'invalid'; errorCode: string | undefined }
  | { kind: 'disabled' }
  | { kind: 'ready' };

export interface MerchantGateInput {
  isAuthorized: boolean | null;
  parentOrigin: string | null;
  sessionChecked: boolean;
  token: string | null;
  merchant: {
    isLoading: boolean;
    isError: boolean;
    errorCode?: string | undefined;
    isActive?: boolean | undefined;
    hasData: boolean;
  };
}

export function resolveMerchantGate(input: MerchantGateInput): MerchantGate {
  const { isAuthorized, parentOrigin, sessionChecked, token, merchant } = input;

  if (isAuthorized === null) return { kind: 'checking' };
  if (!isAuthorized) return { kind: 'embed-blocked', parentOrigin };
  if (!sessionChecked) return { kind: 'checking' };
  if (!token) return { kind: 'no-session' };
  if (merchant.isLoading) return { kind: 'checking' };
  if (merchant.isError) return { kind: 'invalid', errorCode: merchant.errorCode };
  if (merchant.hasData && merchant.isActive !== true) return { kind: 'disabled' };
  if (!merchant.hasData) return { kind: 'checking' };
  return { kind: 'ready' };
}
