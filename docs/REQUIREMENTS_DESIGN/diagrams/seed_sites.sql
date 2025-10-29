INSERT INTO sites (site_code, site_type_id, max_length_ft, pull_through, has_water, has_sewer, power, status, notes) VALUES
('A01', 1, 35, 1, 1, 1, '30A', 'AVAILABLE', NULL),
('A02', 1, 40, 1, 1, 1, '50A', 'AVAILABLE', NULL),
('B01', 2, 30, 0, 1, 0, '15A', 'AVAILABLE', NULL)
ON DUPLICATE KEY UPDATE
  site_type_id=VALUES(site_type_id),
  max_length_ft=VALUES(max_length_ft),
  pull_through=VALUES(pull_through),
  has_water=VALUES(has_water),
  has_sewer=VALUES(has_sewer),
  power=VALUES(power),
  status=VALUES(status),
  notes=VALUES(notes);
