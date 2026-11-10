const { getSqlPool } = require('./sqlConnection');

(async () => {
  const pool = await getSqlPool();
  const p = await pool.request().query("SELECT TOP 10 * FROM INV.PIP WHERE PIPNum LIKE '%B0015%' ORDER BY ID DESC;");
  const t = await pool.request().query("SELECT * FROM INV.Tickets WHERE PIPNum LIKE '%B0015%' ORDER BY TicketNumber;");
  const b = await pool.request().query("SELECT * FROM INV.BOM_Complex_Catalog WHERE PI_Card LIKE '%B0015%' ORDER BY TicketNumber;");

  console.log('--- PIP ---');
  console.log(JSON.stringify(p.recordset, null, 2));
  console.log('--- Tickets ---');
  console.log(JSON.stringify(t.recordset, null, 2));
  console.log('--- BOM ---');
  console.log(JSON.stringify(b.recordset, null, 2));

  process.exit(0);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
