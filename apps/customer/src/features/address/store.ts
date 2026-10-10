// The address everything delivers to: shown in the header, used by checkout. Saved on this device;
// the list of saved addresses itself comes from api/addresses.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defaultAddresses } from "@/api/addresses";
import type { SavedAddress } from "@/api/types";

interface AddressState {
  current: SavedAddress;
  setCurrent: (address: SavedAddress) => void;
  /** Not persisted: whether the address picker is open. */
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
}

export const useAddress = create<AddressState>()(
  persist(
    (set) => ({
      current: defaultAddresses[0]!,
      setCurrent: (current) => set({ current }),
      pickerOpen: false,
      setPickerOpen: (pickerOpen) => set({ pickerOpen }),
    }),
    { name: "kade.address.v1", partialize: ({ current }) => ({ current }) },
  ),
);
