// CommonJS module. Entry point; not imported by tests.
const app = require('./app');

const PORT = process.env.PORT || 3000; // type: number (coerced from env string)

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
