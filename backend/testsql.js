
const { getSqlPool } = require("./sqlConnection");

async function testConnection() {
  try {
    const pool = await getSqlPool();

    console.log("SQL Server connected successfully!");

    const result = await pool.request().query(`
      SELECT id, strName
      FROM tblAreas
      ORDER BY strName
    `);

    console.log(
      "Total Production Supply Areas:",
      result.recordset.length
    );

    console.table(result.recordset);

    await pool.close();
  } catch (error) {
    console.error(
      "SQL Connection Error:",
      error.message
    );

    process.exitCode = 1;
  }
}

testConnection();
