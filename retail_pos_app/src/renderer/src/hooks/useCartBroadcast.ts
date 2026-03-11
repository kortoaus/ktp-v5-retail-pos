import { useEffect } from "react";
import { useSalesStore } from "../store/salesStore";

const CHANNEL_NAME = "pos-cart";

export function useCartBroadcast(): void {
  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    const unsubscribe = useSalesStore.subscribe((state) => {
      channel.postMessage({
        carts: state.carts,
        activeCartIndex: state.activeCartIndex,
        lineOffset: state.lineOffset,
      });
    });
    return () => {
      unsubscribe();
      channel.close();
    };
  }, []);
}
