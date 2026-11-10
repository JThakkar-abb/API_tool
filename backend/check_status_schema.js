const { getSqlPool } = require('./sqlConnection');

(async () => {
  const pool = await getSqlPool();
  const tables = ['INV.PIP', 'INV.Tickets', 'INV.BOM_Complex_Catalog'];

  for (const table of tables) {
    const [schema, name] = table.split('.');
    const result = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${name}'
      ORDER BY ORDINAL_POSITION;
    `);

    console.log(`--- ${table} ---`);
    console.log(JSON.stringify(result.recordset, null, 2));
  }

  process.exit(0);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
