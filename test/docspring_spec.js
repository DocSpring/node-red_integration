'use strict';

const helper = require('node-red-node-test-helper');
const configNode = require('../nodes/docspring-config.js');
const docspringNode = require('../nodes/docspring.js');

helper.init(require.resolve('node-red'));

const HAS_CREDS = !!(process.env.DOCSPRING_TOKEN_ID && process.env.DOCSPRING_TOKEN_SECRET);
const creds = {
	c1: {
		tokenId: process.env.DOCSPRING_TOKEN_ID,
		tokenSecret: process.env.DOCSPRING_TOKEN_SECRET,
	},
};
const TEMPLATE = 'tpl_ZFjT3TMsEmHqh4QLch';

describe('DocSpring nodes', function () {
	this.timeout(40000);

	before(function (done) {
		helper.startServer(done);
	});
	after(function (done) {
		helper.stopServer(done);
	});
	afterEach(function () {
		helper.unload();
	});

	it('loads the config and action nodes', function (done) {
		const flow = [
			{ id: 'c1', type: 'docspring-config', name: 'test', region: 'us' },
			{ id: 'n1', type: 'docspring', name: 't', operation: 'findTemplate', server: 'c1' },
		];
		helper.load([configNode, docspringNode], flow, creds, function () {
			const n1 = helper.getNode('n1');
			const c1 = helper.getNode('c1');
			n1.should.have.property('type', 'docspring');
			c1.should.have.property('region', 'us');
			done();
		});
	});

	it('errors (to a Catch) when the operation is unknown', function (done) {
		const flow = [
			{ id: 'c1', type: 'docspring-config', name: 'test', region: 'us' },
			{ id: 'n1', type: 'docspring', name: 't', operation: 'nope', server: 'c1' },
		];
		helper.load([configNode, docspringNode], flow, creds, function () {
			const n1 = helper.getNode('n1');
			n1.on('call:error', function () {
				done();
			});
			n1.receive({ payload: {} });
		});
	});

	(HAS_CREDS ? it : it.skip)('runs Find Template against the live API', function (done) {
		const flow = [
			{ id: 'c1', type: 'docspring-config', name: 'test', region: 'us' },
			{ id: 'n1', type: 'docspring', name: 't', operation: 'findTemplate', server: 'c1', wires: [['n2']] },
			{ id: 'n2', type: 'helper' },
		];
		helper.load([configNode, docspringNode], flow, creds, function () {
			const n1 = helper.getNode('n1');
			const n2 = helper.getNode('n2');
			n2.on('input', function (msg) {
				try {
					msg.payload.should.be.an.Array();
					done();
				} catch (e) {
					done(e);
				}
			});
			n1.receive({ payload: { query: 'Demo', limit: 5 } });
		});
	});

	(HAS_CREDS ? it : it.skip)('generates a test PDF against the live API', function (done) {
		const flow = [
			{ id: 'c1', type: 'docspring-config', name: 'test', region: 'us' },
			{ id: 'n1', type: 'docspring', name: 't', operation: 'generatePdf', server: 'c1', wires: [['n2']] },
			{ id: 'n2', type: 'helper' },
		];
		helper.load([configNode, docspringNode], flow, creds, function () {
			const n1 = helper.getNode('n1');
			const n2 = helper.getNode('n2');
			n2.on('input', function (msg) {
				try {
					msg.payload.should.have.property('state', 'processed');
					msg.payload.should.have.property('download_url');
					done();
				} catch (e) {
					done(e);
				}
			});
			n1.receive({
				payload: {
					template_id: TEMPLATE,
					data: { first_name: 'Node', last_name: 'RED', favorite_color: 'green' },
					test: true,
				},
			});
		});
	});
});
