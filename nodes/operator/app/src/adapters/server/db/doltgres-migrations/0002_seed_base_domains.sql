-- Seed the 5 base domains so a fresh fork's knowledge plane is usable
-- on first boot without manual UI clicks. Domain rows are reference data
-- (structural categories), not knowledge content; NODES_BOOT_EMPTY scopes
-- to content tables (knowledge, citations, sources) per
-- docs/spec/knowledge-domain-registry.md § Seeding.
INSERT INTO "domains" ("id", "name", "description") VALUES
  ('meta', 'Meta', 'Knowledge about the knowledge system itself.'),
  ('prediction-market', 'Prediction Markets', 'Polymarket and adjacent prediction-market knowledge — base rates, market structure, calibration.'),
  ('infrastructure', 'Infrastructure', 'Runtime, deploy, observability, and capacity knowledge for Cogni nodes.'),
  ('governance', 'Governance', 'DAO formation, attribution, voting, and operator/node contracts.'),
  ('reservations', 'Reservations', 'Restaurant / venue reservation knowledge for the resy node domain.');
