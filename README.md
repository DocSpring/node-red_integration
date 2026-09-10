# @docspring/node-red-docspring

[Node-RED](https://nodered.org) nodes for [DocSpring](https://docspring.com) — turn
structured data into filled, downloadable, and **signable** PDFs from your flows.

## Install

From the Node-RED editor: **Menu → Manage palette → Install**, search for
`@docspring/node-red-docspring`. Or from your Node-RED user directory:

```bash
cd ~/.node-red
npm install @docspring/node-red-docspring
```

Restart Node-RED. The **DocSpring** node appears in the palette.

## Credentials

Add a **DocSpring** configuration (on the node, or via the config-nodes list):
choose your **Region** (US / EU / Self-hosted), and paste the **Token ID** and
**Token Secret** from the DocSpring web app (**Settings → API Tokens**). Click
**Test connection** to confirm it works. Credentials are stored encrypted by
Node-RED and never leave your instance.

## Usage

Drop a **DocSpring** node into a flow, pick an **Operation**, and pass its parameters
in `msg.payload`. The API response is written back to `msg.payload`; errors are sent
to a **Catch** node. You can override the operation per message with `msg.operation`.

| Operation | `msg.payload` in | out |
|---|---|---|
| **Generate PDF** | `{ template_id, data: {…}, test?, password?, expires_in?, … }` | the processed submission (+ `download_url`) |
| **Combine PDFs** | `{ source_pdfs: [{ type, id\|url, template_version? }], … }` | the combined submission |
| **Create Data Request** | `{ template_id, data_requests: [{ email, name?, fields?, auth_type? }], … }` | submission + a `signing_url` per recipient |
| **Create Signing Link** | `{ data_request_id, token_type?: "email"\|"api" }` | the `signing_url` |
| **Find Template** | `{ query?, limit? }` | array of templates |
| **Find Submission** | `{ submission_id }` or `{ type?, created_after?, created_before?, limit? }` | submission(s) |

### Example — generate a PDF

An **inject** node with this payload, wired into a **DocSpring** node (Operation:
*Generate PDF*):

```json
{ "template_id": "tpl_xxxxxxxxxxxxxxxxxxxx",
  "data": { "first_name": "Jane", "last_name": "Doe" },
  "test": true }
```

`msg.payload` then contains the submission, including `download_url`.

## Resources

- [DocSpring documentation](https://docspring.com/docs)
- [Node-RED community nodes](https://flows.nodered.org)

## License

[MIT](LICENSE.md)
