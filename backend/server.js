
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const ExcelJS = require("exceljs");
const sql = require("mssql");
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const { getSqlPool } = require("./sqlConnection");

require("dotenv").config();

const app = express();
const PORT = 3001;
const LOCATIONS = ["1000", "2000", "3000", "5000"];

for (const key of [
  "SESSION_SECRET",
  "MANAGER_PASSWORD",
  "AUDITOR_PASSWORD"
]) {
  if (!process.env[key]) {
    throw new Error(`Missing ${key} in .env`);
  }
}



const db = new DatabaseSync(
  path.join(__dirname, "pip_audit.db")
);

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sloc TEXT NOT NULL,
    area TEXT NOT NULL,
    area_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL,
    code TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    submitted_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(batch_id) REFERENCES batches(id)
  );

  CREATE TABLE IF NOT EXISTS lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL,
    line_no INTEGER NOT NULL,
    material TEXT DEFAULT '',
    description TEXT DEFAULT '',
    bin TEXT DEFAULT '',
    plant TEXT DEFAULT '',
    stock_category TEXT DEFAULT '',
    batch TEXT DEFAULT '',
    uom TEXT DEFAULT 'EA',
    sap_qty REAL,
    physical_qty REAL,
    is_void INTEGER NOT NULL DEFAULT 0,
    entered_by TEXT,
    entered_at TEXT,
    FOREIGN KEY(card_id) REFERENCES cards(id)
  );
`);


function ensureColumn(table, column, declaration) {
  const columns = db.prepare(
    `PRAGMA table_info(${table})`
  ).all();

  if (!columns.some(item => item.name === column)) {
    db.exec(
      `ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`
    );
  }
}

ensureColumn("batches", "area_id", "INTEGER");
ensureColumn("cards", "submitted_at", "TEXT");
ensureColumn(
  "lines",
  "is_void",
  "INTEGER NOT NULL DEFAULT 0"
);

db.exec(`
  CREATE INDEX IF NOT EXISTS
  idx_cards_batch ON cards(batch_id);

  CREATE INDEX IF NOT EXISTS
  idx_lines_card ON lines(card_id);
