const { Client } = require('pg');
const c = new Client('postgresql://postgres:postgres@127.0.0.1:5433/oddjob');
c.connect()
  .then(async () => {
    console.log(`--- Running App Instances ---`);
    const res = await c.query(`
      SELECT i.id, i.app_id, a.name, a.slug, i.port, i.status
      FROM app_instances i
      JOIN apps a ON a.id = i.app_id
      WHERE i.status = 'running'
    `);
    console.log(JSON.stringify(res.rows, null, 2));
  })
  .catch(e => console.error(e.message))
  .finally(() => c.end());
