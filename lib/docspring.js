'use strict';

const { resolveBaseUrl } = require('./regions');
const { version } = require('../package.json');

const API_PATH = '/api/v2';
const USER_AGENT = 'docspring-node-red/' + version;

// The IDs a v2 error names when it's about a record that was saved, and the operation
// that gets each one later.
const RECORD_IDS = [
	{ key: 'submission_id', label: 'Submission', getter: 'Get Submission' },
	{ key: 'submission_batch_id', label: 'Submission batch', getter: 'Get Submission Batch' },
	{ key: 'combined_pdf_id', label: 'Combined PDF', getter: 'Get Combined PDF' },
	{ key: 'template_id', label: 'Template', getter: 'Get Template' },
];

function text(value) {
	if (value === undefined || value === null) return '';
	return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

// Builds the message for a non-2xx response. v2 errors are
// { error: { code, message, details: [{ code, message, pointer | parameter }], request_id, <record>_id } }.
function formatApiError(status, body) {
	const info = body && typeof body === 'object' ? body.error : undefined;
	if (!info || typeof info !== 'object') {
		const detail = typeof info === 'string' ? info : typeof body === 'string' ? body.trim().slice(0, 300) : '';
		return 'DocSpring API error ' + status + (detail ? ': ' + detail : '');
	}

	const lines = [];
	if (status === 504 && info.code === 'polling_timeout') {
		const record = RECORD_IDS.find((r) => info[r.key]);
		lines.push(
			"The PDF wasn't ready in time." +
				(record ? ' Get it later with ' + record.getter + ' (' + info[record.key] + ').' : ''),
		);
	} else {
		lines.push('DocSpring API error ' + status + ' ' + text(info.code) + ': ' + text(info.message));
		for (const detail of Array.isArray(info.details) ? info.details : []) {
			const where = detail.pointer || detail.parameter;
			lines.push((where ? where + ': ' : '') + text(detail.message));
		}
		for (const record of RECORD_IDS) {
			if (info[record.key]) lines.push(record.label + ': ' + info[record.key]);
		}
	}
	if (info.request_id) lines.push('Request ID: ' + info.request_id);
	return lines.join('\n');
}

function apiError(status, body) {
	const err = new Error(formatApiError(status, body));
	err.statusCode = status;
	const info = body && typeof body === 'object' && body.error && typeof body.error === 'object' ? body.error : null;
	// Node-RED copies `code` to msg.error.code for Catch nodes.
	if (info && info.code) err.code = info.code;
	err.body = body;
	return err;
}

// A record that was created (HTTP 201) but ended in a failure state.
function failedStateError(summary, state, errorMessage, idLines) {
	const lines = [summary + ' (state: ' + state + ')' + (errorMessage ? ': ' + errorMessage : '')];
	const err = new Error(lines.concat(idLines || []).join('\n'));
	err.code = state;
	return err;
}

// A 429 means DocSpring didn't process the request, so it's sent again (a POST too) after the
// Retry-After seconds (at least 1), up to 3 times, while each wait is a minute or less.
const RATE_LIMIT_RETRIES = 3;
const MAX_RETRY_AFTER_SECONDS = 60;

// Tests replace sleep so the suite doesn't wait.
const clock = { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

function retryAfterSeconds(res) {
	const header = res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null;
	const seconds = /^\s*\d+\s*$/.test(header || '') ? parseInt(header, 10) : 0;
	return Math.max(1, seconds);
}

// Authenticated DocSpring API v2 request. `conn` = { region, customHost, tokenId, tokenSecret }.
// Uses the global fetch (Node 18+, which Node-RED 3.1+/4 require) so the package has no
// runtime dependencies. Non-2xx responses throw an Error with DocSpring's message.
async function docSpringRequest(conn, method, path, options) {
	options = options || {};
	const base = resolveBaseUrl(conn.region, conn.customHost, options.sync);
	const url = new URL(base + API_PATH + path);

	if (options.qs) {
		for (const [k, v] of Object.entries(options.qs)) {
			if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
		}
	}

	const headers = {
		Authorization: 'Basic ' + Buffer.from(conn.tokenId + ':' + conn.tokenSecret).toString('base64'),
		Accept: 'application/json',
		'User-Agent': USER_AGENT,
	};
	let body;
	if (options.body !== undefined) {
		headers['Content-Type'] = 'application/json';
		body = JSON.stringify(options.body);
	}

	let res;
	for (let retries = 0; ; retries++) {
		try {
			res = await globalThis.fetch(url, { method, headers, body });
		} catch (e) {
			const reason = (e && e.cause && e.cause.message) || (e && e.message) || String(e);
			throw new Error("Couldn't reach DocSpring at " + url.origin + ': ' + reason);
		}
		if (res.status !== 429 || retries >= RATE_LIMIT_RETRIES) break;
		const wait = retryAfterSeconds(res);
		if (wait > MAX_RETRY_AFTER_SECONDS) break;
		await res.text();
		await clock.sleep(wait * 1000);
	}
	const responseText = await res.text();
	let data;
	try {
		data = responseText ? JSON.parse(responseText) : {};
	} catch (_e) {
		data = responseText;
	}

	if (!res.ok) throw apiError(res.status, data);
	return data;
}

module.exports = { docSpringRequest, formatApiError, failedStateError, clock, API_PATH, USER_AGENT };
