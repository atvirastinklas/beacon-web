# Browser testing

Run every command below from the **repository root** (`beacon-web/`), not `e2e/`.
There are two independent workflows: the coding agent's runtime browser for
interactive investigation, and Playwright Test for repeatable regression checks.
Neither shares authentication with the other.

## Prerequisites and installation

- Node.js **24** (selected in `mise.toml` and CI) and npm. If using mise, run
  `mise install` and activate it in your shell first.
- Install the locked dependencies with `npm ci`.
- Install the matching Chromium binary once, and again after Playwright upgrades:

  ```sh
  npx playwright install chromium
  ```

This downloads a browser into Playwright's user cache; it does not connect the
agent's runtime browser. Do not implicitly run `install --with-deps` or privileged
package installation. If Chromium reports missing system libraries, ask the
machine/container owner to provision them before retrying.

## Verify targets and obtain approval first

**A localhost frontend can still read a production backend.** Before starting an
investigation or running tests, identify and report the effective API, WebSocket,
proxy, authentication, and other service hosts and their environment classification.
Get explicit confirmation that they are approved local/staging services. If a target
is unknown or production, stop and ask the owner; read-only access is not implicit
approval. Any production exception must be explicit and task-specific, not inferred
from a previous session. Do not navigate to an unapproved identity provider.

The default test frontend is `http://localhost:5173`, running Vite in **development**
mode. Environment precedence, highest first:

1. Already-exported process environment variables.
2. `.env.development.local`.
3. `.env.development`.
4. `.env.local`.
5. `.env`.

Vite also expands variable references. `.env.example` is documentation, not an
automatically loaded environment file. Playwright itself does not load dotenv;
its Vite child loads the above files. Restart an existing dev server after any
environment change; its old effective configuration is otherwise reused.

`VITE_API_BASE` defaults to `http://localhost:8080/api/v1` and `VITE_WS_URL` to
`ws://localhost:8080/ws`. Relative API URLs resolve against the frontend origin.
When `VITE_DEV_PROXY` is set, Vite forwards `/api` to that target and `/ws` to
the corresponding `ws:`/`wss:` target. An absolute API/WS URL pointing elsewhere
bypasses that proxy. Check both the browser-facing URLs and downstream hosts.

This offline command resolves the effective development values without starting
the app or contacting those hosts. It prints origins only (no credentials, paths,
queries, or tokens):

```sh
node --input-type=module <<'NODE'
import { loadEnv } from 'vite';
const env = loadEnv('development', process.cwd(), 'VITE_');
const frontend = 'http://localhost:5173';
const values = {
  VITE_API_BASE: env.VITE_API_BASE ?? 'http://localhost:8080/api/v1',
  VITE_WS_URL: env.VITE_WS_URL ?? 'ws://localhost:8080/ws',
  VITE_DEV_PROXY: env.VITE_DEV_PROXY,
};
console.log('Frontend:', frontend);
for (const [key, value] of Object.entries(values)) {
  try {
    console.log(key + ':', value ? new URL(value, frontend).origin : '(unset)');
  } catch {
    console.log(key + ': (invalid URL; review privately)');
  }
}
NODE
```

Also review `public/config.js` privately: nonempty strings in
`window.__BEACON_CONFIG__` override the Vite values in the browser. It is empty in
the source checkout, but containers replace it using `.build/docker-entrypoint.sh`.
For a reused server, verify its checkout, mode, environment, and served `/config.js`;
this command cannot inspect an already-running process's configuration. Do not
dump environment files or runtime config into chat or reports.

Additional services in the current source:

- Google Fonts: `fonts.googleapis.com`, `fonts.gstatic.com` on initial page load.
- Map styles/tiles: `tiles.openfreemap.org`; terrain: `s3.amazonaws.com`.
  Remote styles can reference further resource hosts; inspect them before map work.
- Node-detail telemetry: `telemetry.ite.lt`.
- GitHub and configurable banner links are external navigation, not smoke targets.

The Beacon shell tests use only the Packets and Nodes list views, not maps, node details,
external links, login, or administrative actions. They still initiate REST reads
and WebSocket live subscriptions, so backend approval is required. The current
client has no login, MFA, auth provider, or protected route. If a deployment adds
gateway/SSO authentication or redirects, stop and approve that target separately.

The separate `meshlog.spec.ts` test visits the live `/experimental/meshlog` page.
It injects test-only responses at the REST/WebSocket boundary; no sample data is
bundled into the application. It permits the frontend and `tiles.openfreemap.org`,
blocks other external requests, and checks history/live merging, history retry,
public-key hashes, raw hop codes, observer metadata tooltips, searchable grouped
channel selection (including large directories and independent Known/Unknown bulk toggles),
compact observer/packet-type/scope/node-type comboboxes, protocol-type badges, muted endpoint
identifiers, the shared live badge, header language switching and saved language,
packet/observer path controls, live flow surviving pinned-path clearing, inline direct
reports, consistent unavailable-control spacing, short-ID node tooltips and real node
details, shared role assets, the initial 30-packet request,
desktop layout, the adjustable mobile map with tabbed packet/contact panels, and
large virtualized lists retaining expansions and pins across scrolling and tab changes,
supported contact-age settings, and node-circle contrast on light and dark maps.
It does not contact a Beacon backend, but map-tile access still needs target approval.

