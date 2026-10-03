# Atviras Tinklas downstream builds

Our branch is `at/dev`, based on `MeshCore-Beacon/beacon-web`'s `dev`.
Keep downstream changes on `at/dev`; do not customize the upstream mirror.

## Local setup

Use Node.js 24 through mise:

```sh
mise install
mise exec -- npm ci
mise exec -- npm run dev -- --port 5173 --strictPort
```

Configure backend endpoints in an ignored `.env.local` using `.env.example`.
Local development settings are not included in the Docker build.

## Taking upstream updates

`origin` should point to `atvirastinklas/beacon-web`; `upstream` should point
to `MeshCore-Beacon/beacon-web`. From a clean working tree:

```sh
git fetch origin
git fetch upstream
git switch -c update/upstream-dev origin/at/dev
git merge upstream/dev
mise exec -- npm ci
mise exec -- npm run build
mise exec -- npm run lint
mise exec -- npm test
git push -u origin update/upstream-dev
```

Open a pull request targeting `at/dev`. Keep the upstream merge separate from
unrelated customization work. If upstream's frontend major/minor advances beyond
the deployed backend's major/minor, hold that update until the backend is ready.
Matching version numbers alone does not prove API compatibility.

## Images

Pushes to `at/dev` run build, lint, and tests before publishing to
`ghcr.io/atvirastinklas/beacon-web`. Tags use the unchanged `package.json` version
and the first 12 characters of the downstream commit SHA:

```text
v2.0.1-at.a1b2c3d4e5f6
```

The `at-dev` alias is updated only when that build still matches the branch tip.
Use versioned tags for deliberate deployment and rollback, or digests to pin the
exact artifact. Rebuilding the same source can change its image digest.

The workflow also declares a manual trigger restricted to `at/dev`. GitHub requires
the workflow on the repository's default branch for manual dispatch; while the
default remains the clean `dev` branch, use pushes or rerun an existing build.

The workflow publishes images; it does not update a running server. The production
container accepts `VITE_API_BASE` and `VITE_WS_URL` at startup. `VITE_DEV_PROXY` is
development-only. Check GHCR package visibility/access before deploying.
