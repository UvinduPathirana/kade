-- Demo data, matching the apps' mocks and order's seeded history (services/order/src/seed/demo-orders.ts).
-- Ids follow docs/backend/CONVENTIONS.md: 8e01 = saved cards (N), 8e02 = payments (N = order number).
-- Dilini (customer …-8005-000000000001) has the customer app's two default cards: Visa 4242 (approves) and
-- Mastercard 0002 (the mock PSP declines it, so the payment-failed state can be shown).

INSERT INTO saved_cards (id, customer_id, brand, last4, expiry_month, expiry_year, holder_name, psp_token, fingerprint, added_at)
VALUES
  ('00000000-0000-7000-8e01-000000000001', '00000000-0000-7000-8005-000000000001', 'VISA', '4242', 8, 2028,
   'Dilini Fernando', 'tok_seed_visa_4242_dilini', 'Visa-424242-4242-08/28', now() - interval '120 days'),
  ('00000000-0000-7000-8e01-000000000002', '00000000-0000-7000-8005-000000000001', 'MASTERCARD', '0002', 3, 2029,
   'Dilini Fernando', 'tok_seed_mastercard_0002_dilini', 'Mastercard-555555-0002-03/29', now() - interval '40 days')
ON CONFLICT DO NOTHING;

-- Payments behind order's seeded history. Totals follow the order seed's formula
-- (subtotal − restaurant discount + delivery fee + small-order fee + tip).
INSERT INTO payments (id, purpose, reference_id, reference_label, customer_id, method_kind, card_id, card_brand,
                      card_last4, currency, status, amount_requested_minor, amount_authorised_minor,
                      amount_captured_minor, psp_reference, collected_by_rider_id, authorise_key,
                      authorise_request_hash, created_at, authorised_at, captured_at, voided_at, updated_at)
VALUES
  -- KD-4821, Galle Road Kottu House, delivered by Nimal: Rs 3,500 − 700 + 150 + tip 100 = Rs 3,050
  ('00000000-0000-7000-8e02-000000004821', 'ORDER', '00000000-0000-7000-8003-000000004821', 'KD-4821',
   '00000000-0000-7000-8005-000000000001', 'CARD', '00000000-0000-7000-8e01-000000000001', 'VISA', '4242', 'LKR',
   'CAPTURED', 305000, 305000, 305000, 'mockpsp_ch_seed4821', '',
   'order:00000000-0000-7000-8003-000000004821:authorise', '\x00',
   now() - interval '3 days', now() - interval '3 days', now() - interval '3 days' + interval '17 minutes', NULL,
   now() - interval '3 days' + interval '17 minutes'),
  -- KD-3307, Amma's Rice & Curry, cash collected by Kasun: Rs 1,800
  ('00000000-0000-7000-8e02-000000003307', 'ORDER', '00000000-0000-7000-8003-000000003307', 'KD-3307',
   '00000000-0000-7000-8005-000000000001', 'CASH', NULL, '', '', 'LKR',
   'CAPTURED', 180000, 180000, 180000, '', '00000000-0000-7000-8001-000000000102',
   'order:00000000-0000-7000-8003-000000003307:authorise', '\x00',
   now() - interval '9 days', now() - interval '9 days', now() - interval '9 days' + interval '28 minutes', NULL,
   now() - interval '9 days' + interval '28 minutes'),
  -- KD-2954, Smash Shed pickup: Rs 2,400
  ('00000000-0000-7000-8e02-000000002954', 'ORDER', '00000000-0000-7000-8003-000000002954', 'KD-2954',
   '00000000-0000-7000-8005-000000000001', 'CARD', '00000000-0000-7000-8e01-000000000001', 'VISA', '4242', 'LKR',
   'CAPTURED', 240000, 240000, 240000, 'mockpsp_ch_seed2954', '',
   'order:00000000-0000-7000-8003-000000002954:authorise', '\x00',
   now() - interval '17 days', now() - interval '17 days', now() - interval '17 days' + interval '23 minutes', NULL,
   now() - interval '17 days' + interval '23 minutes'),
  -- KD-2410, Kompanna Short Eats, cancelled by Dilini before the kitchen started: hold released. Rs 840 + 120
  ('00000000-0000-7000-8e02-000000002410', 'ORDER', '00000000-0000-7000-8003-000000002410', 'KD-2410',
   '00000000-0000-7000-8005-000000000001', 'CARD', '00000000-0000-7000-8e01-000000000001', 'VISA', '4242', 'LKR',
   'VOIDED', 96000, 96000, 0, 'mockpsp_ch_seed2410', '',
   'order:00000000-0000-7000-8003-000000002410:authorise', '\x00',
   now() - interval '24 days', now() - interval '24 days', NULL, now() - interval '24 days' + interval '1 minute',
   now() - interval '24 days' + interval '1 minute')
ON CONFLICT DO NOTHING;