### Local overrides

Do not change tracked defaults to switch environments. Edit the ignored
`.env.development.local` (or `.env.local` if that is the team's chosen override),
after checking existing files and exported variables. For an **approved** local
beacon-server on port 8080, an example is:

```dotenv
VITE_DEV_PROXY=http://localhost:8080
VITE_API_BASE=/api/v1
VITE_WS_URL=ws://localhost:5173/ws
```

This does not start or provision beacon-server. Have the owner supply the approved
backend. Recheck all effective targets after changes; an override alone is not
proof of safety. No passwords, tokens, TOTP seeds, exported sessions, or saved
authentication state belong in source control, documentation, or chat.

## Offline validation

These commands do **not** start Vite or launch a browser:

```sh
npm run test:e2e -- --list
npm run build
npm run lint
npm test
```

`--list` checks Playwright configuration and test discovery, not backend safety or
runtime behavior. The build is the repository's real TypeScript check and includes
the Playwright configuration/tests. Vitest remains separate and excludes `e2e/`.
No browser tests are wired into CI or deployment pipelines.

## Interactive coding-agent browser

After target approval, start the app in a terminal:

```sh
npm run dev -- --host localhost --port 5173 --strictPort
```

Use the browser tools supplied by the coding-agent runtime; do not add another
browser MCP server or external browser service. If the integration is disconnected,
connect/reconnect it separately through the runtime's browser controls and verify
that tabs can be listed. Installing Playwright will **not** connect it. The runtime
browser must also be able to reach this machine's localhost (use the runtime's
approved forwarding mechanism if it runs elsewhere).

- Open the approved frontend and use the **explicit tab ID returned by the tool**
  for all operations where required. Focus alone does not select the tool target.
- Inspect rendered content, console errors, failed requests and HTTP error responses;
  capture screenshots and reproduce the behavior before and after a fix.
- Check layout at **1440×900**, and where useful at a shorter size such as
  **1440×700**. Do not assume these smoke tests are a visual/layout audit.
- If an approved deployment requires authentication, the human completes normal
  login and MFA in **that same runtime browser session**. Login in another browser
  does not authenticate the agent's session. Do not automate credential submission,
  bypass MFA, export the session, or save storage state.
- Keep credential entry outside traces, screenshots, recordings and tool captures.
  Stop capture before login and resume only after sensitive screens are gone.
- Interactive login does not authenticate the separate Playwright Test runner.
- Save investigation artifacts only under ignored `test-results/interactive/`.
  Sign out of the troubleshooting session or close it when finished; close only
  tabs/sessions owned by the investigation.

The terminal owner stops this foreground Vite process with Ctrl+C. The existing
`npm start`/`npm stop` helper is another manual option; only stop servers you own.

## Automated regression tests

Only after targets and environment are approved:

```sh
npm run test:e2e          # Chromium, headless
npm run test:e2e:headed   # visible browser; requires a graphical display
npm run test:e2e:debug    # Playwright Inspector; requires a graphical display
npm run test:e2e:report   # open the latest local HTML report
```

Playwright starts `npm run dev -- --host localhost --port 5173 --strictPort`
automatically, waits up to 120 seconds for `/`, and shuts down its own server after
the run. Outside CI it may reuse an existing server at that URL: verify that server
first and stop it yourself when finished. In CI reuse is disabled and port conflicts
fail instead of silently selecting another port. Do not use the broad
`dev:stop-all` cleanup command to stop someone else's process.

Tests use fresh unauthenticated contexts, Chromium at 1440×900, full parallelism,
and English via a per-context display preference (the app otherwise defaults to
Lithuanian). Nothing is logged in or persisted. CI settings are one worker, one
retry and `forbidOnly`; local runs use Playwright's default workers and no retries.
The default suite needs Packets and Nodes enabled; deployments disabling these tabs
need a separately scoped suite, not a silent change to app configuration.

### Coverage and limitations

- Public `/` renders the header, selected Packets tab and editable packet search.
- Public `/?tab=Nodes` opens Nodes without a session and can return to Packets,
  updating the URL and visible filters.
- There is no local login form or protected route to test. These are public-shell
  regressions, **not authentication, API health, live-data correctness, or visual
  regression tests**. No fixed row counts or production data are asserted.
- No form submission, data creation, destructive action, or admin mutation is run.
  Authenticated or mutation coverage requires separate explicit environment,
  credentials-handling, test-data and cleanup approval. Do not add credential
  automation, MFA bypass, exported interactive sessions or `storageState` here.

## Failure artifacts

- HTML report: `playwright-report/index.html` (never opens automatically).
- Results, failure screenshots and retained failure traces: `test-results/`.
- Inspect the report with `npm run test:e2e:report`; open a trace from its test detail,
  or run `npx playwright show-trace test-results/<test-directory>/trace.zip` locally.

Reports, traces, screenshots, DOM snapshots and network bodies can contain sensitive
data even for public, read-only tests. Review privately; do not upload them to public
trace viewers, attach them to issues, or commit them without redaction and approval.
Generated results, reports, blob reports, `.auth/` directories and Playwright's local
cache directory are ignored as a precaution, not permission to save login profiles.
After inspection, remove only your own artifacts with
`rm -rf test-results playwright-report blob-report`. Browser binaries remain in
the user's Playwright cache and are not repository artifacts.
