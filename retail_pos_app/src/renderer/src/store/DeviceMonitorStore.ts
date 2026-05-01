import { create } from "zustand";

interface DeviceMonitorStoreState {
  lastScannedBarcode: string | null;
  setLastScannedBarcode: (barcode: string) => void;
}

export const useDeviceMonitorStore = create<DeviceMonitorStoreState>()(
  (set) => ({
    lastScannedBarcode: null,
    setLastScannedBarcode: (barcode) => set({ lastScannedBarcode: barcode }),
  }),
);
