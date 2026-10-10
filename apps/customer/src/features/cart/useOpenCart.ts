import { useNavigate } from "react-router";
import { useCart } from "./store";

/** Phones get the full cart page; wider screens get the drawer over the current page. */
export function useOpenCart() {
  const navigate = useNavigate();
  const setDrawerOpen = useCart((s) => s.setDrawerOpen);
  return () => {
    if (window.matchMedia("(max-width: 640px)").matches) navigate("/cart");
    else setDrawerOpen(true);
  };
}
