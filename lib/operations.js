'use strict';

const { docSpringRequest, parseFields } = require('./docspring');

// Each handler takes (conn, params) where params come from msg.payload, and returns
// the value written to msg.payload. Mirrors the Zapier/Make/n8n implementations.

async function generatePdf(conn, p) {
	if (!p.template_id) throw new Error('template_id is required');
	const body = { data: p.data || {}, test: p.test || false };
	if (p.metadata) body.metadata = p.metadata;
	if (p.password) body.password = p.password;
	if (p.editable !== undefined) body.editable = p.editable;
	if (p.expires_in) body.expires_in = p.expires_in;
	if (p.version) body.version = p.version;
	const result = await docSpringRequest(conn, 'POST', '/templates/' + p.template_id + '/submissions', {
		body,
		qs: { wait: true },
		sync: true,
	});
	return result.submission || result;
}

async function combinePdfs(conn, p) {
	const sourcePdfs = (p.source_pdfs || []).map((row) => {
		const entry = { type: row.type || 'submission' };
		if (row.type === 'url') entry.url = row.url;
		else entry.id = row.id;
		if (row.template_version) entry.template_version = row.template_version;
		return entry;
	});
	const body = { source_pdfs: sourcePdfs };
	if (p.password) body.password = p.password;
	if (p.expires_in) body.expires_in = p.expires_in;
	if (p.metadata) body.metadata = p.metadata;
	const result = await docSpringRequest(conn, 'POST', '/combined_submissions', {
		body,
		qs: { wait: true },
		sync: true,
	});
	return result.combined_submission || result;
}

async function createSigningLink(conn, p) {
	if (!p.data_request_id) throw new Error('data_request_id is required');
	const result = await docSpringRequest(conn, 'POST', '/data_requests/' + p.data_request_id + '/tokens', {
		qs: { type: p.token_type || 'email' },
	});
	const token = result.token || result;
	return { id: token.id, signing_url: token.data_request_url, expires_at: token.expires_at };
}

async function createDataRequest(conn, p) {
	if (!p.template_id) throw new Error('template_id is required');
	const rows = (p.data_requests || []).filter((r) => r && r.email);
	if (!rows.length) throw new Error('At least one recipient with an email address is required');
	const dataRequests = rows.map((r) => {
		const e = { email: r.email, auth_type: r.auth_type || 'email_link' };
		if (r.name) e.name = r.name;
		const fields = parseFields(r.fields);
		if (fields) e.fields = fields;
		return e;
	});
	const body = { data: p.data || {}, data_requests: dataRequests, test: p.test || false };
	if (p.metadata) body.metadata = p.metadata;
	if (p.expires_in) body.expires_in = p.expires_in;
	if (p.version) body.version = p.version;

	const result = await docSpringRequest(conn, 'POST', '/templates/' + p.template_id + '/submissions', { body });
	const submission = result.submission || result;
	const created = submission.data_requests || [];

	// Mint a 30-day email signing link per recipient (one failure shouldn't fail all).
	const enriched = [];
	for (const dr of created) {
		let signingUrl = null;
		if (dr.id && dr.state !== 'completed') {
			try {
				const tok = await docSpringRequest(conn, 'POST', '/data_requests/' + dr.id + '/tokens', {
					qs: { type: 'email' },
				});
				signingUrl = (tok.token && tok.token.data_request_url) || null;
			} catch (_e) {
				signingUrl = null;
			}
		}
		enriched.push(Object.assign({}, dr, { signing_url: signingUrl }));
	}
	const first = enriched[0] || {};
	return Object.assign({}, submission, {
		data_requests: enriched,
		first_data_request_id: first.id || null,
		first_signing_url: first.signing_url || null,
	});
}

async function findTemplate(conn, p) {
	const results = [];
	const limit = p.limit || 20;
	let page = 1;
	let hasMore = true;
	while (hasMore) {
		const qs = { per_page: 50, page };
		if (p.query) qs.query = p.query;
		const batch = await docSpringRequest(conn, 'GET', '/templates', { qs });
		const list = Array.isArray(batch) ? batch : [];
		results.push.apply(results, list);
		hasMore = list.length >= 50 && results.length < limit;
		page += 1;
	}
	return results.slice(0, limit);
}

async function findSubmission(conn, p) {
	if (p.submission_id) {
		return await docSpringRequest(conn, 'GET', '/submissions/' + p.submission_id);
	}
	const results = [];
	const limit = p.limit || 20;
	let cursor;
	do {
		const qs = { limit: 50, include_data: true };
		if (p.type) qs.type = p.type;
		if (p.created_after) qs.created_after = p.created_after;
		if (p.created_before) qs.created_before = p.created_before;
		if (cursor) qs.cursor = cursor;
		const pageData = await docSpringRequest(conn, 'GET', '/submissions', { qs });
		const subs = pageData.submissions || [];
		results.push.apply(results, subs);
		cursor = pageData.next_cursor;
		if (!subs.length) break;
	} while (cursor && results.length < limit);
	return results.slice(0, limit);
}

const OPERATIONS = {
	generatePdf,
	combinePdfs,
	createDataRequest,
	createSigningLink,
	findTemplate,
	findSubmission,
};

// Labels for the editor dropdown (value → display).
const OPERATION_LABELS = {
	generatePdf: 'Generate PDF',
	combinePdfs: 'Combine PDFs',
	createDataRequest: 'Create Data Request',
	createSigningLink: 'Create Signing Link',
	findTemplate: 'Find Template',
	findSubmission: 'Find Submission',
};

module.exports = { OPERATIONS, OPERATION_LABELS };
