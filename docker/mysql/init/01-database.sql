-- Per-module databases. Each app owns its own schema (no shared tables).
-- Runs only on first container start (fresh volume).
CREATE DATABASE IF NOT EXISTS _template_app;
CREATE DATABASE IF NOT EXISTS _template_app_test;
CREATE DATABASE IF NOT EXISTS google_app;
CREATE DATABASE IF NOT EXISTS google_app_test;
CREATE DATABASE IF NOT EXISTS meta_app;
CREATE DATABASE IF NOT EXISTS meta_app_test;
CREATE DATABASE IF NOT EXISTS posthog_app;
CREATE DATABASE IF NOT EXISTS posthog_app_test;
CREATE DATABASE IF NOT EXISTS moengage_app;
CREATE DATABASE IF NOT EXISTS moengage_app_test;
CREATE DATABASE IF NOT EXISTS wizzy_app;
CREATE DATABASE IF NOT EXISTS wizzy_app_test;
CREATE DATABASE IF NOT EXISTS forms_app;
CREATE DATABASE IF NOT EXISTS forms_app_test;
CREATE DATABASE IF NOT EXISTS fbt_app;
CREATE DATABASE IF NOT EXISTS fbt_app_test;

GRANT ALL ON `_template_app`.*      TO 'app'@'%';
GRANT ALL ON `_template_app_test`.* TO 'app'@'%';
GRANT ALL ON `google_app`.*         TO 'app'@'%';
GRANT ALL ON `google_app_test`.*    TO 'app'@'%';
GRANT ALL ON `meta_app`.*           TO 'app'@'%';
GRANT ALL ON `meta_app_test`.*      TO 'app'@'%';
GRANT ALL ON `posthog_app`.*        TO 'app'@'%';
GRANT ALL ON `posthog_app_test`.*   TO 'app'@'%';
GRANT ALL ON `moengage_app`.*       TO 'app'@'%';
GRANT ALL ON `moengage_app_test`.*  TO 'app'@'%';
GRANT ALL ON `wizzy_app`.*          TO 'app'@'%';
GRANT ALL ON `wizzy_app_test`.*     TO 'app'@'%';
GRANT ALL ON `forms_app`.*          TO 'app'@'%';
GRANT ALL ON `forms_app_test`.*     TO 'app'@'%';
GRANT ALL ON `fbt_app`.*      TO 'app'@'%';
GRANT ALL ON `fbt_app_test`.* TO 'app'@'%';

-- `fbt_verify` is the scratch database the additive-safety verifier creates and
-- drops on every run. The script CREATEs it itself, but the `app` user cannot
-- GRANT to itself, so the privilege must be provisioned here or a fresh clone
-- fails with `Access denied`.
GRANT ALL ON `fbt_verify`.*   TO 'app'@'%';
FLUSH PRIVILEGES;
