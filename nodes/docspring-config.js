module.exports = function (RED) {
	'use strict';

	const { docSpringRequest } = require('../lib/docspring');

	// The last version of this package that called API v1, for self-hosted servers without v2.
	const LAST_V1_VERSION = '0.1.0';

	// Config node holding the DocSpring connection: region + custom host (non-secret)
	// and the API token id/secret (stored encrypted as Node-RED credentials).
	function DocSpringConfigNode(n) {
		RED.nodes.createNode(this, n);
		this.name = n.name;
		this.region = n.region || 'us';
		this.customHost = n.customHost || '';
	}

	RED.nodes.registerType('docspring-config', DocSpringConfigNode, {
		credentials: {
			tokenId: { type: 'text' },
			tokenSecret: { type: 'password' },
		},
	});

	// Admin endpoint for the "Test connection" button in the config editor.
	// Calls GET /api/v2/authentication with the entered (or already-saved) credentials.
	RED.httpAdmin.post(
		'/docspring-config/:id/test',
		RED.auth.needsPermission('docspring-config.read'),
		function (req, res) {
			const body = req.body || {};
			const node = RED.nodes.getNode(req.params.id);
			const saved = (node && node.credentials) || {};

			// The editor sends __PWRD__ for a saved password it doesn't show.
			const tokenId = body.tokenId || saved.tokenId;
			const tokenSecret = body.tokenSecret && body.tokenSecret !== '__PWRD__' ? body.tokenSecret : saved.tokenSecret;
			const region = body.region || (node && node.region) || 'us';
			const customHost = body.customHost || (node && node.customHost) || '';

			if (!tokenId || !tokenSecret) {
				res.json({ ok: false, message: 'Enter a Token ID and Token Secret first.' });
				return;
			}

			docSpringRequest({ region, customHost, tokenId, tokenSecret }, 'GET', '/authentication')
				.then(function (d) {
					if (d && d.authenticated === true) {
						res.json({ ok: true, message: 'Connection successful.' });
					} else {
						res.json({ ok: false, message: 'Unexpected response from DocSpring: ' + JSON.stringify(d) });
					}
				})
				.catch(function (err) {
					let message = err.message;
					if (err.statusCode === 401) {
						message = 'Invalid DocSpring API token. Check your ID, secret, and region.';
					} else if (err.statusCode === 404 && region === 'self_hosted') {
						message =
							"This DocSpring server doesn't have API v2 yet. Upgrade it to the latest release, " +
							'or use version ' +
							LAST_V1_VERSION +
							' of this integration.';
					}
					res.json({ ok: false, message: message });
				});
		},
	);
};
