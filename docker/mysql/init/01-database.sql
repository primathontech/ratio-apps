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
CREATE DATABASE IF NOT EXISTS unicommerce_app;
CREATE DATABASE IF NOT EXISTS unicommerce_app_test;

GRANT ALL ON `_template_app`.*         TO 'app'@'%';
GRANT ALL ON `_template_app_test`.*    TO 'app'@'%';
GRANT ALL ON `google_app`.*            TO 'app'@'%';
GRANT ALL ON `google_app_test`.*       TO 'app'@'%';
GRANT ALL ON `meta_app`.*              TO 'app'@'%';
GRANT ALL ON `meta_app_test`.*         TO 'app'@'%';
GRANT ALL ON `posthog_app`.*           TO 'app'@'%';
GRANT ALL ON `posthog_app_test`.*      TO 'app'@'%';
GRANT ALL ON `moengage_app`.*          TO 'app'@'%';
GRANT ALL ON `moengage_app_test`.*     TO 'app'@'%';
GRANT ALL ON `wizzy_app`.*             TO 'app'@'%';
GRANT ALL ON `wizzy_app_test`.*        TO 'app'@'%';
GRANT ALL ON `unicommerce_app`.*       TO 'app'@'%';
GRANT ALL ON `unicommerce_app_test`.*  TO 'app'@'%';
FLUSH PRIVILEGES;
