const Decimal = require('decimal.js');

// Isolated Decimal class: high precision, never switches to exponent notation
const D = Decimal.clone({ precision: 40, toExpNeg: -1e9, toExpPos: 1e9 });

const add = (a, b) => new D(a).plus(b).toString();
const subtract = (a, b) => new D(a).minus(b).toString();
const compare = (a, b) => new D(a).comparedTo(b); // -1, 0, or 1
const format = (a, dp = 2) => new D(a).toFixed(dp);

const multiply = (a, b) => new D(a).times(b).toString();

module.exports = { add, subtract, multiply, compare, format };