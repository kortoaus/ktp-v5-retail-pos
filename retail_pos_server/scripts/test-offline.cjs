// Preload for `npm test` (node:test). Runs before dotenv in every test
// process: points the DB and cloud URLs at unroutable values so no test can
// reach the dev database or a cloud server even by accident (dotenv never
// overrides variables that are already set).
process.env.DATABASE_URL = "postgresql://offline:offline@offline.invalid:1/offline?offline=1";
process.env.API_URL = "http://offline.invalid";
process.env.CRM_URL = "http://offline.invalid";
process.env.API_KEY = "offline";
process.env.TS_NODE_TRANSPILE_ONLY = "true";
