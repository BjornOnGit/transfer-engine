const { port } = require('./config/env');
const app = require('./app');

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});