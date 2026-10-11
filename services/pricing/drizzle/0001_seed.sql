-- Seed rules, matching the ops console mock data (apps/admin/src/api/mock/zones.ts), except the
-- small-order fee: Rs 60 under Rs 500 everywhere, as in the customer app (features/cart/totals.ts),
-- which is the reference for what customers are charged. Amounts are minor units (Rs 1 = 100).
-- Centres are approximate neighbourhood centres; radius 3 km, nearest centre wins.
INSERT INTO "zones" ("id", "code", "name", "open", "base_fee_minor", "per_km_minor", "small_order_fee_minor", "small_order_under_minor", "riders_needed", "center_lat", "center_lng", "radius_km", "position") VALUES
  ('c15', 'Colombo 15', 'Mattakkuliya', true, 15000, 4000, 6000, 50000, 1, 6.965, 79.87, 3, 1),
  ('c14', 'Colombo 14', 'Grandpass', true, 15000, 4000, 6000, 50000, 1, 6.948, 79.876, 3, 2),
  ('c13', 'Colombo 13', 'Kotahena', true, 13000, 3500, 6000, 50000, 1, 6.946, 79.862, 3, 3),
  ('c01', 'Colombo 01', 'Fort', true, 12000, 3500, 6000, 50000, 2, 6.9344, 79.8428, 3, 4),
  ('c11', 'Colombo 11', 'Pettah', true, 12000, 3500, 6000, 50000, 1, 6.9375, 79.852, 3, 5),
  ('c12', 'Colombo 12', 'Hulftsdorp', true, 13000, 3500, 6000, 50000, 1, 6.942, 79.859, 3, 6),
  ('c10', 'Colombo 10', 'Maradana', true, 13000, 3500, 6000, 50000, 1, 6.929, 79.865, 3, 7),
  ('c09', 'Colombo 09', 'Dematagoda', true, 15000, 4000, 6000, 50000, 1, 6.935, 79.88, 3, 8),
  ('c02', 'Colombo 02', 'Slave Island', true, 12000, 3500, 6000, 50000, 2, 6.922, 79.85, 3, 9),
  ('c08', 'Colombo 08', 'Borella', true, 13000, 3500, 6000, 50000, 2, 6.915, 79.878, 3, 10),
  ('raj', 'Rajagiriya', 'Rajagiriya', true, 18000, 4500, 6000, 50000, 1, 6.909, 79.896, 3, 11),
  ('c03', 'Colombo 03', 'Kollupitiya', true, 10000, 3000, 6000, 50000, 6, 6.91, 79.851, 3, 12),
  ('c07', 'Colombo 07', 'Cinnamon Gardens', true, 12000, 3500, 6000, 50000, 3, 6.908, 79.865, 3, 13),
  ('c04', 'Colombo 04', 'Bambalapitiya', true, 10000, 3000, 6000, 50000, 4, 6.893, 79.856, 3, 14),
  ('c05', 'Colombo 05', 'Havelock Town', true, 12000, 3500, 6000, 50000, 2, 6.883, 79.868, 3, 15),
  ('nug', 'Nugegoda', 'Nugegoda', true, 18000, 4500, 6000, 50000, 1, 6.872, 79.889, 3, 16),
  ('c06', 'Colombo 06', 'Wellawatte', true, 11000, 3000, 6000, 50000, 4, 6.874, 79.861, 3, 17),
  ('deh', 'Dehiwala', 'Dehiwala', true, 15000, 4000, 6000, 50000, 2, 6.851, 79.865, 3, 18),
  ('mtl', 'Mount Lavinia', 'Mount Lavinia', false, 18000, 4500, 6000, 50000, 1, 6.833, 79.865, 3, 19)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "surcharge_rules" ("id", "label", "days", "start_time", "end_time", "amount_minor", "enabled") VALUES
  ('s1', 'Lunch peak', 'mon_to_fri', '12:00', '14:00', 3000, true),
  ('s2', 'Dinner peak', 'every_day', '19:00', '21:30', 4000, true),
  ('s3', 'Weekend late nights', 'fri_to_sun', '23:00', '02:00', 6000, true),
  ('s4', 'Poya day', 'every_day', '10:00', '22:00', 5000, false)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "pricing_settings" ("id", "rules_version", "weather_enabled", "weather_amount_minor", "plus_free_delivery_from_minor")
VALUES (1, 1, false, 5000, 150000)
ON CONFLICT ("id") DO NOTHING;
