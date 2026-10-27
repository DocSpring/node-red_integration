'use strict';

// Replaces the global fetch while a test suite runs. Each request takes the next queued
// response; a request with nothing queued fails the test, so no test reaches the network.
// The live specs (test/live_spec.js) don't use it.
class MockFetch {
	constructor() {
		this.calls = [];
		this.responses = [];
		this.original = undefined;
	}

	install() {
		this.original = globalThis.fetch;
		globalThis.fetch = (url, init) => this.handle(url, init || {});
		return this;
	}

	restore() {
		globalThis.fetch = this.original;
	}

	reset() {
		this.calls = [];
		this.responses = [];
	}

	// Queue a JSON response (or a string body, sent as it is), with any extra headers.
	respond(status, body, headers) {
		this.responses.push({ status, body, headers });
		return this;
	}

	// Queue a network failure, as fetch reports one.
	fail(cause) {
		this.responses.push({ error: Object.assign(new TypeError('fetch failed'), { cause }) });
		return this;
	}

	get last() {
		return this.calls[this.calls.length - 1];
	}

	// Fails when a queued response wasn't used: the code made fewer requests than expected.
	assertDone() {
		if (this.responses.length) {
			throw new Error(this.responses.length + ' queued response(s) were not requested');
		}
	}

	async handle(url, init) {
		const u = new URL(String(url));
		const call = {
			method: init.method || 'GET',
			url: u,
			origin: u.origin,
			path: u.pathname,
			query: Object.fromEntries(u.searchParams.entries()),
			headers: init.headers || {},
			body: init.body === undefined ? undefined : JSON.parse(init.body),
		};
		this.calls.push(call);
		const next = this.responses.shift();
		if (!next) throw new Error('Unexpected request (the network is blocked in tests): ' + call.method + ' ' + u);
		if (next.error) throw next.error;
		const text = typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
		const headers = Object.assign({ 'Content-Type': 'application/json' }, next.headers);
		return new Response(text, { status: next.status, headers });
	}
}

module.exports = { MockFetch };
