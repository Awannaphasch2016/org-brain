# Operator notes

- Read `node_modules/eve/docs/` before changing Eve APIs. This agent targets eve `1.0.0-rc.7`.
- Do not add a root `agent/` directory. The Specification Agent lives at `agents/specification/agent/`.
- Do not commit PDF binaries, tokens, or `{ auth: null }`.
- Do not merge pull requests from agent tools. The GitHub client rejects any `/merge` request.
- Reusable guidelines stay project-agnostic. Project requirements live under `projects/`.
- `pnpm prepare:knowledge` packages approved knowledge into the sandbox seed. It does not copy `projects/`.
- `pnpm build` skips sandbox prewarm so it runs without Vercel credentials. Deploy with `pnpm build:release` or the `vercel.json` build command.
