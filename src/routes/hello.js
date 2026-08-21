// CommonJS module. Exports an Express Router instance.
const express = require('express');
const router = express.Router({ caseSensitive: true });

// GET /hello (mounted at /api -> full path /api/hello)
// Handler signature: (req: express.Request, res: express.Response) => void
router.get('/hello', (req, res) => {
  res.status(200).json({ message: 'Hello, World!' });
});

module.exports = router; // type: express.Router
