'use strict';

// Converts the values a flow puts in msg.payload into what API v2 accepts: real booleans
// and integers (from strings too), objects and arrays (from JSON strings too). Empty
// values (undefined, null, '') come back as undefined so the caller leaves them out.
// A value that can't be converted throws, naming the payload key.

function isEmpty(value) {
	return value === undefined || value === null || value === '';
}

function isPlainObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value);
}

function toBoolean(name, value) {
	if (isEmpty(value)) return undefined;
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') {
		const v = value.trim().toLowerCase();
		if (v === 'true') return true;
		if (v === 'false') return false;
	}
	throw new Error(name + ' must be true or false');
}

function toInteger(name, value) {
	if (isEmpty(value)) return undefined;
	if (typeof value === 'number' && Number.isInteger(value)) return value;
	if (typeof value === 'string' && /^\s*-?\d+\s*$/.test(value)) return parseInt(value, 10);
	throw new Error(name + ' must be a whole number');
}

function toText(name, value) {
	if (isEmpty(value)) return undefined;
	if (typeof value === 'string') return value;
	if (typeof value === 'number') return String(value);
	throw new Error(name + ' must be text');
}

function parseJson(name, value, what) {
	try {
		return JSON.parse(value);
	} catch (_e) {
		throw new Error(name + ' must be ' + what + ' (or a JSON string of one)');
	}
}

function toObject(name, value) {
	if (isEmpty(value)) return undefined;
	const parsed = typeof value === 'string' ? parseJson(name, value, 'an object') : value;
	if (!isPlainObject(parsed)) throw new Error(name + ' must be an object (or a JSON string of one)');
	return parsed;
}

function toArray(name, value) {
	if (isEmpty(value)) return undefined;
	const parsed = typeof value === 'string' ? parseJson(name, value, 'a list') : value;
	if (!Array.isArray(parsed)) throw new Error(name + ' must be a list (or a JSON string of one)');
	return parsed;
}

// A list of names: an array, or a comma- or newline-separated string.
function toNameList(name, value) {
	if (isEmpty(value)) return undefined;
	let items;
	if (Array.isArray(value)) items = value;
	else if (typeof value === 'string') items = value.split(/[\n,]/);
	else throw new Error(name + ' must be a list, or text separated by commas');
	const list = items.map((s) => String(s).trim()).filter(Boolean);
	return list.length ? list : undefined;
}

function toIntegerList(name, value) {
	const list = toNameList(name, value);
	return list && list.map((item, i) => toInteger(name + '[' + i + ']', item));
}

// A PDF as base64 text. A Buffer (from a File In node, say) is encoded for you.
function toBase64(name, value) {
	if (isEmpty(value)) return undefined;
	if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString('base64');
	return toText(name, value);
}

// RFC 3339 time: a string, or a Date from a Function node.
function toTime(name, value) {
	if (isEmpty(value)) return undefined;
	if (value instanceof Date) return value.toISOString();
	return toText(name, value);
}

function required(name, value) {
	if (isEmpty(value)) throw new Error(name + ' is required');
	return value;
}

// Copies the defined values into a new object, leaving out undefined ones.
function compact(obj) {
	const out = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v !== undefined) out[k] = v;
	}
	return out;
}

module.exports = {
	isEmpty,
	toBoolean,
	toInteger,
	toText,
	toObject,
	toArray,
	toNameList,
	toIntegerList,
	toBase64,
	toTime,
	required,
	compact,
};
