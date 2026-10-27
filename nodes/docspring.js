module.exports = function (RED) {
	'use strict';

	const { OPERATIONS, OPERATION_LABELS, resolveOperation } = require('../lib/operations');

	// One action node with an Operation selector. Request parameters come from
	// msg.payload (msg.operation overrides the configured operation); the API v2
	// response is written back to msg.payload. Operation values from 0.1.x still work.
	function DocSpringNode(config) {
		RED.nodes.createNode(this, config);
		const node = this;
		node.operation = config.operation;
		node.server = RED.nodes.getNode(config.server);

		node.on('input', function (msg, send, done) {
			send =
				send ||
				function () {
					node.send.apply(node, arguments);
				};
			const fail = function (err) {
				// "HTTP 422 invalid_data", or the failure state of a record that was created.
				const status = err.statusCode ? 'HTTP ' + err.statusCode + (err.code ? ' ' + err.code : '') : err.code || 'error';
				node.status({ fill: 'red', shape: 'ring', text: status });
				if (done) done(err);
				else node.error(err, msg);
			};

			const params =
				msg.payload && typeof msg.payload === 'object' && !Array.isArray(msg.payload) && !Buffer.isBuffer(msg.payload)
					? msg.payload
					: {};
			const requested = msg.operation || node.operation;
			const operation = resolveOperation(requested, params);
			if (!operation) {
				fail(new Error('Unknown DocSpring operation: ' + requested));
				return;
			}
			if (!node.server || !node.server.credentials || !node.server.credentials.tokenId) {
				fail(new Error('DocSpring connection is not configured (set the credential).'));
				return;
			}

			const conn = {
				region: node.server.region,
				customHost: node.server.customHost,
				tokenId: node.server.credentials.tokenId,
				tokenSecret: node.server.credentials.tokenSecret,
			};
			const ctx = {
				warn: function (message) {
					node.warn(message);
				},
			};

			node.status({ fill: 'blue', shape: 'dot', text: OPERATION_LABELS[operation] });
			Promise.resolve()
				.then(function () {
					return OPERATIONS[operation](conn, params, ctx);
				})
				.then(function (result) {
					msg.payload = result;
					node.status({ fill: 'green', shape: 'dot', text: 'done' });
					send(msg);
					if (done) done();
				})
				.catch(fail);
		});

		node.on('close', function () {
			node.status({});
		});
	}

	RED.nodes.registerType('docspring', DocSpringNode);
};
