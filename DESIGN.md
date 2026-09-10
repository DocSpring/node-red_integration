# DocSpring Node-RED Nodes — Design Notes

Port spec for the DocSpring **Node-RED** integration (`@docspring/node-red-docspring`).
Source of truth for behavior is the Zapier integration (`DocSpring/zapier_integration`),
the Make app (`DocSpring/make_integration`), and the n8n node
(`DocSpring/n8n_integration`); this doc records what carries over and what changes
because Node-RED nodes are a **`.js` runtime + `.html` editor**, message-driven.

## Package shape

An npm module discovered by the Node-RED flow library via the `node-red` keyword +
the `node-red.nodes` map in `package.json` (name → compiled `.js`). Node-RED loads
each node's `.js` (runtime) and `.html` (palette entry + edit dialog + help).

```
docspring-config.js / .html    # config node: connection (region + token id/secret)
docspring.js        / .html    # action node: operation selector, msg-driven
docspring-event.js  / .html    # trigger node: DocSpring webhook → flow (optional v1)
lib/regions.js                 # region → host + sync host
lib/docspring.js               # shared HTTP request helper (Basic auth)
icons/docspring.svg
```

## Config node — `docspring-config`

Mirrors the auth from the other integrations. Node-RED stores the secret encrypted
via the node's `credentials` map.
- Properties: `region` (US / EU / Self-hosted), `customHost`.
- Credentials: `tokenId` (text), `tokenSecret` (password).
- Region → base URL: US `api.docspring.com`, EU `api-eu.docspring.com`,
  self-hosted → `customHost` (prepend `https://` if no scheme). **Sync host** for
  Generate PDF / Combine PDFs: `sync.api.docspring.com` (+ eu); self-hosted reuses
  its single origin.
- Auth: `Authorization: Basic base64(tokenId:tokenSecret)` on every request.

## Action node — `docspring`

One node with an **Operation** dropdown; request parameters come from `msg.payload`,
the API response is written to `msg.payload` (Node-RED-idiomatic). References the
config node via a `docspring` property (`type: 'docspring-config'`).

Operations (payload in → payload out):
- **Generate PDF** — `POST {sync}/api/v1/templates/{template_id}/submissions?wait=true`.
  `msg.payload = { template_id, data:{...}, test?, metadata?, password?, editable?,
  expires_in?, version? }` → `body.submission`.
- **Combine PDFs** — `POST {sync}/api/v1/combined_submissions?wait=true`.
  `{ source_pdfs:[{type,id|url,template_version?}], password?, expires_in?, metadata? }`
  → `body.combined_submission`.
- **Create Data Request** — `POST /api/v1/templates/{template_id}/submissions`
  (standard host, no wait). `{ template_id, data?, data_requests:[{email,name?,fields?,
  auth_type?}], test?, ... }` → submission (`waiting_for_data_requests`) + a minted
  30-day `email` signing link per recipient (`signing_url`, `first_signing_url`).
- **Create Signing Link** — `POST /api/v1/data_requests/{id}/tokens?type=email|api`
  (type in the **query string**). `{ data_request_id, token_type? }` → the token +
  `data_request_url`.
- **Find Template** — `GET /api/v1/templates?query=&per_page=` → array (page pagination,
  per_page ≤ 50).
- **Find Submission** — `GET /api/v1/submissions/{id}` (single) or
  `GET /api/v1/submissions?limit=&type=&created_after/before` (cursor pagination,
  `next_cursor`).

`node.status()` reflects progress (blue "requesting…", green "done", red on error);
errors go to `done(err)` so Catch nodes can handle them, with DocSpring's
`{status:error, errors:[…]}` surfaced as the message.

## Trigger node — `docspring-event` (v1 stretch)

Registers a DocSpring REST-hook webhook (version 3) pointing at a Node-RED HTTP-In
endpoint, emits each delivery flattened (top-level `id` = event uuid, `resource_id`,
`resource_type`, `data`). Events: the 13 DocSpring event types + a mode filter.
(If the HTTP-endpoint registration proves fiddly for v1, document using a core
HTTP-In node + the DocSpring dashboard webhook instead.)

## Gotchas carried over

- **Sync host + `?wait=true`** for Generate PDF / Combine PDFs; **standard host, no
  wait** for Create Data Request.
- Signing-link `type` in the **query string** (works from body too, but qs is canonical).
- Self-hosted `customHost` needs an `https://` scheme prepended if omitted.
- v3 webhook delivery: top-level `id` is the event uuid; resource uid at `data.id`.
- DocSpring errors: `{status:error, errors:[…]}` — surface `errors.join(', ')`.

## Testing & publishing

- Unit tests with `node-red-node-test-helper` (mock the HTTP layer).
- Local: `npm link` into `~/.node-red`, run Node-RED, wire a flow against the DocSpring
  test account (token in a local `.env`, gitignored).
- Publish `@docspring/node-red-docspring` to npm with the `node-red` keyword → it
  auto-lists in the Node-RED flow library (flows.nodered.org).