`);



app.use(express.json({ limit: "1mb" }));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false
  }
}));

const users = [
  {
    username: "manager",
    role: "manager",
    hash: bcrypt.hashSync(
      process.env.MANAGER_PASSWORD,
      10
    )
  },
  {
    username: "auditor",
    role: "auditor",
    hash: bcrypt.hashSync(
      process.env.AUDITOR_PASSWORD,
      10
    )
  }
];

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      message: "Please sign in"
    });
  }
  next();
}

function requireManager(req, res, next) {
  if (req.session.user?.role !== "manager") {
    return res.status(403).json({
      message: "Manager access required"
    });
  }
  next();
}

function requireAuditor(req, res, next) {
  if (req.session.user?.role !== "auditor") {
    return res.status(403).json({
      message: "Auditor access required"
    });
  }
  next();
}



function clean(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function readCell(cell) {
  const value = cell.value;

  if (value && typeof value === "object") {
    if (value.result !== undefined) {
      return value.result;
    }

    if (value.text !== undefined) {
      return value.text;
    }
  }

  return value ?? "";
}

function getColumn(row, index) {
  return index ? readCell(row.getCell(index)) : "";
}

function parseStock(value) {
  if (typeof value === "number") return value;

  const text = clean(value).replace(/,/g, "");
  return text === "" ? NaN : Number(text);
}

function getBatch(id) {
  return db.prepare(
    "SELECT * FROM batches WHERE id = ?"
  ).get(id);
}

function getCard(code) {
  return db.prepare(`
    SELECT
      c.id,
      c.batch_id,
      c.code,
      c.kind,
      c.submitted_at,
      c.created_at,
      b.sloc,
      b.area,
      b.area_id
    FROM cards c
    JOIN batches b ON b.id = c.batch_id
    WHERE c.code = ?
  `).get(code);
}

function getLines(cardId) {
  return db.prepare(`
    SELECT *
    FROM lines
    WHERE card_id = ?
    ORDER BY line_no
  `).all(cardId);
}

function cardPrefix(batch) {
  return (
    `PIP-${batch.sloc}-PSA-B` +
    String(batch.id).padStart(4, "0")
  );
}

async function findArea(areaId) {
  if (!Number.isSafeInteger(areaId) || areaId <= 0) {
    return null;
  }

  const pool = await getSqlPool();

  const result = await pool.request()
    .input("areaId", sql.Int, areaId)
    .query(`
      SELECT id, strName
      FROM tblAreas
      WHERE id = @areaId
    `);

  return result.recordset[0] || null;
}



app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};

  const user = users.find(
    item => item.username === username
  );

  if (
    !user ||
    typeof password !== "string" ||
    !bcrypt.compareSync(password, user.hash)
  ) {
    return res.status(401).json({
      message: "Invalid username or password"
    });
  }

  req.session.regenerate(error => {
    if (error) {
      return res.status(500).json({
        message: "Login failed"
      });
    }

    req.session.user = {
      username: user.username,
      role: user.role
    };

    res.json(req.session.user);
  });
});

app.get("/api/me", requireLogin, (req, res) => {
  res.json(req.session.user);
});

app.post("/api/logout", requireLogin, (req, res) => {
  req.session.destroy(error => {
    if (error) {
      return res.status(500).json({
        message: "Logout failed"
      });
    }

    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});


app.get(
  "/api/production-areas",
  requireManager,
  async (req, res) => {
    try {
      const pool = await getSqlPool();

      const result = await pool.request().query(`
        SELECT id, strName
        FROM tblAreas
        ORDER BY strName
      `);

      res.json(result.recordset);
    } catch (error) {
      console.error("SQL error:", error.message);

      res.status(503).json({
        message: "Unable to load Production Supply Areas"
      });
    }
  }
);


app.post(
  "/api/import",
  requireManager,
  express.raw({
    type: "application/octet-stream",
    limit: "15mb"
  }),
  async (req, res) => {
    try {
      const sloc = clean(req.headers["x-sloc"]);
      const areaId = Number(req.headers["x-area-id"]);

      if (!LOCATIONS.includes(sloc)) {
        return res.status(400).json({
          message: "Invalid Storage Location"
        });
      }

      if (!Number.isSafeInteger(areaId) || areaId <= 0) {
        return res.status(400).json({
          message: "Select a Production Supply Area"
        });
      }

      const area = await findArea(areaId);

      if (!area) {
        return res.status(400).json({
          message: "Production Supply Area not found"
        });
      }

      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).json({
          message: "Select an Excel file"
        });
      }

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.body);

      const sheet = workbook.worksheets[0];

      if (!sheet) {
        throw new Error("Excel worksheet not found");
      }

      let headers = {};
      let headerRow = 0;

      for (
        let i = 1;
        i <= Math.min(sheet.rowCount, 15);
        i++
      ) {
        const found = {};

        sheet.getRow(i).eachCell((cell, index) => {
          found[normalize(readCell(cell))] = index;
        });

        if (
          (found.material || found.materialnumber) &&
          (
            found.availablestock ||
            found.availableqty ||
            found.availablequantity
          )
        ) {
          headers = found;
          headerRow = i;
          break;
        }
      }

      if (!headerRow) {
        throw new Error(
          "Excel needs Material and Available Stock columns"
        );
      }

      function findColumn(...names) {
        for (const name of names) {
          const column = headers[normalize(name)];
          if (column) return column;
        }

        return 0;
      }

      const cols = {
        material: findColumn(
          "Material",
          "Material Number"
        ),
        description: findColumn(
          "Material Description",
          "Description",
          "Material Desc"
        ),
        sloc: findColumn(
          "SLoc",
          "Storage Location",
          "Storage Loc"
        ),
        bin: findColumn(
          "Storage Bin",
          "StorageBin"
        ),
        plant: findColumn("Plant", "Plnt"),
        stock: findColumn(
          "Stock Category",
          "Stock Type",
          "S"
        ),
        batch: findColumn("Batch"),
        uom: findColumn(
          "BUn",
          "UOM",
          "Base Unit"
        ),
        qty: findColumn(
          "Available Stock",
          "Available Qty",
          "Available Quantity"
        )
      };

      if (!cols.sloc) {
        throw new Error("Storage Location column missing");
      }

      const materials = [];

      for (
        let i = headerRow + 1;
        i <= sheet.rowCount;
        i++
      ) {
        const row = sheet.getRow(i);

        const material = clean(
          getColumn(row, cols.material)
        );

        const rowSloc = clean(
          getColumn(row, cols.sloc)
        );

        if (!material || rowSloc !== sloc) continue;

        const sapQty = parseStock(
          getColumn(row, cols.qty)
        );

        if (!Number.isFinite(sapQty)) {
          throw new Error(
            `Invalid available stock on Excel row ${i}`
          );
        }

        materials.push({
          material,
          description: clean(
            getColumn(row, cols.description)
          ),
          bin: clean(getColumn(row, cols.bin)),
          plant: clean(getColumn(row, cols.plant)),
          stock_category: clean(
            getColumn(row, cols.stock)
          ),
          batch: clean(getColumn(row, cols.batch)),
          uom: clean(getColumn(row, cols.uom)) || "EA",
          sap_qty: sapQty
        });
      }

      if (!materials.length) {
        throw new Error(
          `No materials found for SLoc ${sloc}`
        );
      }

      let batchId;

      db.exec("BEGIN");

      try {
        const createdBatch = db.prepare(`
          INSERT INTO batches (sloc, area, area_id)
          VALUES (?, ?, ?)
        `).run(sloc, area.strName, area.id);

        batchId = Number(
          createdBatch.lastInsertRowid
        );

        const prefix = cardPrefix({
          id: batchId,
          sloc
        });

        const insertCard = db.prepare(`
          INSERT INTO cards (batch_id, code, kind)
          VALUES (?, ?, 'filled')
        `);

        const insertLine = db.prepare(`
          INSERT INTO lines (
            card_id,
            line_no,
            material,
            description,
            bin,
            plant,
            stock_category,
            batch,
            uom,
            sap_qty
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (
          let offset = 0;
          offset < materials.length;
          offset += 10
        ) {
          const page = Math.floor(offset / 10) + 1;

          const code =
            prefix +
            "-" +
            String(page).padStart(4, "0");

          const cardId = Number(
            insertCard.run(batchId, code).lastInsertRowid
          );

          materials
            .slice(offset, offset + 10)
            .forEach((material, index) => {
              insertLine.run(
                cardId,
                index + 1,
                material.material,
                material.description,
                material.bin,
                material.plant,
                material.stock_category,
                material.batch,
                material.uom,
                material.sap_qty
              );
            });
        }

        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }

      res.json({
        batchId,
        sloc,
        area: area.strName,
        materials: materials.length,
        cards: Math.ceil(materials.length / 10)
      });
    } catch (error) {
      console.error("Import error:", error.message);

      res.status(400).json({
        message: error.message
      });
    }
  }
);


