'use strict';

const helper = require('node-red-node-test-helper');
const configNode = require('../nodes/docspring-config.js');
const { MockFetch } = require('./support/mock_fetch');

helper.init(require.resolve('node-red'));

// Loads a saved config node, then clicks "Test connection" with the editor's values.
async function testConnection(saved, editorValues) {
	await new Promise((resolve) => helper.load([configNode], [saved.node], { c1: saved.credentials }, resolve));
	const res = await helper.request().post('/docspring-config/c1/test').send(editorValues).expect(200);
	return res.body;
}

const US_NODE = { id: 'c1', type: 'docspring-config', name: 'test', region: 'us' };
const SELF_HOSTED_NODE = { id: 'c1', type: 'docspring-config', name: 'test', region: 'self_hosted', customHost: 'docspring.example.com' };
const CREDS = { tokenId: 'api_saved', tokenSecret: 'saved_secret' };

describe('DocSpring connection test', function () {
	const mock = new MockFetch();

	before(function (done) {
		mock.install();
		helper.startServer(done);
	});
	after(function (done) {
		mock.restore();
		helper.stopServer(done);
	});
	afterEach(function () {
		helper.unload();
		mock.assertDone();
		mock.reset();
	});

	it('checks the token with GET /api/v2/authentication and reads authenticated', async function () {
		mock.respond(200, { authenticated: true });
		const result = await testConnection(
			{ node: US_NODE, credentials: CREDS },
			{ region: 'eu', tokenId: 'api_new', tokenSecret: 'new_secret' },
		);
		result.should.eql({ ok: true, message: 'Connection successful.' });
		mock.last.url.toString().should.equal('https://api-eu.docspring.com/api/v2/authentication');
		mock.last.headers.Authorization.should.equal('Basic ' + Buffer.from('api_new:new_secret').toString('base64'));
		mock.last.headers['User-Agent'].should.match(/^docspring-node-red\/\d+\.\d+\.\d+$/);
	});

	it("uses the saved secret when the editor sends Node-RED's __PWRD__ placeholder", async function () {
		mock.respond(200, { authenticated: true });
		const result = await testConnection({ node: US_NODE, credentials: CREDS }, { region: 'us', tokenId: 'api_saved', tokenSecret: '__PWRD__' });
		result.ok.should.be.true();
		mock.last.headers.Authorization.should.equal('Basic ' + Buffer.from('api_saved:saved_secret').toString('base64'));
	});

	it('says the token is invalid on a 401', async function () {
		mock.respond(401, { error: { code: 'unauthorized', message: 'Invalid token', details: [], request_id: 'req_1' } });
		const result = await testConnection({ node: US_NODE, credentials: CREDS }, {});
		result.should.eql({ ok: false, message: 'Invalid DocSpring API token. Check your ID, secret, and region.' });
	});

	it("says a self-hosted server without API v2 needs upgrading (404)", async function () {
		mock.respond(404, '<html>Not Found</html>');
		const result = await testConnection({ node: SELF_HOSTED_NODE, credentials: CREDS }, {});
		mock.last.url.toString().should.equal('https://docspring.example.com/api/v2/authentication');
		result.should.eql({
			ok: false,
			message:
				"This DocSpring server doesn't have API v2 yet. Upgrade it to the latest release, or use version 0.1.0 of this integration.",
		});
	});

	it('shows any other error as DocSpring reports it', async function () {
		mock.respond(500, { error: { code: 'internal_error', message: 'Something went wrong', details: [], request_id: 'req_5' } });
		const result = await testConnection({ node: US_NODE, credentials: CREDS }, {});
		result.should.eql({ ok: false, message: 'DocSpring API error 500 internal_error: Something went wrong\nRequest ID: req_5' });
	});

	it('asks for credentials before calling DocSpring', async function () {
		const result = await testConnection({ node: US_NODE, credentials: {} }, { tokenId: 'api_x' });
		result.should.eql({ ok: false, message: 'Enter a Token ID and Token Secret first.' });
		mock.calls.length.should.equal(0);
	});
});
