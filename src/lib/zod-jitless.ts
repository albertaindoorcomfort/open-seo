import { config } from "zod";

// Zod compiles object parsers with new Function, after probing whether eval is
// allowed. The app's Content-Security-Policy forbids eval
// (src/server/lib/contentSecurityPolicy.ts), so the probe alone is reported as
// a violation in the browser. Jitless mode skips both the probe and the
// compile. It must run before any schema is built, so it is the first import
// of src/start.ts, which the client evaluates before the router.
config({ jitless: true });
