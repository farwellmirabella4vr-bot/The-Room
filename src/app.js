// CommonJS module. Exports a configured Express application (not listening).
const express = require('express');
const helloRouter = require('./routes/hello');

const app = express(); // type: express.Express

app.set('case sensitive routing', true);
// 'strict routing' left at Express default (false), so trailing slashes
// on registered paths are treated as equivalent (see Edge Cases).

app.use('/api', helloRouter);

module.exports = app; // type: express.Express
