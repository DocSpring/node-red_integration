'use strict';

require('should');
const fs = require('fs');
const path = require('path');
const { OPERATIONS, OPERATION_LABELS, OPERATION_ALIASES } = require('../lib/operations');

const html = fs.readFileSync(path.join(__dirname, '../nodes/docspring.html'), 'utf8');

function section(attribute) {
	const match = html.match(new RegExp('<script type="text/(?:html|javascript)"' + attribute + '>([\\s\\S]*?)</script>'));
	if (!match) throw new Error('No <script' + attribute + '> in nodes/docspring.html');
	return match[1];
}

// Runs the editor's registerType script with a stub RED and jQuery, and returns the node definition.
function loadDefinition(select) {
	let definition;
	const RED = { nodes: { registerType: (type, def) => (definition = def) } };
	const $ = (selector) => {
		if (selector === '#node-input-operation') return select;
		if (selector === '<option>') {
			const option = {
				val: (v) => ((option.value = v), option),
				text: (t) => ((option.label = t), option),
				prependTo: (target) => (target.options.unshift(option), option),
			};
			return option;
		}
		throw new Error('Unexpected selector ' + selector);
	};
	new Function('RED', '$', section(''))(RED, $);
	return definition;
}

function stubSelect() {
	const select = { options: [], value: undefined };
	select.val = (v) => (v === undefined ? select.value : ((select.value = v), select));
	return select;
}

describe('DocSpring node editor', function () {
	it('lists every operation, in order, with its label', function () {
		const options = [...section(' data-template-name="docspring"').matchAll(/<option value="(\w+)">([^<]+)<\/option>/g)];
		options.map((m) => m[1]).should.eql(Object.keys(OPERATIONS));
		options.map((m) => m[2]).should.eql(Object.keys(OPERATIONS).map((op) => OPERATION_LABELS[op]));
	});

	it('documents every operation in the help, with its msg.operation name', function () {
		const help = section(' data-help-name="docspring"');
		for (const operation of Object.keys(OPERATIONS)) {
			help.should.containEql('<h3>' + OPERATION_LABELS[operation] + '</h3>\n\t<p>(<code>' + operation + '</code>)</p>');
		}
		for (const old of ['createDataRequest', 'findTemplate', 'findSubmission', 'data_requests', 'data_request_id', 'token_type', 'combined_submission']) {
			help.should.containEql('<code>' + old + '</code>');
		}
	});

	it("labels nodes with the operation, saved 0.1.x values included", function () {
		const def = loadDefinition(stubSelect());
		def.label.call({ operation: 'combinePdfs' }).should.equal('DocSpring: Combine PDFs');
		def.label.call({ operation: 'createDataRequest' }).should.equal('DocSpring: Create Signature Request');
		def.label.call({ operation: 'findTemplate' }).should.equal('DocSpring: Find Templates');
		def.label.call({ operation: 'findSubmission' }).should.equal('DocSpring: Find Submission');
		def.label.call({ operation: 'apiCall', name: 'Mine' }).should.equal('Mine');
		for (const operation of Object.keys(OPERATIONS)) {
			def.label.call({ operation }).should.equal('DocSpring: ' + OPERATION_LABELS[operation]);
		}
	});

	it('selects the new operation when it opens a saved 0.1.x node', function () {
		for (const [old, current] of Object.entries(OPERATION_ALIASES)) {
			if (typeof current !== 'string') continue;
			const select = stubSelect();
			select.value = null; // the stored value has no option
			loadDefinition(select).oneditprepare.call({ operation: old });
			select.value.should.equal(current);
		}
	});

	it('keeps a saved findSubmission until someone picks Get Submission or Find Submissions', function () {
		const select = stubSelect();
		loadDefinition(select).oneditprepare.call({ operation: 'findSubmission' });
		select.value.should.equal('findSubmission');
		select.options.length.should.equal(1);
		select.options[0].value.should.equal('findSubmission');
		select.options[0].label.should.equal('Find Submission (Get Submission or Find Submissions)');
	});

	it('leaves a current operation alone', function () {
		const select = stubSelect();
		select.value = 'getTemplate';
		loadDefinition(select).oneditprepare.call({ operation: 'getTemplate' });
		select.value.should.equal('getTemplate');
		select.options.length.should.equal(0);
	});
});
