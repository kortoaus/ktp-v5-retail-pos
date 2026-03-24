import { useEffect } from "react";
import { useNewSalesStore } from "../store/newSalesStore";

const CHANNEL_NAME = "pos-cart";

export function useCartBroadcast(): void {
  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    const unsubscribe = useNewSalesStore.subscribe((state) => {
      channel.postMessage({
        carts: state.carts,
        activeCartIndex: state.activeCartIndex,
        lineOffset: state.lineOffset,
        promotions: state.promotions,
      });
    });
    return () => {
      unsubscribe();
      channel.close();
    };
  }, []);
}