app.get("/api/batches", requireManager, (req, res) => {
  res.json(
    db.prepare(`
      SELECT *
      FROM batches
      ORDER BY id DESC
    `).all()
  );
});

app.post(
  "/api/blank-cards",
  requireManager,
  (req, res) => {
    const batchId = Number(req.body?.batchId);
    const quantity = Number(req.body?.quantity);

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 100
    ) {
      return res.status(400).json({
        message: "Choose 1 to 100 blank cards"
      });
    }

    const batch = getBatch(batchId);

    if (!batch) {
      return res.status(404).json({
        message: "Audit batch not found"
      });
    }

    const previous = db.prepare(`
      SELECT COUNT(*) AS total
      FROM cards
      WHERE batch_id = ? AND kind = 'blank'
    `).get(batchId).total;

    const generated = [];
    const prefix = cardPrefix(batch);

    db.exec("BEGIN");

    try {
      const insertCard = db.prepare(`
        INSERT INTO cards (batch_id, code, kind)
        VALUES (?, ?, 'blank')
      `);

      const insertLine = db.prepare(`
        INSERT INTO lines (card_id, line_no)
        VALUES (?, ?)
      `);

      for (let i = 1; i <= quantity; i++) {
        const code =
          prefix +
          "-BL" +
          String(previous + i).padStart(3, "0");

        const cardId = Number(
          insertCard.run(batchId, code).lastInsertRowid
        );

        for (let lineNo = 1; lineNo <= 10; lineNo++) {
          insertLine.run(cardId, lineNo);
        }

        generated.push(code);
      }

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");

      return res.status(500).json({
        message: "Unable to generate blank cards"
      });
    }

    res.json({ generated });
  }
);


