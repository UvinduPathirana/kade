package lk.kade.payment.access;

import java.util.Set;
import lk.kade.payment.error.ServiceException;
import lk.kade.payment.grpc.Caller;

/**
 * Who may do what, from the gateway-asserted identity (CONVENTIONS "Auth"). A call without {@code x-user-id} is a
 * trusted service-to-service call (order's saga, ledger); gateways always set it for people.
 */
public final class Access {

    /** Kadé staff who may see and act on any customer's payments. */
    public static final Set<String> STAFF = Set.of("ops", "finance", "support", "admin");
    /** Staff who may move money by hand (corrections, refunds). */
    public static final Set<String> MONEY_STAFF = Set.of("ops", "finance", "admin");

    private Access() {}

    public static boolean internal(Caller caller) {
        return !caller.authenticated();
    }

    public static boolean staff(Caller caller) {
        return caller.roles().stream().anyMatch(STAFF::contains);
    }

    /** Payment mutations: the order saga (service call) or money staff. Customers never move money directly. */
    public static void requireMoneyMover(Caller caller) {
        if (internal(caller) || caller.roles().stream().anyMatch(MONEY_STAFF::contains)) {
            return;
        }
        throw ServiceException.permissionDenied("payment changes are made by the order service or finance staff");
    }

    /**
     * The customer a request acts for. Customers act only for themselves (an empty id means "me"); services and
     * staff must name the customer.
     */
    public static String customerFor(Caller caller, String requested) {
        if (internal(caller) || staff(caller)) {
            if (requested == null || requested.isBlank()) {
                throw ServiceException.invalidArgument("CUSTOMER_ID_REQUIRED", "customer_id is required");
            }
            return requested;
        }
        if (requested == null || requested.isBlank() || requested.equals(caller.userId())) {
            return caller.userId();
        }
        throw ServiceException.permissionDenied("customers can only act on their own account");
    }

    /** Reads: services, staff, or the customer the record belongs to. */
    public static boolean canRead(Caller caller, String ownerCustomerId) {
        return internal(caller) || staff(caller) || caller.userId().equals(ownerCustomerId);
    }
}
