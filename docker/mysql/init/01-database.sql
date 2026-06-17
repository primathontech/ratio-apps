-- Per-module databases. Each app owns its own schema (no shared tables).
-- Runs only on first container start (fresh volume).
CREATE DATABASE IF NOT EXISTS _template_app;
CREATE DATABASE IF NOT EXISTS _template_app_test;
CREATE DATABASE IF NOT EXISTS google_app;
CREATE DATABASE IF NOT EXISTS google_app_test;
CREATE DATABASE IF NOT EXISTS meta_app;
CREATE DATABASE IF NOT EXISTS meta_app_test;
-- When you scaffold a new vendor (slug e.g. `loyalty`), append:
-- CREATE DATABASE IF NOT EXISTS <slug>_app;
-- CREATE DATABASE IF NOT EXISTS <slug>_app_test;
-- and a matching GRANT below.

GRANT ALL ON `_template_app`.*      TO 'app'@'%';
GRANT ALL ON `_template_app_test`.* TO 'app'@'%';
GRANT ALL ON `google_app`.*         TO 'app'@'%';
GRANT ALL ON `google_app_test`.*    TO 'app'@'%';
GRANT ALL ON `meta_app`.*           TO 'app'@'%';
GRANT ALL ON `meta_app_test`.*      TO 'app'@'%';
FLUSH PRIVILEGES;
