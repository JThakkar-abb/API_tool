const { getSqlPool } = require('./sqlConnection');
(async () => {
  const pool = await getSqlPool();
  const pip = await pool.request().query("SELECT TOP 10 PIPNum, Area, Status, LastUpdate FROM INV.PIP ORDER BY LastUpdate DESC");
  const tickets = await pool.request().query("SELECT TOP 20 PIPNum, TicketNumber, Material, Status FROM INV.Tickets ORDER BY LastUpdate DESC");
  const bom = await pool.request().query("SELECT TOP 20 PI_Card, Material, TicketNumber FROM INV.BOM_Complex_Catalog ORDER BY Date_In DESC");
  console.log('PIP_ROWS');
  console.table(pip.recordset);
  console.log('TICKET_ROWS');
  console.table(tickets.recordset);
  console.log('BOM_ROWS');
  console.table(bom.recordset);
  process.exit(0);
})().catch(err => { console.error(err.message); process.exit(1); });
