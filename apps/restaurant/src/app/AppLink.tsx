import type { LinkProps } from "@kade/ui";
import { Link as RouterLink } from "react-router";

/**
 * Lets @kade/ui navigate with React Router. Internal paths ("/restaurant/1") use client-side routing;
 * hash-only, external and mailto links stay plain anchors.
 */
export function AppLink({ href, ref, ...rest }: LinkProps & { ref?: React.Ref<HTMLAnchorElement> }) {
  if (!href.startsWith("/")) return <a ref={ref} href={href} {...rest} />;
  return <RouterLink ref={ref} to={href} {...rest} />;
}
