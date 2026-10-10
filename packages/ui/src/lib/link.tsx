import {
  createContext,
  forwardRef,
  useContext,
  type AnchorHTMLAttributes,
  type ComponentType,
  type ReactNode,
  type Ref,
} from "react";

export type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

/**
 * The design system never imports a router. Apps pass their router's link (adapted to take `href`)
 * through <UIProvider linkComponent={...}>, and every UI component that navigates renders it.
 */
const LinkContext = createContext<ComponentType<LinkProps & { ref?: Ref<HTMLAnchorElement> }> | null>(null);

export function UIProvider({
  linkComponent,
  children,
}: {
  linkComponent: ComponentType<LinkProps & { ref?: Ref<HTMLAnchorElement> }>;
  children: ReactNode;
}) {
  return <LinkContext.Provider value={linkComponent}>{children}</LinkContext.Provider>;
}

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(props, ref) {
  const Custom = useContext(LinkContext);
  // The app provides this component once via UIProvider; its identity is stable across renders.
  // eslint-disable-next-line react-hooks/static-components
  if (Custom) return <Custom ref={ref} {...props} />;
  return <a ref={ref} {...props} />;
});
