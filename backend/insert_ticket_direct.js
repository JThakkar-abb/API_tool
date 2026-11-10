const sql = require('mssql');
const { getSqlPool } = require('./sqlConnection');

(async () => {
  const pool = await getSqlPool();
  const request = pool.request();
  request.input('pipNum', sql.NVarChar, 'PIP1000B0015000');
  request.input('status', sql.NVarChar, 'confirmed');
  request.input('typeOfAdd', sql.NVarChar, 'Part');
  request.input('lastUpdate', sql.DateTime, new Date());
  request.input('ticketNumber', sql.Int, 1);
  request.input('material', sql.NVarChar, '26W-3161');

  try {
    const result = await request.query(`
      INSERT INTO INV.Tickets (
        PIPNum,
        Status,
        TypeOfAdd,
        LastUpdate,
        TicketNumber,
        Material
      )
      VALUES (
        @pipNum,
        @status,
        @typeOfAdd,
        @lastUpdate,
        @ticketNumber,
        @material
      );
    `);
    console.log('inserted', result.rowsAffected);
  } catch (error) {
    console.error('ERROR', error.message);
    console.error(error.originalError && error.originalError.message);
    process.exit(1);
  }
})();
