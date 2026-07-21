import { create } from 'zustand';

interface MerchantState {
  token: string | null;
  setToken: (token: string | null) => void;
  clear: () => void;
}

export const useMerchantStore = create<MerchantState>((set) => ({
  token: null,
  setToken: (token) => set({ token }),
  clear: () => set({ token: null }),
}));
