import { Button, Container, EmptyState } from "@kade/ui";
import { AlsoAdded } from "@/features/cart/AlsoAdded";
import { CartContents, CheckoutButton } from "@/features/cart/CartContents";
import { useCart, useCartTotals } from "@/features/cart/store";
import { SiteHeader } from "@/layout/SiteHeader";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./CartPage.module.css";

/** Full-page cart: what phones open from the Cart button and the "View order" bar. */
export function CartPage() {
  useDocumentTitle("Your cart");
  const restaurant = useCart((s) => s.restaurant);
  const { count } = useCartTotals();

  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container className={styles.page}>
          <h1 className={styles.title}>Your cart</h1>
          {count && restaurant ? (
            <div>
              <div>
                <CartContents />
                <Button href={`/restaurant/${restaurant.id}`} variant="outline" size="sm" icon="plus">
                  Add more from {restaurant.name}
                </Button>
                <AlsoAdded restaurant={restaurant} />
              </div>
              <div className={styles.checkout}>
                <CheckoutButton />
              </div>
            </div>
          ) : (
            <EmptyState
              title="Your cart is empty"
              description="Find a restaurant near you and add a dish. It'll show up here."
              action={<Button href="/">Browse restaurants</Button>}
            />
          )}
        </Container>
      </main>
    </>
  );
}
