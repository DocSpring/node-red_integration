'use strict';

const { resolveBaseUrl } = require('./regions');

// Authenticated DocSpring API request. `conn` = { region, customHost, tokenId,
// tokenSecret }. Uses the global fetch (Node 18+, which Node-RED 3.1+/4 require) so
// the package ships with zero runtime dependencies. Surfaces DocSpring's
// `{ status: 'error', errors: [...] }` payloads (and non-2xx) as a thrown Error.
async function docSpringRequest(conn, method, path, options) {
	options = options || {};
	const base = resolveBaseUrl(conn.region, conn.customHost, options.sync);
	const url = new URL(base + '/api/v1' + path);

	if (options.qs) {
		for (const [k, v] of Object.entries(options.qs)) {
			if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
		}
	}

	const headers = {
		Authorization: 'Basic ' + Buffer.from(conn.tokenId + ':' + conn.tokenSecret).toString('base64'),
		Accept: 'application/json',
	};
	let body;
	if (options.body !== undefined) {
		headers['Content-Type'] = 'application/json';
		body = JSON.stringify(options.body);
	}

	const res = await fetch(url, { method, headers, body });
	const text = await res.text();
	let data;
	try {
		data = text ? JSON.parse(text) : {};
	} catch (_e) {
		data = text;
	}

	if (!res.ok || (data && typeof data === 'object' && data.status === 'error')) {
		const message =
			(data && Array.isArray(data.errors) && data.errors.join(', ')) ||
			(data && data.error) ||
			'DocSpring API error (HTTP ' + res.status + ')';
		const err = new Error(message);
		err.statusCode = res.status;
		err.body = data;
		throw err;
	}
	return data;
}

// Split a comma/newline-separated list of field names into a clean array.
function parseFields(value) {
	if (value === undefined || value === null || value === '') return undefined;
	const arr = (Array.isArray(value) ? value : String(value).split(/[\n,]/))
		.map((s) => String(s).trim())
		.filter(Boolean);
	return arr.length ? arr : undefined;
}

module.exports = { docSpringRequest, parseFields };