app.get(
  "/api/batches/:id/cards",
  requireManager,
  (req, res) => {
    const batch = getBatch(Number(req.params.id));

    if (!batch) {
      return res.status(404).json({
        message: "Audit batch not found"
      });
    }

    const cards = db.prepare(`
      SELECT *
      FROM cards
      WHERE batch_id = ?
      ORDER BY id
    `).all(batch.id);

    res.json(
      cards.map(card => ({
        ...card,
        sloc: batch.sloc,
        area: batch.area,
        area_id: batch.area_id,
        lines: getLines(card.id)
      }))
    );
  }
);



app.get(
  "/api/overview",
  requireManager,
  (req, res) => {
  

    const byPsa = db.prepare(`
      SELECT
        b.area,
        COUNT(c.id) AS generated,
        SUM(
          CASE
            WHEN c.submitted_at IS NOT NULL
            THEN 1 ELSE 0
          END
        ) AS submitted,
        SUM(
          CASE
            WHEN c.submitted_at IS NULL
            THEN 1 ELSE 0
          END
        ) AS pending
      FROM batches b
      JOIN cards c ON c.batch_id = b.id
      GROUP BY b.area
      ORDER BY b.area COLLATE NOCASE
    `).all();

    const summary = byPsa.reduce(
      (totals, row) => {
        totals.generated += row.generated;
        totals.submitted += row.submitted;
        totals.pending += row.pending;
        return totals;
      },
      {
        generated: 0,
        submitted: 0,
        pending: 0
      }
    );

    const cards = db.prepare(`
      SELECT
        c.id,
        c.code,
        c.kind,
        c.submitted_at,
        b.id AS batch_id,
        b.area,
        b.sloc
      FROM cards c
      JOIN batches b ON b.id = c.batch_id
      ORDER BY c.id DESC
    `).all();

    res.json({
      summary,
      byPsa,
      cards
    });
  }
);

app.get(
  "/api/cards/:code",
  requireLogin,
  (req, res) => {
    const code = clean(
      req.params.code
    ).toUpperCase();

    const card = getCard(code);

    if (!card) {
      return res.status(404).json({
        message: "PIP Card not found"
      });
    }

    const lines = getLines(card.id);

    if (req.session.user.role === "manager") {
      return res.json({ ...card, lines });
    }

    
    const safeLines = lines.map(line => {
      const { sap_qty, ...safe } = line;
      return safe;
    });

    res.json({
      ...card,
      lines: safeLines
    });
  }
);


