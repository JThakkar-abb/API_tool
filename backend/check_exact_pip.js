const { getSqlPool } = require('./sqlConnection');

(async () => {
  const pool = await getSqlPool();
  const sql = "SELECT * FROM INV.PIP WHERE PIPNum = @pipNum;";
  const req = pool.request();
  req.input('pipNum', require('mssql').NVarChar, 'PIP1000B0015000');
  const p = await req.query(sql);
  console.log(JSON.stringify(p.recordset, null, 2));

  const tickets = await pool.request().query("SELECT * FROM INV.Tickets WHERE PIPNum = 'PIP1000B0015000';");
  console.log('Tickets');
  console.log(JSON.stringify(tickets.recordset, null, 2));

  const bom = await pool.request().query("SELECT * FROM INV.BOM_Complex_Catalog WHERE PI_Card = 'PIP1000B0015000';");
  console.log('BOM');
  console.log(JSON.stringify(bom.recordset, null, 2));
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