app.post(
  "/api/cards/:code/counts",
  requireAuditor,
  (req, res) => {
    const code = clean(
      req.params.code
    ).toUpperCase();

    const card = getCard(code);

    if (!card) {
      return res.status(404).json({
        message: "PIP Card not found"
      });
    }

    if (card.submitted_at) {
      return res.status(409).json({
        message: "This PIP card has already been submitted"
      });
    }

    if (!Array.isArray(req.body?.lines)) {
      return res.status(400).json({
        message: "Invalid submission"
      });
    }

    const existing = getLines(card.id);
    const incoming = new Map();

    for (const entry of req.body.lines) {
      if (
        !entry ||
        !Number.isSafeInteger(entry.id) ||
        incoming.has(entry.id)
      ) {
        return res.status(400).json({
          message: "Invalid or duplicate row"
        });
      }

      incoming.set(entry.id, entry);
    }

    if (
      incoming.size !== existing.length ||
      existing.some(line => !incoming.has(line.id))
    ) {
      return res.status(400).json({
        message: "All card rows must be submitted"
      });
    }

    const updates = [];
    let counted = 0;
    let voided = 0;

    for (const line of existing) {
      const input = incoming.get(line.id);
      const blankCard = card.kind === "blank";

      const material = blankCard
        ? clean(input.material)
        : line.material;

      const description = blankCard
        ? clean(input.description)
        : line.description;

      const bin = blankCard
        ? clean(input.bin)
        : line.bin;


      const isVoid =
        blankCard &&
        !material &&
        !description &&
        !bin &&
        (input.qty === null || input.qty === "");

      if (
        material.length > 120 ||
        description.length > 500 ||
        bin.length > 120
      ) {
        return res.status(400).json({
          message: `Text too long on row ${line.line_no}`
        });
      }

      if (blankCard && !isVoid && !material) {
        return res.status(400).json({
          message:
            `Enter a material number on row ${line.line_no}`
        });
      }

      const qty = isVoid ? null : input.qty;

      if (
        !isVoid &&
        (
          !Number.isSafeInteger(qty) ||
          qty < 0
        )
      ) {
        return res.status(400).json({
          message:
            `Enter a valid physical count on row ${line.line_no}`
        });
      }

      if (isVoid) {
        voided++;
      } else {
        counted++;
      }

      updates.push({
        id: line.id,
        material,
        description,
        bin,
        qty,
        isVoid: isVoid ? 1 : 0
      });
    }

    if (counted === 0) {
      return res.status(400).json({
        message:
          "A PIP card needs at least one counted material"
      });
    }

    db.exec("BEGIN");

    try {
    
      const freshCard = getCard(code);

      if (freshCard.submitted_at) {
        db.exec("ROLLBACK");

        return res.status(409).json({
          message: "Card was already submitted"
        });
      }

      const updateLine = db.prepare(`
        UPDATE lines
        SET
          material = ?,
          description = ?,
          bin = ?,
          physical_qty = ?,
          is_void = ?,
          entered_by = ?,
          entered_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      for (const line of updates) {
        updateLine.run(
          line.material,
          line.description,
          line.bin,
          line.qty,
          line.isVoid,
          req.session.user.username,
          line.id
        );
      }

      db.prepare(`
        UPDATE cards
        SET submitted_at = CURRENT_TIMESTAMP
        WHERE id = ? AND submitted_at IS NULL
      `).run(card.id);

      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) {
        db.exec("ROLLBACK");
      }

      console.error("Submit error:", error.message);

      return res.status(500).json({
        message: "Unable to submit PIP card"
      });
    }

    res.json({
      success: true,
      code: card.code,
      status: "submitted",
      counted,
      voided
    });
  }
);



app.get(
  "/api/progress/:batchId",
  requireManager,
  (req, res) => {
    const batch = getBatch(
      Number(req.params.batchId)
    );

    if (!batch) return res.sendStatus(404);

    const result = db.prepare(`
      SELECT
        c.code,
        c.kind,
        c.submitted_at,
        COUNT(l.id) AS total_lines,
        SUM(
          CASE WHEN l.physical_qty IS NOT NULL
          THEN 1 ELSE 0 END
        ) AS counted_lines,
        SUM(
          CASE WHEN l.is_void = 1
          THEN 1 ELSE 0 END
        ) AS voided_lines,
        SUM(
          CASE
            WHEN l.sap_qty IS NOT NULL
            AND l.physical_qty IS NOT NULL
            AND l.sap_qty != l.physical_qty
            THEN 1 ELSE 0 END
        ) AS mismatches
      FROM cards c
      JOIN lines l ON l.card_id = c.id
      WHERE c.batch_id = ?
      GROUP BY c.id
      ORDER BY c.id
    `).all(batch.id);

    res.json(result);
  }
);

app.listen(PORT, () => {
  console.log(
    `ABB PIP Audit backend running at http://localhost:${PORT}`
  );
});
