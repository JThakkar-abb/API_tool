
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const ExcelJS = require("exceljs");
const sql = require("mssql");
const path = require("node:path");
const { sso } = require("node-expose-sspi");
const { getSqlPool } = require("./sqlConnection");
const sqlQueries = require("./mssql/queries.js");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const app = express();
const IS_PRODUCTION =
  process.env.NODE_ENV === "production" ||
  !!process.env.IISNODE_VERSION;
const PORT = 3001;
const LOCATIONS = ["1000", "2000", "3000", "5000"];

app.use(cors({
  origin: IS_PRODUCTION
    ? false
    : `http://localhost:5173`,
  credentials: true
}));

const requiredEnvironment = [
  "SESSION_SECRET",
  "MANAGER_PASSWORD",
  "AUDITOR_PASSWORD"
];
const missingEnvironment = requiredEnvironment.filter(
  key => !process.env[key]
);

if (missingEnvironment.length) {
  throw new Error(
    `Missing required backend environment variables: ${missingEnvironment.join(", ")}`
  );
}

const generatedBatches = new Map();
let nextBatchId = 1;
let nextCardId = 1;
let nextLineId = 1;

function addGeneratedBatch({ sloc, area, areaId, leaders = [] }) {
  const id = nextBatchId++;
  const batch = {
    id,
    sloc,
    area,
    area_id: areaId,
    leaders,
    created_at: new Date().toISOString(),
    cards: []
  };

  generatedBatches.set(id, batch);
  return batch;
}

function getGeneratedBatch(batchId) {
  const id = Number(batchId);
  return generatedBatches.get(id) || null;
}

function getGeneratedCardsForBatch(batchId) {
  const batch = getGeneratedBatch(batchId);
  return batch ? [...batch.cards] : [];
}

function addGeneratedCards({ batchId, cards = [] }) {
  const batch = getGeneratedBatch(batchId);
  if (!batch) return [];

  for (const card of cards) {
    const cardRecord = {
      id: nextCardId++,
      batch_id: batch.id,
      code: card.code,
      kind: card.kind || "filled",
      submitted_at: null,
      created_at: new Date().toISOString(),
      sloc: batch.sloc,
      area: batch.area,
      area_id: batch.area_id,
      leaders: batch.leaders,
      lines: (card.lines || []).map((line, index) => ({
        id: nextLineId++,
        card_id: 0,
        line_no: line.line_no ?? index + 1,
        material: line.material || "",
        description: line.description || "",
        bin: line.bin || "",
        location_type: line.location_type || "",
        plant: line.plant || "",
        stock_category: line.stock_category || "",
        batch: line.batch || "",
        uom: line.uom || "EA",
        sap_qty: line.sap_qty ?? null,
        physical_qty: line.physical_qty ?? null,
        is_void: Number(line.is_void ?? 0),
        entered_by: line.entered_by || null,
        entered_at: line.entered_at || null
      }))
    };

    cardRecord.lines = cardRecord.lines.map(line => ({
      ...line,
      card_id: cardRecord.id
    }));

    batch.cards.push(cardRecord);
  }

  return batch.cards;
}

function logField(value, max) {
  return String(value ?? "").slice(0, max);
}

async function writeLog({ activity, userName, targetUser, pip, letterHead, message }) {
  if (!activity) return;

  try {
    const pool = await getSqlPool();
    const request = pool.request();
    request.input("activity", sql.VarChar(32), logField(activity, 32));
    request.input("userName", sql.VarChar(32), logField(userName, 32));
    request.input("targetUser", sql.VarChar(32), logField(targetUser, 32));
    request.input("pip", sql.VarChar(50), logField(pip, 50));
    request.input("letterHead", sql.VarChar(10), logField(letterHead, 10));
    request.input("message", sql.VarChar(512), logField(message, 512));

    await request.query(`
      INSERT INTO INV.Log (Activity, [User], DateTime, TargetUser, PIP, LetterHead, Message)
      VALUES (@activity, @userName, GETDATE(), @targetUser, @pip, @letterHead, @message);
    `);
  } catch (error) {
    console.error("Log write failed:", error.message);
  }
}

let financeTablesReady = false;
let financeTablesPromise = null;

async function ensureFinanceTables() {
  if (financeTablesReady) return;
  if (financeTablesPromise) return financeTablesPromise;

  financeTablesPromise = (async () => {
    const pool = await getSqlPool();
    await pool.request().query(`
      IF OBJECT_ID(N'INV.FinanceUploads', N'U') IS NULL
      BEGIN
        CREATE TABLE INV.FinanceUploads (
          ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
          Filename NVARCHAR(260) NOT NULL,
          UploadedBy NVARCHAR(128) NOT NULL,
          UploadedAt DATETIME2(3) NOT NULL
            CONSTRAINT DF_FinanceUploads_UploadedAt DEFAULT SYSUTCDATETIME(),
          SnapshotDate DATE NULL,
          Status NVARCHAR(16) NOT NULL
            CONSTRAINT DF_FinanceUploads_Status DEFAULT N'pending'
        );
      END;

      IF OBJECT_ID(N'INV.FinanceInventory', N'U') IS NULL
      BEGIN
        CREATE TABLE INV.FinanceInventory (
          ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
          UploadID INT NOT NULL,
          Material NVARCHAR(100) NOT NULL,
          Description NVARCHAR(MAX) NOT NULL
            CONSTRAINT DF_FinanceInventory_Description DEFAULT N'',
          SLoc NVARCHAR(16) NOT NULL,
          SapQty DECIMAL(28,8) NOT NULL,
          SapValue DECIMAL(28,8) NOT NULL,
          Currency CHAR(3) NOT NULL,
          CONSTRAINT FK_FinanceInventory_FinanceUploads
            FOREIGN KEY (UploadID) REFERENCES INV.FinanceUploads(ID)
        );
      END;

      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'INV.FinanceInventory')
          AND name = N'IX_FinanceInventory_UploadID'
      )
        CREATE INDEX IX_FinanceInventory_UploadID
          ON INV.FinanceInventory(UploadID);

      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'INV.FinanceInventory')
          AND name = N'IX_FinanceInventory_Material_SLoc'
      )
        CREATE INDEX IX_FinanceInventory_Material_SLoc
          ON INV.FinanceInventory(Material, SLoc);
    `);
    financeTablesReady = true;
  })().catch(error => {
    financeTablesPromise = null;
    throw error;
  });

  return financeTablesPromise;
}

let ticketLocationColumnsReady = false;
let ticketLocationColumnsPromise = null;

async function ensureTicketLocationColumns() {
  if (ticketLocationColumnsReady) return;
  if (ticketLocationColumnsPromise) return ticketLocationColumnsPromise;

  ticketLocationColumnsPromise = (async () => {
    const pool = await getSqlPool();
    await pool.request().query(`
      IF COL_LENGTH(N'INV.Tickets', N'LocationType') IS NULL
        ALTER TABLE INV.Tickets ADD LocationType NVARCHAR(16) NULL;

      IF COL_LENGTH(N'INV.Tickets', N'LocationValue') IS NULL
        ALTER TABLE INV.Tickets ADD LocationValue NVARCHAR(128) NULL;
    `);
    ticketLocationColumnsReady = true;
  })().catch(error => {
    ticketLocationColumnsPromise = null;
    throw error;
  });

  return ticketLocationColumnsPromise;
}

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


const localUsers = !IS_PRODUCTION
  ? [
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
    ]
  : [];

function getIisWindowsIdentity(req) {
  const identity =
    req.sso?.user?.name ||
    req.headers["x-iis-windows-user"] ||
    req.headers["http-x-iis-windows-user"] ||
    req.headers["http-auth-user"] ||
    req.headers["http-logon-user"] ||
    req.headers["x-iisnode-auth_user"] ||
    req.headers["x-iisnode-logon_user"] ||
    req.headers["x-iisnode-remote_user"] ||
    req.headers["remote-user"];

  if (typeof identity !== "string") return "";

  return identity
    .replace(/^.*\\/, "")
    .replace(/^.+@[^@]+$/, value => value.split("@")[0])
    .trim()
    .toLowerCase();
}

function mapAuthorizedLevel(level) {
  const normalized = String(level || "").trim().toLowerCase();

  if (["admin", "manager", "finance"].includes(normalized)) {
    return "manager";
  }

  if (normalized === "auditor") {
    return "auditor";
  }

  return null;
}

async function findWindowsUser(username) {
  const pool = await getSqlPool();
  const result = await pool.request()
    .input("alias", sql.NVarChar(128), username)
    .query(`
      SELECT TOP 1 Alias, Level
      FROM Engineering.INV.Users
      WHERE LOWER(LTRIM(RTRIM(Alias))) = @alias
    `);

  const row = result.recordset[0];
  if (!row) return null;

  const role = mapAuthorizedLevel(row.Level);
  if (!role) return null;

  return {
    username: String(row.Alias).trim(),
    role
  };
}

/* =====================================
   FINANCE ACCESS CONFIGURATION
===================================== */

if (!process.env.FINANCE_PASSWORD) {
  throw new Error(
    "FINANCE_PASSWORD is missing from backend/.env"
  );
}

const financePasswordHash = bcrypt.hashSync(
  process.env.FINANCE_PASSWORD,
  10
);

// Finance access requires:
// 1. An authenticated Manager session
// 2. A successful Finance password check

function requireFinance(req, res, next) {
  if (
    req.session.user?.role !== "manager" ||
    req.session.financeUnlocked !== true
  ) {
    return res.status(403).json({
      message: "Finance authorization required"
    });
  }

  next();
}

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

function formatBinWithStation(bin, station) {
  const cleanedBin = clean(bin);
  const cleanedStation = clean(station);

  if (!cleanedBin && !cleanedStation) return "";
  if (!cleanedBin) return cleanedStation;
  if (!cleanedStation) return cleanedBin;

  return `${cleanedBin} - ${cleanedStation}`;
}

function splitLocationValues(value, splitWhitespaceSeparatedBins = false) {
  return clean(value)
    .split(/[;,]/)
    .flatMap(segment => {
      const item = segment.trim().replace(/^bin:\s*/i, "");
      const tokens = item.split(/\s+/);
      const isBinList = splitWhitespaceSeparatedBins &&
        tokens.length > 1 &&
        tokens.every(token => /^[A-Z]\.\d+(?:\.\d+)+$/i.test(token));

      return isBinList ? tokens : [item];
    })
    .filter(item => item && !/^#N\/A$/i.test(item));
}

function expandMaterialLocations(materials) {
  const groupedMaterials = new Map();

  for (const material of materials) {
    const groupKey = [
      material.material,
      material.description,
      material.plant,
      material.uom,
      material.location
    ]
      .map(clean)
      .join("\u0000");
    let group = groupedMaterials.get(groupKey);

    if (!group) {
      group = { ...material, locations: new Map() };
      groupedMaterials.set(groupKey, group);
    }

    for (const value of splitLocationValues(material.bin, true)) {
      group.locations.set(`bin\u0000${value}`, { type: "bin", value });
    }

    for (const value of splitLocationValues(material.station)) {
      group.locations.set(`station\u0000${value}`, { type: "station", value });
    }
  }

  return [...groupedMaterials.values()].flatMap(group => {
    const typeOrder = { bin: 0, station: 1 };
    const locations = [...group.locations.values()].sort((left, right) =>
      typeOrder[left.type] - typeOrder[right.type] ||
      left.value.localeCompare(right.value, undefined, { numeric: true, sensitivity: "base" })
    );
    const rows = locations.length ? locations : [{ type: "", value: "" }];

    return rows.map(location => ({
      ...group,
      locations: undefined,
      bin: location.value,
      location_type: location.type
    }));
  });
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

async function getBatch(id) {
  const pool = await getSqlPool();
  const result = await pool.request()
    .input("id", sql.Int, Number(id))
    .query("SELECT * FROM dbo.Batches WHERE id = @id");

  return result.recordset[0] || null;
}

function normalizePipCode(value) {
  return clean(value).toUpperCase();
}

function findGeneratedCardByCode(code) {
  const normalized = normalizePipCode(code);

  for (const batch of generatedBatches.values()) {
    const card = batch.cards.find(item => normalizePipCode(item.code) === normalized);
    if (card) {
      card.sloc = batch.sloc;
      card.area = batch.area;
      card.area_id = batch.area_id;
      card.batch_id = batch.id;
      card.kind = card.kind || "filled";
      return card;
    }
  }

  return null;
}

async function getCard(code) {
  const normalized = normalizePipCode(code);
  const generatedCard = findGeneratedCardByCode(normalized);

  if (generatedCard) {
    return {
      id: generatedCard.id,
      code: generatedCard.code,
      area: generatedCard.area,
      subArea: generatedCard.area,
      sloc: generatedCard.sloc,
      batch_id: generatedCard.batch_id,
      status: generatedCard.submitted_at ? "confirmed" : "pending",
      submitted_at: generatedCard.submitted_at || null,
      created_at: generatedCard.created_at || null,
      kind: generatedCard.kind || "filled",
      area_id: generatedCard.area_id || null,
      leaders: generatedCard.leaders || [],
      is_recount: !!generatedCard.is_recount
    };
  }

  const pool = await getSqlPool();
  const result = await pool.request()
    .input("code", sql.NVarChar, normalized)
    .query(`
      SELECT TOP 1
        PIPNum AS code,
        Area AS area,
        SubArea AS subArea,
        Status AS status,
        AliasAssigned AS aliasAssigned,
        CASE WHEN Status = 'confirmed' THEN LastUpdate ELSE NULL END AS submitted_at,
        LastUpdate AS created_at,
        0 AS id,
        0 AS batch_id,
        CASE WHEN PIPNum LIKE '%-BL%' THEN 'blank' ELSE 'filled' END AS kind,
        CONVERT(NVARCHAR(32), NULL) AS sloc,
        NULL AS area_id,
        CASE WHEN EXISTS (
          SELECT 1
          FROM INV.Tickets t
          WHERE t.PIPNum = INV.PIP.PIPNum
            AND t.Status = 'rc pending'
            AND t.Recount = 1
        ) THEN 1 ELSE 0 END AS is_recount
      FROM INV.PIP
      WHERE PIPNum = @code
    `);

  return result.recordset[0] || null;
}

async function getSqlLines(code) {
  const normalized = normalizePipCode(code);
  await ensureTicketLocationColumns();
  const pool = await getSqlPool();
  const result = await pool.request()
    .input("pipNum", sql.NVarChar, normalized)
    .query(`
      SELECT
        t.TicketNumber AS line_no,
        t.TicketNumber AS id,
        t.Material AS material,
        COALESCE(pu.MaterialDescription, '') AS description,
        COALESCE(pu.Plant, '') AS plant,
        COALESCE(pu.UnitMeasurement, 'EA') AS uom,
        t.Status AS status,
        COALESCE(t.Recount, 0) AS recount,
        t.LocationType AS location_type,
        t.LocationValue AS location_value,
        MIN(COALESCE(s.Bin, '')) AS bin,
        MIN(COALESCE(s.Station, '')) AS station,
        MAX(b.PI_Card_Qty) AS physical_qty,
        0 AS is_void,
        0 AS card_id
      FROM INV.Tickets t
      LEFT JOIN INV.PartUniverse pu
        ON pu.Material = t.Material
      LEFT JOIN INV.AllStationBinData s
        ON s.Material = t.Material
       AND s.ProductionArea = (
         SELECT TOP 1 COALESCE(SubArea, Area)
         FROM INV.PIP
         WHERE PIPNum = @pipNum
       )
      LEFT JOIN INV.BOM_Complex_Catalog b
        ON b.PI_Card = t.PIPNum
       AND CAST(b.TicketNumber AS NVARCHAR(50)) = CAST(t.TicketNumber AS NVARCHAR(50))
      WHERE t.PIPNum = @pipNum
      GROUP BY
        t.TicketNumber,
        t.Material,
        pu.MaterialDescription,
        pu.Plant,
        pu.UnitMeasurement,
        t.Status,
        t.Recount,
        t.LocationType,
        t.LocationValue
      ORDER BY TRY_CAST(t.TicketNumber AS INT), t.TicketNumber
    `);

  const isBlank = normalized.includes("-BL");
  return (result.recordset || []).map((line, index) => {
    const locationType = clean(line.location_type).toLowerCase();
    const locationValue = clean(line.location_value);

    return {
      ...line,
      line_no: index + 1,
      id: Number(line.id),
      status: line.status ?? line.Status ?? null,
      recount: Number(line.recount ?? line.Recount ?? 0),
      description: isBlank ? "" : line.description || "",
      bin: isBlank
        ? ""
        : locationValue || formatBinWithStation(line.bin, line.station),
      location_type: locationType,
      plant: clean(line.plant),
      uom: clean(line.uom) || "EA"
    };
  });
}

async function getLines(code) {
  const generatedCard = findGeneratedCardByCode(code);

  if (generatedCard && !generatedCard.is_recount) {
    return (generatedCard.lines || []).map(line => ({
      ...line,
      id: Number(line.id),
      line_no: Number(line.line_no),
      physical_qty: line.physical_qty === null || line.physical_qty === undefined ? null : Number(line.physical_qty),
      is_void: Number(line.is_void) === 1,
      recount: Number(line.recount ?? 0),
      description: line.description || "",
      material: line.material || "",
      bin: line.bin || "",
      card_id: Number(line.card_id)
    }));
  }

  return getSqlLines(code);
}

function buildPipCardCode({ sloc, areaId, batchId, pageNumber }) {
  const normalizedSloc = String(sloc ?? "").trim().padStart(4, "0");
  const normalizedAreaId = String(areaId ?? "0").trim().padStart(3, "0");
  const normalizedBatch = String(batchId ?? "0").trim().padStart(4, "0");
  const normalizedPage = String(pageNumber ?? "1").trim().padStart(4, "0");

  return `PIP-${normalizedSloc}-${normalizedAreaId}-B${normalizedBatch}-${normalizedPage}`;
}

function cardPrefix(batch) {
  return `PIP-${String(batch.sloc ?? "").trim().padStart(4, "0")}-${String(batch.area_id ?? "0").trim().padStart(3, "0")}-B${String(batch.id ?? "0").trim().padStart(4, "0")}`;
}

function determineTicketType(material, isVoid = false) {
  if (isVoid) return "Cancelled";

  const value = clean(material).toUpperCase();

  if (!value) return "Part";
  if (value.includes("FG")) return "FG";
  if (value.includes("PO") || value.includes("PURCHASE") || value.includes("ORDER")) return "PO";

  return "Part";
}

function resolveTicketNumber({ cardIndex = 0, lineNo = 0 }) {
  const value = Number(lineNo ?? 0) || 0;

  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  if (value >= 1000) {
    return value;
  }

  return (Number(cardIndex ?? 0) * 1000) + value;
}

function toSqlPipNum(cardCode) {
  const value = clean(cardCode).toUpperCase();

  if (!value) {
    return "";
  }

  return value;
}

async function insertBomComplexCatalogRows({ cardCode, userName, lines = [], cardIndex = 0, poOrder = "", poLines = [] }) {
  const pool = await getSqlPool();
  const sqlPipNum = toSqlPipNum(cardCode);

  const ticketRows = (await pool.request()
    .input("pipNum", sql.NVarChar, sqlPipNum)
    .query(`
      SELECT
        TicketNumber,
        Material,
        Status
      FROM INV.Tickets
      WHERE PIPNum = @pipNum
      ORDER BY TicketNumber
    `)).recordset || [];

  const persistedTicketNumbers = ticketRows
    .map(row => Number(row.TicketNumber ?? 0))
    .filter(value => Number.isFinite(value) && value > 0);

  const lineLookup = new Map();
  for (const line of Array.isArray(lines) ? lines : []) {
    const ticketNumber = Number(line.line_no ?? line.lineNo ?? line.TicketNumber ?? 0);
    const material = clean(line.material || line.Material || "");
    const key = ticketNumber > 0 ? String(ticketNumber) : material;

    if (key) {
      lineLookup.set(key, line);
    }
  }

  const rowsToInsert = [];

  if (poOrder && Array.isArray(poLines) && poLines.length) {
    const primaryTicketNumber = persistedTicketNumbers[0] || resolveTicketNumber({ cardIndex, lineNo: 1 });

    for (const poLine of poLines) {
      const material = clean(poLine.material);
      const qty = Number(poLine.qty);

      if (!material || !Number.isFinite(qty) || qty < 0) {
        continue;
      }

      rowsToInsert.push({
        TicketNumber: primaryTicketNumber,
        Material: material,
        Status: "confirmed",
        qty,
        printedQty: Number(poLine.printedQty ?? 0)
      });
    }
  } else {
    for (const [index, line] of (Array.isArray(lines) ? lines : []).entries()) {
      const material = clean(line.material || line.Material || "");
      const rawQty = line.physical_qty ?? line.qty;
      const hasQty = rawQty !== null && rawQty !== undefined && rawQty !== "";
      const qty = hasQty ? Number(rawQty) : NaN;

      if (!material || !hasQty || !Number.isFinite(qty) || qty < 0) {
        continue;
      }

      const persistedTicketNumber = Number(persistedTicketNumbers[index] ?? 0);
      const fallbackTicketNumber = Number(line.line_no ?? line.lineNo ?? line.TicketNumber ?? 0);
      const ticketNumber = persistedTicketNumber > 0 ? persistedTicketNumber : fallbackTicketNumber;

      if (!ticketNumber) {
        continue;
      }

      rowsToInsert.push({
        TicketNumber: ticketNumber,
        Material: material,
        Status: "confirmed",
        qty
      });
    }

    if (!rowsToInsert.length && ticketRows.length) {
      for (const ticketRow of ticketRows) {
        const material = clean(ticketRow.Material || "");
        const ticketNumber = Number(ticketRow.TicketNumber ?? 0);
        const matchedLine = lineLookup.get(String(ticketNumber)) || lineLookup.get(material) || {};
        const rawQty = matchedLine.physical_qty ?? matchedLine.qty;
        const hasQty = rawQty !== null && rawQty !== undefined && rawQty !== "";
        const qty = hasQty ? Number(rawQty) : NaN;

        if (material && hasQty && Number.isFinite(qty) && qty >= 0) {
          rowsToInsert.push({
            TicketNumber: ticketNumber,
            Material: material,
            Status: "confirmed",
            qty
          });
        }
      }
    }
  }

  for (const ticketRow of rowsToInsert) {
    const material = clean(ticketRow.Material || "");
    const ticketNumber = Number(ticketRow.TicketNumber ?? 0);
    const qty = Number(ticketRow.qty ?? 0);

    if (!material || !Number.isFinite(qty) || qty < 0) {
      continue;
    }

    const materialRequest = pool.request();
    materialRequest.input("material", sql.NVarChar, material);

    const materialResult = await materialRequest.query(`
      SELECT TOP 1
        Material,
        Plant,
        ProcurementType AS ProcType,
        SpecialProcType AS SpecialStock,
        BackFlush,
        COST AS UnitCost,
        Location,
        UnitMeasurement,
        [Bulk] AS BulkMaterial,
        MaterialDescription
      FROM INV.PartUniverse
      WHERE Material = @material
    `);

    const materialRow = materialResult.recordset[0] || {};
    const unitCost = Number(materialRow.UnitCost ?? 0);
    const totalCost = Number((unitCost * qty).toFixed(4));
    const materialLocation = clean(materialRow.Location || "");
    const procType = clean(materialRow.ProcType || "");
    const specialStock = clean(materialRow.SpecialStock || "");
    const backflush = clean(materialRow.BackFlush || "");
    const unitMeasurement = clean(materialRow.UnitMeasurement || "EA");
    const bulkMaterial = clean(materialRow.BulkMaterial || "");
    const insertTicketNumber = ticketNumber;
    const typeOfAddition = determineTicketType(material, false);

    const insertRequest = pool.request();
    insertRequest
      .input("piCard", sql.NVarChar, sqlPipNum)
      .input("status", sql.NVarChar, "PEN")
      .input("employeeAlias", sql.NVarChar, clean(userName))
      .input("material", sql.NVarChar, material)
      .input("piCardQty", sql.Decimal(8, 2), Number(qty))
      .input("procType", sql.NVarChar, procType)
      .input("ticketNumber", sql.Int, insertTicketNumber)
      .input("typeOfAddition", sql.NVarChar, typeOfAddition)
      .input("unitOfMeasure", sql.NVarChar, unitMeasurement)
      .input("bulkMaterial", sql.NVarChar, bulkMaterial)
      .input("specialStock", sql.NVarChar, specialStock)
      .input("backflush", sql.NVarChar, backflush)
      .input("materialCost", sql.Decimal(12, 4), totalCost)
      .input("materialLocation", sql.NVarChar, materialLocation)
      .input("qtyWithdrawn", sql.Decimal(10, 3), Number(qty))
      .input("productionOrder", sql.VarChar(12), poOrder ? poOrder.slice(0, 12) : null)
      .input("peggedRequirement", sql.VarChar(32),
        ticketRow.printedQty === undefined || ticketRow.printedQty === null
          ? null
          : String(ticketRow.printedQty).slice(0, 32));

    await insertRequest.query(`
      INSERT INTO INV.BOM_Complex_Catalog (
        Date_In,
        PI_Card,
        Production_Order,
        Status,
        Employee_Alias,
        Material,
        PI_Card_Qty,
        ProcType,
        TicketNumber,
        TypeofAddition,
        UnitOfMeasure,
        Bulk_Material,
        Phantom_Item,
        Pegged_Requirement,
        Storage_Location,
        MaterialCost,
        WBS,
        WBS_Generic,
        POStatus,
        SpecialStock,
        Backflush,
        BOM_Index,
        Material_Location,
        Qty_Withdrawn,
        WBS_Production_Order,
        SalesOrder,
        SalesOrderItem
      )
      VALUES (
        GETDATE(),
        @piCard,
        @productionOrder,
        @status,
        @employeeAlias,
        @material,
        @piCardQty,
        @procType,
        @ticketNumber,
        @typeOfAddition,
        @unitOfMeasure,
        @bulkMaterial,
        NULL,
        @peggedRequirement,
        NULL,
        @materialCost,
        NULL,
        NULL,
        NULL,
        @specialStock,
        @backflush,
        NULL,
        @materialLocation,
        @qtyWithdrawn,
        NULL,
        NULL,
        NULL
      );
    `);

    writeLog({
      activity: "bom_row_inserted",
      userName,
      pip: cardCode,
      message: `BOM_Complex_Catalog row inserted | ticket ${insertTicketNumber} | material ${material} | qty ${qty} | unit cost ${unitCost} | total cost ${totalCost.toFixed(4)}`
    });
  }
}

async function syncCardToInventoryTables({ cardCode, areaName, subArea, userName, lines = [], pipStatus = "pending", cardIndex = 0, poOrder = "", poLines = [], ticketNumbers = [] }) {
  await ensureTicketLocationColumns();
  const pool = await getSqlPool();
  const sqlPipNum = toSqlPipNum(cardCode);
  const pipStatusValue = String(pipStatus || "pending").toLowerCase() === "confirmed" ? "confirmed" : "pending";

  const areaValue = clean(areaName);
  const subAreaValue = clean(subArea);
  const aliasValue = clean(userName);

  const existingTicketNumbers = (await pool.request()
    .input("pipNum", sql.NVarChar, sqlPipNum)
    .query(`
      SELECT TicketNumber
      FROM INV.Tickets
      WHERE PIPNum = @pipNum
      ORDER BY TicketNumber
    `)).recordset || [];

  const currentTicketNumbers = existingTicketNumbers
    .map(row => Number(row.TicketNumber ?? 0))
    .filter(value => Number.isFinite(value) && value > 0);

  const existingPip = await pool.request()
    .input("pipNum", sql.NVarChar, sqlPipNum)
    .query("SELECT TOP 1 PIPNum FROM INV.PIP WHERE PIPNum = @pipNum");

  if (!existingPip.recordset.length) {
    await pool.request()
      .input("pipNum", sql.NVarChar, sqlPipNum)
      .input("area", sql.NVarChar, areaValue)
      .input("subArea", sql.NVarChar, subAreaValue)
      .input("aliasAssigned", sql.NVarChar, aliasValue)
      .input("status", sql.NVarChar, pipStatusValue)
      .query(`
        INSERT INTO INV.PIP (
          PIPNum,
          Area,
          SubArea,
          AliasAssigned,
          Status,
          LastUpdate,
          Plant
        )
        VALUES (
          @pipNum,
          @area,
          @subArea,
          @aliasAssigned,
          @status,
          GETDATE(),
          NULL
        );
      `);

    writeLog({
      activity: "pip_row_inserted",
      userName,
      pip: sqlPipNum,
      message: `PIP row inserted | card ${sqlPipNum} | area ${areaValue} | subarea ${subAreaValue} | status ${pipStatusValue}`
    });
  } else {
    await pool.request()
      .input("pipNum", sql.NVarChar, sqlPipNum)
      .input("area", sql.NVarChar, areaValue)
      .input("subArea", sql.NVarChar, subAreaValue)
      .input("aliasAssigned", sql.NVarChar, aliasValue)
      .input("status", sql.NVarChar, pipStatusValue)
      .query(`
        UPDATE INV.PIP
        SET
          Area = @area,
          SubArea = @subArea,
          AliasAssigned = @aliasAssigned,
          Status = @status,
          LastUpdate = GETDATE()
        WHERE PIPNum = @pipNum;
      `);

    writeLog({
      activity: "pip_row_updated",
      userName,
      pip: sqlPipNum,
      message: `PIP row updated | card ${sqlPipNum} | area ${areaValue} | subarea ${subAreaValue} | status ${pipStatusValue}`
    });
  }

  for (const [index, line] of lines.entries()) {
    const material = clean(line.material || line.Material || "");
    const fallbackTicketNumber = resolveTicketNumber({ cardIndex, lineNo: line.line_no ?? line.lineNo ?? 0 });
    const actualTicketNumber = ticketNumbers[index] || currentTicketNumbers[index] || fallbackTicketNumber;
    const ticketNumber = Number(actualTicketNumber) || 0;
    const lineIsVoid = !!(line.is_void || line.isVoid);
    const ticketStatus = lineIsVoid ? "voided" : (pipStatusValue === "confirmed" ? "confirmed" : "pending");
    const typeOfAdd = poOrder && index === 0 && !lineIsVoid ? "PO" : determineTicketType(material, lineIsVoid);

    if (!material && ticketNumber === 0) continue;

    const existingTicket = await pool.request()
      .input("pipNum", sql.NVarChar, sqlPipNum)
      .input("ticketNumber", sql.Int, ticketNumber || 0)
      .query("SELECT TOP 1 ID FROM INV.Tickets WHERE PIPNum = @pipNum AND TicketNumber = @ticketNumber");

    if (existingTicket.recordset.length) {
      await pool.request()
        .input("pipNum", sql.NVarChar, sqlPipNum)
        .input("status", sql.NVarChar, ticketStatus)
        .input("typeOfAdd", sql.NVarChar, typeOfAdd)
        .input("lastUpdate", sql.DateTime, new Date())
        .input("ticketNumber", sql.Int, ticketNumber || 0)
        .input("material", sql.NVarChar, material)
        .input("locationType", sql.NVarChar(16), clean(line.location_type) || null)
        .input("locationValue", sql.NVarChar(128), clean(line.bin) || null)
        .query(`
          UPDATE INV.Tickets
          SET
            Status = @status,
            TypeOfAdd = @typeOfAdd,
            LastUpdate = @lastUpdate,
            Material = @material,
            LocationType = CASE WHEN @locationType IS NULL THEN LocationType ELSE @locationType END,
            LocationValue = CASE WHEN @locationType IS NULL THEN LocationValue ELSE @locationValue END
          WHERE PIPNum = @pipNum AND TicketNumber = @ticketNumber;
        `);

      writeLog({
        activity: "ticket_row_updated",
        userName,
        pip: sqlPipNum,
        message: `Tickets row updated | card ${sqlPipNum} | ticket ${ticketNumber} | material ${material} | status ${ticketStatus}`
      });
    } else {
      await pool.request()
        .input("pipNum", sql.NVarChar, sqlPipNum)
        .input("status", sql.NVarChar, ticketStatus)
        .input("typeOfAdd", sql.NVarChar, typeOfAdd)
        .input("lastUpdate", sql.DateTime, new Date())
        .input("ticketNumber", sql.Int, ticketNumber || 0)
        .input("material", sql.NVarChar, material)
        .input("locationType", sql.NVarChar(16), clean(line.location_type) || null)
        .input("locationValue", sql.NVarChar(128), clean(line.bin) || null)
        .query(`
          INSERT INTO INV.Tickets (
            PIPNum,
            Status,
            TypeOfAdd,
            LastUpdate,
            TicketNumber,
            Material,
            LocationType,
            LocationValue
          )
          VALUES (
            @pipNum,
            @status,
            @typeOfAdd,
            @lastUpdate,
            @ticketNumber,
            @material,
            @locationType,
            @locationValue
          );
        `);

      writeLog({
        activity: "ticket_row_inserted",
        userName,
        pip: sqlPipNum,
        message: `Tickets row inserted | card ${sqlPipNum} | ticket ${ticketNumber} | material ${material} | status ${ticketStatus}`
      });
    }
  }

  await insertBomComplexCatalogRows({
    cardCode,
    userName,
    lines,
    cardIndex,
    poOrder,
    poLines
  });
}

async function findArea(areaId) {
  if (!Number.isSafeInteger(areaId) || areaId <= 0) {
    return null;
  }

  const pool = await getSqlPool();

  const result = await pool.request()
    .input("areaId", sql.Int, areaId)
    .query(`
      SELECT TOP 1
        ID AS id,
        COALESCE(SubArea, Area) AS strName,
        Area,
        SubArea,
        [Leader] AS Leader,
        InventoryLeader,
        AuditLeader,
        InventoryLocation
      FROM INV.Areas
      WHERE ID = @areaId
    `);

  return result.recordset[0] || null;
}

function getAreaLeaders(area) {
  if (!area) return [];

  return [
    { role: "Leader", name: clean(area.Leader) },
    { role: "Inventory Leader", name: clean(area.InventoryLeader) },
    { role: "Audit Leader", name: clean(area.AuditLeader) }
  ].filter(leader => leader.name);
}

async function fetchAllCompletedMaterials() {
  const pool = await getSqlPool();

  const result = await pool.request()
    .query(`
      SELECT *
      FROM INV.Tickets a
      Left JOIN INV.BOM_COMPLEX_CATALOG b on a.PipNum+a.Material = b.PipNum+b.Material
    `);


  return [];
}

async function fetchCostByMaterial() {
  const pool = await getSqlPool();

  const result = await pool.request()
    .query(`
      SELECT 
        a.Material,
        SUM(p.MaterialCost) AS totalCostCounted,
        p.Material AS materialCost,
        sum(p.COST) AS totalCost
        FROM INV.BOM_COMPLEX_CATALOG a
          right join INV.PartUniverse p on a.Material = p.Material
        GROUP BY a.Material, p.Material
    `);


  return [];
}



async function fetchProductionAreaMaterials(location, areaId) {
  const normalizedLocation = clean(location);
  const area = await findArea(Number(areaId));

  if (!area) {
    throw new Error("Production Supply Area not found");
  }

  if (!normalizedLocation || !LOCATIONS.includes(normalizedLocation)) {
    throw new Error("Invalid Storage Location");
  }

  const productionAreaName = clean(area.SubArea || area.Area || area.strName);

  if (!productionAreaName) {
    throw new Error("Production Supply Area name missing");
  }

  const pool = await getSqlPool();

  const result = await pool.request()
    .input("location", sql.NVarChar, normalizedLocation)
    .input("productionArea", sql.NVarChar, productionAreaName)
    .query(`
      SELECT DISTINCT
        p.Material AS material,
        p.MaterialDescription AS description,
        COALESCE(s.Bin, '') AS bin,
        COALESCE(s.Station, '') AS station,
        p.Plant AS plant,
        p.UnitMeasurement AS uom,
        p.Location AS location
      FROM INV.PartUniverse p
      INNER JOIN INV.AllStationBinData s
        ON s.Material = p.Material
       AND s.ProductionArea = @productionArea
      WHERE p.Location = @location
      ORDER BY p.Material, bin, station
    `);

  const materials = expandMaterialLocations(result.recordset
    .map(row => ({
      material: clean(row.material),
      description: clean(row.description),
      bin: clean(row.bin),
      station: clean(row.station),
      plant: clean(row.plant),
      stock_category: "",
      batch: "",
      uom: clean(row.uom) || "EA",
      sap_qty: null,
      location: clean(row.location)
    })))
    .filter(item => item.material)
    .sort((a, b) => {
      const locationTypeCompare = Number(a.location_type === "station") - Number(b.location_type === "station");
      if (locationTypeCompare !== 0) return locationTypeCompare;

      const binCompare = String(a.bin || "").localeCompare(String(b.bin || ""), undefined, { numeric: true, sensitivity: "base" });
      if (binCompare !== 0) return binCompare;
      return String(a.material).localeCompare(String(b.material), undefined, { numeric: true, sensitivity: "base" });
    });

  return {
    area,
    materials
  };
}

function createCardsFromMaterials({ batchId, sloc, areaId, materials }) {
  const cards = [];
  const materialsByLocation = new Map();

  for (const material of materials) {
    const locationType = clean(material.location_type).toLowerCase();
    const locationValue = clean(material.bin);
    const rack = locationValue.split(".")[0].trim();
    const locationKey = locationType === "station" && locationValue
      ? `station:${locationValue.toUpperCase()}`
      : rack
        ? `rack:${rack.toUpperCase()}`
        : "unassigned";
    const group = materialsByLocation.get(locationKey) || [];
    group.push(material);
    materialsByLocation.set(locationKey, group);
  }

  let pageNumber = 0;
  for (const locationMaterials of materialsByLocation.values()) {
    for (let offset = 0; offset < locationMaterials.length; offset += 10) {
      pageNumber += 1;
      const code = buildPipCardCode({
        sloc,
        areaId,
        batchId,
        pageNumber
      });

      const lines = locationMaterials.slice(offset, offset + 10).map((material, index) => ({
        line_no: index + 1,
        material: material.material,
        description: material.description,
        bin: material.bin,
        location_type: material.location_type,
        plant: material.plant,
        stock_category: material.stock_category,
        batch: material.batch,
        uom: material.uom,
        sap_qty: material.sap_qty,
        physical_qty: null,
        is_void: material.material.length === 0 ? 1 : 0
      }));

      cards.push({ code, kind: "filled", lines });
    }
  }

  return {
    cardCount: cards.length,

    materialCount: materials.length,
    cards
  };
}

if (IS_PRODUCTION) {
  app.use("/api/login", (req, res, next) => {
    const stableClientIp = req.socket.remoteAddress || "browser";
    req.headers["x-real-ip"] = stableClientIp;
    req.headers["x-forwarded-for"] = stableClientIp;
    req.headers["connection"] = "keep-alive";
    next();
  }, sso.auth({
    useSession: true,
    forceNTLM: true
  }));
}

app.post("/api/login", async (req, res) => {
  const windowsUsername = getIisWindowsIdentity(req);
  let user = null;

  if (windowsUsername) {
    try {
      user = await findWindowsUser(windowsUsername);
    } catch (error) {
      console.error("Windows user lookup failed:", error.message);
      return res.status(503).json({
        message: "Unable to verify the Windows user"
      });
    }

    if (!user) {
      writeLog({
        activity: "login_failed",
        userName: windowsUsername,
        message: "Windows account missing or role not authorized"
      });

      return res.status(403).json({
        message: "Your Windows account is not authorized"
      });
    }
  } else if (!IS_PRODUCTION) {
    const { username, password } = req.body || {};

    user = localUsers.find(
      item => item.username === username
    );

    if (
      !user ||
      typeof password !== "string" ||
      !bcrypt.compareSync(password, user.hash)
    ) {
      writeLog({
        activity: "login_failed",
        userName: typeof username === "string" ? username : "unknown",
        message: "Invalid username or password"
      });

      return res.status(401).json({
        message: "Invalid username or password"
      });
    }
  } else {
    return res.status(401).json({
      message: "Windows authentication is required"
    });
  }

  req.session.regenerate(error => {
    if (error) {
      writeLog({
        activity: "login_error",
        userName: user.username,
        message: "Session regeneration failed during login"
      });

      return res.status(500).json({
        message: "Login failed"
      });
    }

    req.session.user = {
      username: user.username,
      role: user.role
    };

    writeLog({
      activity: "login",
      userName: user.username,
      message: "User signed in"
    });

    res.json(req.session.user);
  });
});

app.get("/api/me", requireLogin, (req, res) => {
  res.json(req.session.user);
});

app.get("/api/logs", requireManager, async (req, res) => {
  try {
    const pool = await getSqlPool();
    const result = await pool.request().query(`
      SELECT TOP 200 *
      FROM INV.Log
      ORDER BY DashLog_ID DESC
    `);

    res.json(result.recordset || []);
  } catch (error) {
    console.error("SQL logs query failed:", error.message);
    res.status(503).json({ message: "Unable to load logs from SQL Server" });
  }
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

app.get("/api/sql/areas", requireManager, async (req, res) => {
  try {
    const location = req.query.location;
    const parsedLocation = location === undefined || location === "" ? undefined : Number(location);
    const rowSet = await sqlQueries.fetchAreas(Number.isFinite(parsedLocation) ? parsedLocation : undefined);

    const normalized = rowSet.map(area => {
      const id = area.id ?? area.ID ?? area.AreaPK ?? area.area_id ?? null;
      const strName = area.strName ?? area.AreaName ?? area.SubArea ?? area.Name ?? area.AreaPK ?? "Unknown Area";

      return {
        id: Number(id),
        strName,
        raw: area
      };
    }).filter(area => Number.isFinite(area.id));

    res.json(normalized);
  } catch (error) {
    console.error("SQL areas query failed:", error.message);
    res.status(503).json({
      message: "Unable to load areas from SQL Server. Check the SQL credentials and table schema."
    });
  }
});

app.get("/api/sql/parts", requireManager, async (req, res) => {
  try {
    const area = typeof req.query.area === "string" ? req.query.area : undefined;
    const rowSet = await sqlQueries.fetchParts(area);
    res.json(rowSet);
  } catch (error) {
    console.error("SQL parts query failed:", error.message);
    res.status(503).json({ message: "Unable to load parts from SQL Server" });
  }
});

app.get("/api/sql/pip-cards", requireManager, async (req, res) => {
  try {
    const pipId = typeof req.query.pipId === "string" ? req.query.pipId : undefined;
    const rowSet = await sqlQueries.fetchPipCards(pipId);
    res.json(rowSet);
  } catch (error) {
    console.error("SQL pip card query failed:", error.message);
    res.status(503).json({ message: "Unable to load PIP cards from SQL Server" });
  }
});

app.get("/api/sql/order", requireManager, async (req, res) => {
  try {
    const orderNum = typeof req.query.orderNum === "string" ? req.query.orderNum : "";

    if (!orderNum.trim()) {
      writeLog({
        activity: "order_not_found",
        userName: req.session?.user?.username,
        message: "Order lookup requested without an order number"
      });
      return res.status(400).json({ message: "Order number is required" });
    }

    const rowSet = await sqlQueries.fetchOrder(orderNum);

    if (!rowSet.length) {
      writeLog({
        activity: "order_not_found",
        userName: req.session?.user?.username,
        pip: orderNum,
        message: `No SQL order records found for ${orderNum}`
      });
      return res.status(404).json({ message: "Order not found" });
    }

    res.json(rowSet);
  } catch (error) {
    console.error("SQL order query failed:", error.message);
    writeLog({
      activity: "error_generating_cards",
      userName: req.session?.user?.username,
      pip: typeof req.query.orderNum === "string" ? req.query.orderNum : "unknown order",
      message: error.message || "Unable to load order from SQL Server"
    });
    res.status(503).json({ message: "Unable to load order from SQL Server" });
  }
});

app.get("/api/po/:orderNum", requireLogin, async (req, res) => {
  const orderNum = clean(req.params.orderNum);

  if (!orderNum) {
    return res.status(400).json({ message: "Production order number is required" });
  }

  try {
    const pool = await getSqlPool();
    const result = await pool.request()
      .input("orderNum", sql.VarChar(12), orderNum)
      .query(`
        SELECT
          Material AS material,
          COALESCE(Material_Description, '') AS description,
          COALESCE(Requirement_Qty, 0) AS requirementQty,
          COALESCE(Storage_Location, '') AS storageLocation,
          COALESCE(UnitOfEntry, 'EA') AS uom
        FROM INV.RAW_CATALOG
        WHERE Production_Order = @orderNum
        ORDER BY TRY_CAST(Item_Component AS INT), ID
      `);

    if (!result.recordset.length) {
      writeLog({
        activity: "order_not_found",
        userName: req.session.user?.username,
        message: `No BOM found for production order ${orderNum}`
      });
      return res.status(404).json({ message: `No order found for ${orderNum}` });
    }

    writeLog({
      activity: "bom_loaded",
      userName: req.session.user?.username,
      message: `Loaded ${result.recordset.length} materials for production order ${orderNum}`
    });

    res.json(result.recordset);
  } catch (error) {
    console.error("PO BOM load failed:", error.message);
    res.status(503).json({ message: "Unable to load production order BOM" });
  }
});

app.get("/api/sql/users", requireManager, async (req, res) => {
  try {
    const rowSet = await sqlQueries.fetchUsers();
    res.json(rowSet);
  } catch (error) {
    console.error("SQL users query failed:", error.message);
    res.status(503).json({ message: "Unable to load users from SQL Server" });
  }
});

app.get("/api/sql/table", requireManager, async (req, res) => {
  try {
    const schema = typeof req.query.schema === "string" ? req.query.schema : "INV";
    const table = typeof req.query.table === "string" ? req.query.table : "";

    if (!table.trim()) {
      return res.status(400).json({ message: "Table name is required" });
    }

    const top = Number(req.query.top || 100);
    const rowSet = await sqlQueries.fetchTable(schema, table, {
      top: Number.isFinite(top) ? top : 100,
      orderBy: typeof req.query.orderBy === "string" ? req.query.orderBy : undefined
    });

    res.json(rowSet);
  } catch (error) {
    console.error("SQL table query failed:", error.message);
    res.status(503).json({ message: "Unable to read table from SQL Server" });
  }
});

app.post("/api/sql/query", requireManager, async (req, res) => {
  try {
    const sqlText = typeof req.body?.sqlText === "string" ? req.body.sqlText : "";
    const params = req.body?.params && typeof req.body.params === "object" ? req.body.params : {};

    if (!sqlText.trim()) {
      return res.status(400).json({ message: "A SELECT query is required" });
    }

    const rowSet = await sqlQueries.executeReadOnly(sqlText, params);
    res.json(rowSet);
  } catch (error) {
    console.error("SQL read-only query failed:", error.message);
    res.status(400).json({ message: error.message || "Invalid SQL query" });
  }
});

app.get(
  "/api/production-areas",
  requireManager,
  async (req, res) => {
    try {
      const location = typeof req.query.location === "string"
        ? req.query.location.trim()
        : "";

      const pool = await getSqlPool();

      const request = pool.request();

      const query = location
        ? `
          SELECT
            ID AS id,
            COALESCE(SubArea, Area) AS strName,
            Area,
            SubArea,
            InventoryLocation
          FROM INV.Areas
          WHERE InventoryLocation = @location
          ORDER BY Area, SubArea
        `
        : `
          SELECT
            ID AS id,
            COALESCE(SubArea, Area) AS strName,
            Area,
            SubArea,
            InventoryLocation
          FROM INV.Areas
          ORDER BY Area, SubArea
        `;

      if (location) {
        request.input("location", sql.NVarChar, location);
      }

      const result = await request.query(query);

      res.json(result.recordset);
    } catch (error) {
      console.error("SQL error:", error.stack || error.message);

      res.status(503).json({
        message: "Unable to load Production Supply Areas"
      });
    }
  }
);


app.get("/api/production-area-materials", requireManager, async (req, res) => {
  try {
    const sloc = clean(req.query.location);
    const areaId = Number(req.query.areaId);

    if (!LOCATIONS.includes(sloc)) {
      writeLog({
        activity: "error_generating_cards",
        userName: req.session.user?.username,
        message: `Invalid storage location requested: ${sloc}`
      });
      return res.status(400).json({ message: "Invalid Storage Location" });
    }

    if (!Number.isSafeInteger(areaId) || areaId <= 0) {
      writeLog({
        activity: "error_generating_cards",
        userName: req.session.user?.username,
        message: "Production area selection missing while loading materials"
      });
      return res.status(400).json({ message: "Select a Production Supply Area" });
    }

    const { area, materials } = await fetchProductionAreaMaterials(sloc, areaId);

    if (!materials.length) {
      writeLog({
        activity: "materials_not_found",
        userName: req.session.user?.username,
        pip: area?.strName || "unknown area",
        message: `No materials found for ${area?.strName || "selected area"} in SLoc ${sloc}`
      });
    }

    res.json({
      area: area.strName,
      location: sloc,
      materials,
      cards: Math.ceil(materials.length / 10)
    });
  } catch (error) {
    console.error("Area materials load failed:", error.message);
    writeLog({
      activity: "error_generating_cards",
      userName: req.session.user?.username,
      message: error.message || "Unable to load materials for this production area"
    });
    res.status(400).json({
      message: error.message || "Unable to load materials for this production area"
    });
  }
});

app.post("/api/area-cards", requireManager, async (req, res) => {
  try {
    const location = clean(req.body?.location || req.query?.location || "");
    const areaId = Number(req.body?.areaId ?? req.query?.areaId ?? 0);

    if (!LOCATIONS.includes(location)) {
      writeLog({
        activity: "error_generating_cards",
        userName: req.session.user?.username,
        message: `Invalid storage location requested while generating cards: ${location}`
      });
      return res.status(400).json({ message: "Invalid Storage Location" });
    }

    if (!Number.isSafeInteger(areaId) || areaId <= 0) {
      writeLog({
        activity: "error_generating_cards",
        userName: req.session.user?.username,
        message: "Production area selection missing while generating cards"
      });
      return res.status(400).json({ message: "Select a Production Supply Area" });
    }

    const { area, materials } = await fetchProductionAreaMaterials(location, areaId);

    if (!materials.length) {
      writeLog({
        activity: "materials_not_found",
        userName: req.session.user?.username,
        pip: area?.strName || "unknown area",
        message: `No materials match ${area.strName} for SLoc ${location}`
      });
      return res.status(404).json({
        message: `No materials match ${area.strName} for SLoc ${location}`
      });
    }

    const batch = addGeneratedBatch({
      sloc: location,
      area: area.strName,
      areaId: area.id,
      leaders: getAreaLeaders(area)
    });

    const result = createCardsFromMaterials({
      batchId: batch.id,
      sloc: location,
      areaId: area.id,
      materials
    });

    addGeneratedCards({ batchId: batch.id, cards: result.cards });

    try {
      for (const [cardIndex, card] of (result.cards || []).entries()) {
        await syncCardToInventoryTables({
          cardCode: card.code,
          areaName: area.strName,
          subArea: area.SubArea || area.Area || area.strName,
          userName: req.session.user?.username,
          lines: card.lines || [],
          cardIndex
        });
      }
    } catch (error) {
      console.error("Inventory sync failed:", error.message);
      writeLog({
        activity: "error_generating_cards",
        userName: req.session.user?.username,
        pip: `${area.strName} (${location})`,
        message: error.message || "Unable to sync generated PIP cards to INV.PIP / INV.Tickets"
      });
    }

    writeLog({
      activity: "pip_card_generated",
      userName: req.session.user?.username,
      pip: `${area.strName} (${location})`,
      message: `Generated ${result.cardCount} PIP cards from ${result.materialCount} materials`
    });

    res.json({
      batchId: batch.id,
      sloc: location,
      area: area.strName,
      materials: result.materialCount,
      cards: result.cardCount
    });
  } catch (error) {
    console.error("Area card generation failed:", error.message);
    res.status(400).json({
      message: error.message || "Unable to generate PIP cards for this production area"
    });
  }
});

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
        return res.status(400).json({ message: "Invalid Storage Location" });
      }

      if (!Number.isSafeInteger(areaId) || areaId <= 0) {
        return res.status(400).json({ message: "Select a Production Supply Area" });
      }

      const area = await findArea(areaId);

      if (!area) {
        return res.status(400).json({ message: "Production Supply Area not found" });
      }

      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).json({ message: "Select an Excel file" });
      }

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.body);

      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error("Excel worksheet not found");

      let headers = {};
      let headerRow = 0;

      for (let i = 1; i <= Math.min(sheet.rowCount, 15); i++) {
        const found = {};
        sheet.getRow(i).eachCell((cell, index) => {
          found[normalize(readCell(cell))] = index;
        });

        if ((found.material || found.materialnumber) && (found.availablestock || found.availableqty || found.availablequantity)) {
          headers = found;
          headerRow = i;
          break;
        }
      }

      if (!headerRow) {
        throw new Error("Excel needs Material and Available Stock columns");
      }

      function findColumn(...names) {
        for (const name of names) {
          const column = headers[normalize(name)];
          if (column) return column;
        }
        return 0;
      }

      const cols = {
        material: findColumn("Material", "Material Number"),
        description: findColumn("Material Description", "Description", "Material Desc"),
        sloc: findColumn("SLoc", "Storage Location", "Storage Loc"),
        bin: findColumn("Storage Bin", "StorageBin"),
        station: findColumn("Station"),
        plant: findColumn("Plant", "Plnt"),
        stock: findColumn("Stock Category", "Stock Type", "S"),
        batch: findColumn("Batch"),
        uom: findColumn("BUn", "UOM", "Base Unit"),
        qty: findColumn("Available Stock", "Available Qty", "Available Quantity")
      };

      if (!cols.sloc) {
        throw new Error("Storage Location column missing");
      }

      const materials = [];

      for (let i = headerRow + 1; i <= sheet.rowCount; i++) {
        const row = sheet.getRow(i);
        const material = clean(getColumn(row, cols.material));
        const rowSloc = clean(getColumn(row, cols.sloc));

        if (!material || rowSloc !== sloc) continue;

        const sapQty = parseStock(getColumn(row, cols.qty));

        if (!Number.isFinite(sapQty)) {
          throw new Error(`Invalid available stock on Excel row ${i}`);
        }

        materials.push({
          material,
          description: clean(getColumn(row, cols.description)),
          bin: clean(getColumn(row, cols.bin)),
          station: clean(getColumn(row, cols.station)),
          plant: clean(getColumn(row, cols.plant)),
          stock_category: clean(getColumn(row, cols.stock)),
          batch: clean(getColumn(row, cols.batch)),
          uom: clean(getColumn(row, cols.uom)) || "EA",
          sap_qty: sapQty
        });
      }

      if (!materials.length) {
        writeLog({
          activity: "materials_not_found",
          userName: req.session.user?.username,
          pip: area.strName,
          message: `No materials found for SLoc ${sloc} in imported Excel file`
        });
        throw new Error(`No materials found for SLoc ${sloc}`);
      }

      const batch = addGeneratedBatch({
        sloc,
        area: area.strName,
        areaId: area.id,
        leaders: getAreaLeaders(area)
      });

      const result = createCardsFromMaterials({
        batchId: batch.id,
        sloc,
        areaId: area.id,
        materials: expandMaterialLocations(materials)
      });

      addGeneratedCards({ batchId: batch.id, cards: result.cards });

      try {
        for (const [cardIndex, card] of (result.cards || []).entries()) {
          await syncCardToInventoryTables({
            cardCode: card.code,
            areaName: area.strName,
            subArea: area.SubArea || area.Area || area.strName,
            userName: req.session.user?.username,
            lines: card.lines || [],
            cardIndex
          });
        }
      } catch (error) {
        console.error("Import inventory sync failed:", error.message);
        writeLog({
          activity: "error_generating_cards",
          userName: req.session.user?.username,
          pip: area.strName,
          message: error.message || "Unable to sync imported materials to INV.PIP / INV.Tickets"
        });
      }

      writeLog({
        activity: "material_inputted",
        userName: req.session.user?.username,
        pip: area.strName,
        message: `Imported ${materials.length} materials for SLoc ${sloc} and created ${result.cardCount} cards`
      });

      res.json({
        batchId: batch.id,
        sloc,
        area: area.strName,
        materials: materials.length,
        cards: result.cardCount
      });
    } catch (error) {
      console.error("Import error:", error.message);
      writeLog({
        activity: "error_generating_cards",
        userName: req.session.user?.username,
        pip: typeof req.headers["x-sloc"] === "string" ? String(req.headers["x-sloc"]) : "unknown area",
        message: error.message
      });

      res.status(400).json({ message: error.message });
    }
  }
);


app.get("/api/batches", requireManager, (req, res) => {
  const batches = [...generatedBatches.values()].map(batch => ({
    id: batch.id,
    sloc: batch.sloc,
    area: batch.area,
    area_id: batch.area_id,
    leaders: batch.leaders,
    created_at: batch.created_at
  })).sort((a, b) => Number(b.id) - Number(a.id));

  res.json(batches);
});

app.post(
  "/api/blank-cards",
  requireManager,
  async (req, res) => {
    const quantity = Number(req.body?.quantity);
    const location = clean(req.body?.location);
    const rawAreaId = req.body?.areaId;
    const hasSelectedArea = rawAreaId !== null && rawAreaId !== undefined && String(rawAreaId).trim() !== "";
    const areaId = hasSelectedArea ? Number(rawAreaId) : null;

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 100
    ) {
      return res.status(400).json({
        message: "Choose 1 to 100 blank cards"
      });
    }

    if (!LOCATIONS.includes(location)) {
      return res.status(400).json({
        message: "Invalid Storage Location"
      });
    }

    if (hasSelectedArea && (!Number.isSafeInteger(areaId) || areaId <= 0)) {
      return res.status(400).json({
        message: "Invalid Production Supply Area"
      });
    }

    let batch = null;
    let areaName = "None";
    let subAreaName = "None";
    let leaders = [];

    try {
      if (hasSelectedArea) {
        const area = await findArea(areaId);
        if (!area || clean(area.InventoryLocation) !== location) {
          return res.status(400).json({
            message: "Selected Production Supply Area is not available for this Storage Location"
          });
        }

        areaName = clean(area.strName || area.SubArea || area.Area) || "None";
        subAreaName = clean(area.SubArea || area.Area || area.strName) || areaName;
        leaders = getAreaLeaders(area);
      }

      batch = addGeneratedBatch({
        sloc: location,
        area: areaName,
        areaId,
        leaders
      });

      const pool = await getSqlPool();
      const ticketResult = await pool.request().query(
        "SELECT ISNULL(MAX(TicketNumber), 0) AS maxTicketNumber FROM INV.Tickets"
      );
      let nextTicketNumber = Number(ticketResult.recordset[0]?.maxTicketNumber || 0) + 1;

      const generated = [];
      const createdCards = [];
      const prefix = cardPrefix(batch);
      const previousCards = await pool.request()
        .input("codePattern", sql.VarChar(50), `${prefix}-BL%`)
        .query("SELECT PIPNum FROM INV.PIP WHERE PIPNum LIKE @codePattern");
      const previous = (previousCards.recordset || []).reduce((max, row) => {
        const match = String(row.PIPNum || "").match(/-BL(\d+)$/i);
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0);

      for (let i = 1; i <= quantity; i++) {
        const code = prefix + "-BL" + String(previous + i).padStart(3, "0");
        const card = {
          id: nextCardId++,
          batch_id: batch.id,
          code,
          kind: "blank",
          submitted_at: null,
          created_at: new Date().toISOString(),
          sloc: batch.sloc,
          area: batch.area,
          area_id: batch.area_id,
          lines: Array.from({ length: 10 }, (_, lineIndex) => ({
            id: nextLineId++,
            card_id: 0,
            line_no: lineIndex + 1,
            material: lineIndex>0 ? 'VOID' : '',
            description: lineIndex>0 ? 'VOID' : '',
            bin: lineIndex>0 ? 'VOID' : '',
            plant: lineIndex>0 ? 'VOID' : '',
            stock_category: lineIndex>0 ? 'VOID' : '',
            batch: lineIndex>0 ? 'VOID' : '',
            uom: lineIndex>0 ? 'VOID' : '',
            sap_qty: lineIndex>0 ? 0 : null,
            physical_qty: lineIndex>0 ? 0 : null,
            is_void: lineIndex>0 ? 1 : 0,
            entered_by: null,
            entered_at: null
          }))
        };

        card.lines = card.lines.map(line => ({
          ...line,
          card_id: card.id
        }));

        createdCards.push({
          card,
          ticketNumbers: Array.from({ length: card.lines.length }, () => nextTicketNumber++)
        });
        generated.push(code);
      }

      for (const { card, ticketNumbers } of createdCards) {
        await syncCardToInventoryTables({
          cardCode: card.code,
          areaName: batch.area,
          subArea: subAreaName,
          userName: req.session.user?.username,
          lines: card.lines,
          ticketNumbers
        });
      }

      batch.cards.push(...createdCards.map(({ card }) => card));

      writeLog({
        activity: "blank_cards_generated",
        userName: req.session.user?.username,
        pip: batch.area,
        message: `Generated and persisted ${quantity} standalone blank cards for SLoc ${location}`
      });

      res.json({ batchId: batch.id, area: batch.area, generated });
    } catch (error) {
      if (batch) {
        generatedBatches.delete(batch.id);
      }
      console.error("Blank card persistence failed:", error.message);
      writeLog({
        activity: "error_generating_cards",
        userName: req.session.user?.username,
        pip: batch?.area || areaName,
        message: `Blank card persistence failed: ${error.message}`
      });
      res.status(500).json({
        message: `Unable to persist blank cards to INV.PIP and INV.Tickets: ${error.message}`
      });
    }
  }
);


app.get(
  "/api/batches/:id/cards",
  requireManager,
  (req, res) => {
    const batch = getGeneratedBatch(Number(req.params.id));

    if (!batch) {
      return res.status(404).json({
        message: "Audit batch not found"
      });
    }

    res.json(
      batch.cards.map(card => ({
        ...card,
        sloc: batch.sloc,
        area: batch.area,
        area_id: batch.area_id,
        leaders: card.leaders || batch.leaders,
        lines: card.lines || []
      }))
    );
  }
);


app.get(
  "/api/recount/cards",
  requireManager,
  async (req, res) => {
    try {
      const pool = await getSqlPool();
      const result = await pool.request().query(`
        SELECT
          p.PIPNum AS code,
          COALESCE(p.SubArea, p.Area) AS area,
          p.Status AS status,
          p.LastUpdate AS lastUpdate
        FROM INV.PIP p
        WHERE LOWER(LTRIM(RTRIM(p.Status))) = 'confirmed'
          AND EXISTS (
            SELECT 1
            FROM INV.Tickets t
            WHERE t.PIPNum = p.PIPNum
              AND LOWER(LTRIM(RTRIM(t.Status))) = 'confirmed'
              AND t.Recount = 1
          )
        ORDER BY p.PIPNum
      `);

      res.json(result.recordset || []);
    } catch (error) {
      console.error("recount card list failed:", error.message);
      res.status(503).json({ message: "Unable to load PIP cards for recount" });
    }
  }
);


app.get(
  "/api/recount/cards/:code",
  requireManager,
  async (req, res) => {
    const code = normalizePipCode(req.params.code);

    try {
      const pool = await getSqlPool();

      const pipResult = await pool.request()
        .input("pipNum", sql.NVarChar, code)
        .query(`
          SELECT TOP 1
            PIPNum AS code,
            COALESCE(SubArea, Area) AS area,
            SubArea AS subArea,
            Status AS status,
            CASE WHEN Status = 'confirmed' THEN LastUpdate ELSE NULL END AS submitted_at
          FROM INV.PIP
          WHERE PIPNum = @pipNum
        `);

      const pip = pipResult.recordset[0];

      if (!pip) {
        return res.status(404).json({ message: "PIP Card not found" });
      }

      const slocMatch = code.match(/^PIP-(\d+)-/i);
      const sloc = slocMatch ? slocMatch[1] : "";
      const areaIdMatch = code.match(/^PIP-\d+-(\d+)-/i);
      const area = areaIdMatch
        ? await findArea(Number(areaIdMatch[1]))
        : null;
      const lines = await getSqlLines(code);

      writeLog({
        activity: "pip_card_recounted",
        userName: req.session.user?.username,
        pip: code,
        message: `recounted PIP card ${code} with ${lines.length} material rows`
      });

      res.json({
        id: 0,
        code: pip.code,
        kind: "filled",
        sloc,
        area: pip.area,
        area_id: area?.id ?? null,
        leaders: getAreaLeaders(area),
        submitted_at: pip.submitted_at || null,
        lines
      });
    } catch (error) {
      console.error("recount card load failed:", error.message);
      res.status(503).json({ message: "Unable to rebuild PIP card for recount" });
    }
  }
);


app.post(
  "/api/recount/cards/:code",
  requireManager,
  async (req, res) => {
    const code = normalizePipCode(req.params.code);
    const rawTicketNumbers = req.body?.ticketNumbers;

    if (!Array.isArray(rawTicketNumbers) || !rawTicketNumbers.length) {
      return res.status(400).json({
        message: "Select at least one material to recount"
      });
    }

    const ticketNumbers = [...new Set(rawTicketNumbers.map(Number))];
    if (
      ticketNumbers.length !== rawTicketNumbers.length ||
      ticketNumbers.some(number => !Number.isSafeInteger(number) || number <= 0)
    ) {
      return res.status(400).json({ message: "Invalid recount material selection" });
    }

    const pool = await getSqlPool();
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      const pipResult = await transaction.request()
        .input("pipNum", sql.NVarChar, code)
        .query(`
          SELECT Status
          FROM INV.PIP
          WHERE PIPNum = @pipNum
        `);
      const pip = pipResult.recordset[0];

      if (!pip) {
        await transaction.rollback();
        return res.status(404).json({ message: "PIP Card not found" });
      }

      if (String(pip.Status || "").trim().toLowerCase() !== "confirmed") {
        await transaction.rollback();
        return res.status(409).json({ message: "Only confirmed PIP cards can be recounted" });
      }

      const ticketResult = await transaction.request()
        .input("pipNum", sql.NVarChar, code)
        .query(`
          SELECT TicketNumber, Status, Recount
          FROM INV.Tickets
          WHERE PIPNum = @pipNum AND TypeOfAdd <> 'PO' and TypeOfAdd <> 'Cancelled'
        `);
      const ticketRows = ticketResult.recordset || [];
      const eligibleTicketNumbers = new Set(
        ticketRows
          .filter(row =>
            String(row.Status || "").trim().toLowerCase().includes("confirmed") &&
            Number(row.Recount) === 1
          )
          .map(row => Number(row.TicketNumber))
      );

      if (!eligibleTicketNumbers.size) {
        await transaction.rollback();
        return res.status(409).json({ message: "This PIP card has no materials flagged for recount" });
      }

      const confirmedTicketNumbers = new Set(
        ticketRows
          .filter(row => String(row.Status || "").trim().toLowerCase().includes("confirmed"))
          .map(row => Number(row.TicketNumber))
      );

      if (ticketNumbers.some(number => !confirmedTicketNumbers.has(number))) {
        await transaction.rollback();
        return res.status(400).json({ message: "Selected materials are not confirmed tickets on this card" });
      }

      await transaction.request()
        .input("pipNum", sql.NVarChar, code)
        .query(`
          UPDATE INV.Tickets
          SET Recount = 0
          WHERE PIPNum = @pipNum
        `);

      // set pip card status
      await transaction.request()
          .input("pipNum", sql.NVarChar, code)
          .query(`
            UPDATE INV.PIP
            SET Status = 'rc pending'
            WHERE PIPNum = @pipNum
          `);

      for (const ticketNumber of ticketNumbers) {
        const updateResult = await transaction.request()
          .input("pipNum", sql.NVarChar, code)
          .input("ticketNumber", sql.Int, ticketNumber)
          .query(`
            UPDATE INV.Tickets
            SET Status = 'rc pending', Recount = 1
            WHERE PIPNum = @pipNum
              AND TicketNumber = @ticketNumber
              AND Status LIKE '%confirmed'
          `);

        if (updateResult.rowsAffected[0] !== 1) {
          throw new Error(`Ticket ${ticketNumber} changed before recount selection was saved`);
        }
      }

      const savedRows = await transaction.request()
        .input("pipNum", sql.NVarChar, code)
        .query(`
          SELECT TicketNumber, Status, Recount
          FROM INV.Tickets
          WHERE PIPNum = @pipNum
          ORDER BY TicketNumber
        `);

      await transaction.commit();

      const generatedCard = findGeneratedCardByCode(code);
      if (generatedCard) {
        generatedCard.is_recount = true;
        for (const [index, row] of savedRows.recordset.entries()) {
          const line = generatedCard.lines[index];
          if (!line) continue;
          line.id = Number(row.TicketNumber);
          line.ticket_number = Number(row.TicketNumber);
          line.status = row.Status;
          line.recount = Number(row.recount);
        }
      }

      writeLog({
        activity: "pip_card_recounted",
        userName: req.session.user?.username,
        pip: code,
        message: `Selected ${ticketNumbers.length} materials for recount`
      });

      res.json({
        success: true,
        code,
        status: "rc pending",
        selected: ticketNumbers.length
      });
    } catch (error) {
      if (transaction._aborted !== true) {
        await transaction.rollback().catch(() => {});
      }
      console.error("Recount selection failed:", error.message);
      res.status(500).json({ message: "Unable to save recount selection" });
    }
  }
);


app.get(
  "/api/overview",
  requireManager,
  async (req, res) => {
    try {
      const pool = await getSqlPool();
      const result = await pool.request().query(`
        SELECT
          ID AS id,
          PIPNum AS code,
          COALESCE(
            NULLIF(LTRIM(RTRIM(Area)), ''),
            NULLIF(LTRIM(RTRIM(SubArea)), ''),
            'Unassigned'
          ) AS area,
          Status AS status,
          LastUpdate AS last_update
        FROM INV.PIP
        ORDER BY ID DESC
      `);

      const cards = (result.recordset || []).map(row => {
        const code = clean(row.code);
        const submitted = clean(row.status).toLowerCase() === "confirmed";
        const slocMatch = code.match(/^PIP-(\d+)-/i);
        const batchMatch = code.match(/-B(\d+)-/i);

        return {
          id: Number(row.id),
          code,
          kind: /-BL\d*$/i.test(code) ? "blank" : "filled",
          area: clean(row.area) || "Unassigned",
          sloc: slocMatch?.[1] || "",
          batch_id: Number(batchMatch?.[1] || 0),
          submitted_at: submitted ? row.last_update : null
        };
      });

      const summary = { generated: cards.length, submitted: 0, pending: 0 };
      const byPsa = new Map();

      for (const card of cards) {
        const row = byPsa.get(card.area) || {
          area: card.area,
          generated: 0,
          submitted: 0,
          pending: 0
        };
        const submitted = !!card.submitted_at;

        row.generated += 1;
        row.submitted += submitted ? 1 : 0;
        row.pending += submitted ? 0 : 1;
        summary.submitted += submitted ? 1 : 0;
        summary.pending += submitted ? 0 : 1;
        byPsa.set(card.area, row);
      }

      res.json({
        summary,
        byPsa: [...byPsa.values()].sort((a, b) => a.area.localeCompare(b.area)),
        cards
      });
    } catch (error) {
      console.error("SQL overview load failed:", error.message);
      res.status(503).json({ message: "Unable to load PIP overview from SQL Server" });
    }
  }
);

app.get(
  "/api/cards/:code",
  requireLogin,
  async (req, res) => {
    const code = normalizePipCode(req.params.code);
    const card = await getCard(code);

    if (!card || normalizePipCode(card.code) !== code) {
      return res.status(404).json({
        message: "PIP Card not found"
      });
    }

    const lines = await getLines(code);

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
  async (req, res) => {
    const code = normalizePipCode(req.params.code);
    const card = await getCard(code);

    if (!card || normalizePipCode(card.code) !== code) {
      writeLog({
        activity: "order_not_found",
        userName: req.session.user?.username,
        pip: code,
        message: "PIP card not found while entering counts"
      });
      return res.status(404).json({
        message: "PIP Card not found"
      });
    }

    async function saveRecountCounts({ code, userName, existing, submitted }) {
      const incoming = new Map();

      for (const entry of submitted) {
        if (!entry || !Number.isSafeInteger(Number(entry.id)) || incoming.has(Number(entry.id))) {
          const error = new Error("Invalid or duplicate recount row");
          error.statusCode = 400;
          throw error;
        }
        incoming.set(Number(entry.id), entry);
      }

      if (
        incoming.size !== existing.length ||
        existing.some(line => !incoming.has(Number(line.id)))
      ) {
        const error = new Error("All card rows must be submitted");
        error.statusCode = 400;
        throw error;
      }

      const recountLines = existing.filter(line =>
        Number(line.recount) === 1 &&
        String(line.status || "").trim().toLowerCase() === "rc pending"
      );

      if (!recountLines.length) {
        const error = new Error("This PIP card has no materials pending recount");
        error.statusCode = 409;
        throw error;
      }

      const updates = [];
      for (const line of recountLines) {
        const entry = incoming.get(Number(line.id));
        const qty = Number(entry.qty);

        if (entry.qty === null || entry.qty === "" || !Number.isSafeInteger(qty) || qty < 0) {
          const error = new Error(`Enter a valid whole-number recount on row ${line.line_no}`);
          error.statusCode = 400;
          throw error;
        }

        updates.push({
          id: Number(line.id),
          lineNo: Number(line.line_no),
          material: clean(line.material),
          qty
        });
      }

      const pool = await getSqlPool();
      const transaction = new sql.Transaction(pool);

      try {
        await transaction.begin();

        for (const update of updates) {
          const ticketResult = await transaction.request()
            .input("pipNum", sql.NVarChar, code)
            .input("ticketNumber", sql.Int, update.id)
            .query(`
              UPDATE INV.Tickets
              SET Status = 'rc confirmed', recount = 0, LastUpdate = GETDATE()
              WHERE PIPNum = @pipNum
                AND TicketNumber = @ticketNumber
                AND Status = 'rc pending'
                AND recount = 1
            `);

          if (ticketResult.rowsAffected[0] !== 1) {
            const error = new Error(`Recount row ${update.lineNo} is no longer pending`);
            error.statusCode = 409;
            throw error;
          }

          const bomResult = await transaction.request()
            .input("pipNum", sql.NVarChar, code)
            .input("ticketNumber", sql.Int, update.id)
            .input("material", sql.NVarChar, update.material)
            .input("qty", sql.Decimal(8, 2), update.qty)
            .input("userName", sql.NVarChar, clean(userName))
            .query(`
              UPDATE INV.BOM_Complex_Catalog
              SET
                Status = 'Cancelled'
              WHERE PI_Card = @pipNum
                AND TicketNumber = @ticketNumber
                AND Material = @material
            `);

          const bomResult2 = await transaction.request()
            .input("pipNum", sql.NVarChar, code)
            .input("ticketNumber", sql.Int, update.id)
            .input("material", sql.NVarChar, update.material)
            .input("qty", sql.Decimal(8, 2), update.qty)
            .input("userName", sql.NVarChar, clean(userName))
            .query(`
              Insert into INV.BOM_Complex_Catalog
              (
                Select * from INV.BOM_Complex_Catalog
                WHERE PI_Card = @pipNum
                  AND TicketNumber = @ticketNumber
                  AND Material = @material
              )
            `);

          if (!bomResult.rowsAffected[0]) {
            const error = new Error(`No BOM row found for material ${update.material} on this PIP card`);
            error.statusCode = 409;
            throw error;
          }

          if (!bomResult2.rowsAffected[0]) {
            const error = new Error(`Failed to insert BOM row for material ${update.material} on this PIP card`);
            error.statusCode = 409;
            throw error;
          }
        }

        await transaction.request()
          .input("pipNum", sql.NVarChar, code)
          .query(`
            UPDATE INV.PIP
            SET Status = 'confirmed'
            WHERE PIPNum = @pipNum
          `);
        await transaction.commit();
      } catch (error) {
        await transaction.rollback().catch(() => {});
        throw error;
      }

      const generatedCard = findGeneratedCardByCode(code);
      if (generatedCard) {
        for (const update of updates) {
          const line = generatedCard.lines.find(item =>
            Number(item.ticket_number ?? item.id) === update.id
          );
          if (!line) continue;
          line.status = "rc confirmed";
          line.recount = 0;
          line.physical_qty = update.qty;
          line.entered_by = userName;
          line.entered_at = new Date().toISOString();
        }
        generatedCard.is_recount = false;
        generatedCard.submitted_at = new Date().toISOString();
      }

      return { counted: updates.length };
    }

    if (card.submitted_at && !card.is_recount) {
      writeLog({
        activity: "error_generating_cards",
        userName: req.session.user?.username,
        pip: code,
        message: "Attempted to submit an already submitted PIP card"
      });
      return res.status(409).json({
        message: "This PIP card has already been submitted"
      });
    }

    if (!Array.isArray(req.body?.lines)) {
      return res.status(400).json({
        message: "Invalid submission"
      });
    }

    const existing = await getLines(code);

    if (card.is_recount) {
      try {
        const result = await saveRecountCounts({
          code,
          userName: req.session.user?.username,
          existing,
          submitted: req.body.lines
        });

        writeLog({
          activity: "material_inputted",
          userName: req.session.user?.username,
          pip: code,
          message: `Recount confirmed for ${result.counted} materials`
        });

        return res.json({
          success: true,
          code: card.code,
          status: "rc confirmed",
          counted: result.counted,
          voided: 0
        });
      } catch (error) {
        console.error("Recount submission failed:", error.message);
        return res.status(error.statusCode || 500).json({
          message: error.message || "Unable to save PIP recount"
        });
      }
    }

    const poPayload = req.body?.po && typeof req.body.po === "object" ? req.body.po : null;
    const poMode = !!poPayload;
    const poOrderNumber = poMode ? clean(poPayload.orderNumber).slice(0, 12) : "";
    const poLines = poMode && Array.isArray(poPayload.lines)
      ? poPayload.lines
          .map(line => ({
            material: clean(line?.material),
            qty: Number(line?.qty),
            printedQty: Number(line?.printedQty ?? 0)
          }))
          .filter(line => line.material && Number.isSafeInteger(line.qty) && line.qty >= 0)
      : [];

    if (poMode) {
      if (card.kind !== "blank") {
        return res.status(400).json({ message: "PO mode is only available on blank cards" });
      }

      if (!poOrderNumber) {
        return res.status(400).json({ message: "Enter the production order number on row 1" });
      }

      if (!poLines.length) {
        return res.status(400).json({ message: "Load the BOM and enter at least one valid actual quantity" });
      }
    }

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

    for (const [lineIndex, line] of existing.entries()) {
      const input = incoming.get(line.id);
      const blankCard = card.kind === "blank";

      let material = blankCard
        ? clean(input.material)
        : line.material;

      let description = blankCard
        ? clean(input.description)
        : line.description;

      let bin = blankCard
        ? clean(input.bin)
        : line.bin;

      let isVoid =
        blankCard &&
        !material &&
        !description &&
        !bin &&
        (input.qty === null || input.qty === "");

      let qty = isVoid ? null : input.qty;

      if (poMode) {
        if (lineIndex === 0) {
          material = poOrderNumber;
          description = "Production Order";
          bin = "";
          isVoid = false;
          qty = 0;
        } else {
          material = "";
          description = "";
          bin = "";
          isVoid = true;
          qty = null;
        }
      } else {
        if (blankCard && lineIndex > 0) {
          material = "";
          description = "";
          bin = "";
          isVoid = true;
          qty = null;
        }

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

    if (card.kind === "blank" && !poMode) {
      const pool = await getSqlPool();
      const partCache = new Map();

      for (const update of updates) {
        if (update.isVoid) continue;

        const materialKey = update.material.toUpperCase();
        if (!partCache.has(materialKey)) {
          const partResult = await pool.request()
            .input("material", sql.NVarChar, update.material)
            .query(`
              SELECT TOP 1 Material, MaterialDescription
              FROM INV.PartUniverse
              WHERE Material = @material
            `);
          partCache.set(materialKey, partResult.recordset[0] || null);
        }

        const part = partCache.get(materialKey);
        if (!part) {
          return res.status(400).json({
            message: `Material ${update.material} was not found in INV.PartUniverse`
          });
        }

        update.material = clean(part.Material);
        update.description = clean(part.MaterialDescription) || update.description;
      }
    }

    const freshCard = await getCard(code);

    if (freshCard?.submitted_at && !freshCard.is_recount) {
      return res.status(409).json({
        message: "Card was already submitted"
      });
    }

    const generatedCard = findGeneratedCardByCode(code);

    if (generatedCard) {
      for (const line of updates) {
        const targetLine = generatedCard.lines.find(item => Number(item.id) === Number(line.id));
        if (!targetLine) {
          return res.status(400).json({ message: "Invalid or duplicate row" });
        }

        targetLine.material = line.material;
        targetLine.description = line.description;
        targetLine.bin = line.bin;
        targetLine.physical_qty = line.qty;
        targetLine.is_void = line.isVoid;
        targetLine.entered_by = req.session.user.username;
        targetLine.entered_at = new Date().toISOString();
      }

      generatedCard.submitted_at = new Date().toISOString();
    }

    try {
      const submittedById = new Map(updates.map(item => [Number(item.id), item]));

      const finalLines = existing.map(line => {
        const match = submittedById.get(Number(line.id));
        const qty = match ? match.qty : null;

        return {
          line_no: line.line_no,
          material: match ? match.material : line.material,
          description: match ? match.description : line.description,
          bin: match ? match.bin : line.bin,
          location_type: line.location_type,
          is_void: match ? Number(match.isVoid) === 1 : Number(line.is_void) === 1,
          qty,
          physical_qty: qty
        };
      });

      await syncCardToInventoryTables({
        cardCode: code,
        areaName: card.area,
        subArea: card.area,
        userName: req.session.user?.username,
        lines: finalLines,
        pipStatus: "confirmed",
        poOrder: poOrderNumber,
        poLines
      });
    } catch (syncError) {
      console.error("Inventory sync failed on card submit:", syncError.message);
      writeLog({
        activity: "error_generating_cards",
        userName: req.session.user?.username,
        pip: code,
        message: syncError.message || "Unable to sync submitted card to INV.PIP / INV.Tickets"
      });

      return res.status(500).json({
        message: `Counts were NOT saved to SQL: ${syncError.message}`
      });
    }

    writeLog({
      activity: "material_inputted",
      userName: req.session.user?.username,
      pip: code,
      message: `Submitted physical counts: ${counted} counted, ${voided} voided`
    });

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
    const batch = getGeneratedBatch(Number(req.params.batchId));

    if (!batch) return res.sendStatus(404);

    const result = batch.cards.map(card => ({
      code: card.code,
      kind: card.kind,
      submitted_at: card.submitted_at,
      total_lines: Array.isArray(card.lines) ? card.lines.length : 0,
      counted_lines: Array.isArray(card.lines)
        ? card.lines.filter(line => line.physical_qty !== null && line.physical_qty !== undefined && line.physical_qty !== "").length
        : 0,
      voided_lines: Array.isArray(card.lines)
        ? card.lines.filter(line => Number(line.is_void) === 1).length
        : 0,
      mismatches: 0
    }));

    res.json(result);
  }
);


/* =====================================
   FINANCE AUDIT CONTROL API
===================================== */

// 1. Check Finance access
app.get(
  "/api/finance/status",
  requireManager,
  (req, res) => {
    res.json({
      unlocked: req.session.financeUnlocked === true
    });
  }
);

// 2. Verify Finance password
app.post(
  "/api/finance/unlock",
  requireManager,
  (req, res) => {
    const password = req.body?.password;

    if (
      typeof password !== "string" ||
      password.length === 0 ||
      password.length > 256
    ) {
      return res.status(400).json({
        message: "Enter a valid Finance password"
      });
    }

    const valid = bcrypt.compareSync(
      password,
      financePasswordHash
    );

    if (!valid) {
      return res.status(401).json({
        message: "Incorrect Finance password"
      });
    }

    req.session.financeUnlocked = true;

    req.session.save(error => {
      if (error) {
        return res.status(500).json({
          message: "Unable to save Finance session"
        });
      }

      res.json({
        unlocked: true
      });
    });
  }
);

// 3. Lock Finance tab
app.post(
  "/api/finance/lock",
  requireManager,
  (req, res) => {
    req.session.financeUnlocked = false;

    req.session.save(error => {
      if (error) {
        return res.status(500).json({
          message: "Unable to lock Finance session"
        });
      }

      res.json({
        unlocked: false
      });
    });
  }
);


/* =========================================
   FINANCE SAP INVENTORY EXCEL UPLOAD
========================================= */

app.post(
  "/api/finance/upload-inventory",
  requireFinance,
  express.raw({
    type: "application/octet-stream",
    limit: "15mb"
  }),
  async (req, res) => {
    try {
      // 1. Validate upload information

      const filename = path.basename(
        clean(req.headers["x-filename"] || "inventory.xlsx")
      );
      const snapshotDate = clean(req.headers["x-snapshot-date"]);
      const currency = clean(req.headers["x-currency"]).toUpperCase();
      const cutoffDate = new Date(`${snapshotDate}T00:00:00Z`);

      if (!/^[A-Z]{3}$/.test(currency)) {
        return res.status(400).json({
          message: "Specify a valid three-letter currency, for example USD."
        });
      }

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) ||
        Number.isNaN(cutoffDate.getTime()) ||
        cutoffDate.toISOString().slice(0, 10) !== snapshotDate
      ) {
        return res.status(400).json({
          message: "Enter a valid SAP inventory cutoff date in YYYY-MM-DD format."
        });
      }

      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({
          message: "Select an Excel file."
        });
      }

      // 2. Read the MB52 workbook

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.body);

      const sheet = workbook.worksheets[0];
      if (!sheet) {
        return res.status(400).json({
          message: "Excel worksheet not found."
        });
      }

      // 3. Detect MB52 column headers

      let headers = {};
      let headerRow = 0;

      for (
        let rowNumber = 1;
        rowNumber <= Math.min(sheet.rowCount, 25);
        rowNumber++
      ) {
        const found = {};

        sheet.getRow(rowNumber).eachCell((cell, columnNumber) => {
          const key = normalize(readCell(cell));
          if (key) found[key] = columnNumber;
        });

        if (
          (found.material || found.materialnumber) &&
          (found.storagelocation || found.sloc || found.storageloc) &&
          found.totalquantity &&
          found.totalvalue
        ) {
          headers = found;
          headerRow = rowNumber;
          break;
        }
      }

      if (!headerRow) {
        return res.status(400).json({
          message:
            "Expected MB52 columns: Material, Storage Location, " +
            "Total Quantity, and Total Value."
        });
      }

      function findFinanceColumn(...names) {
        for (const name of names) {
          const column = headers[normalize(name)];
          if (column) return column;
        }

        return 0;
      }

      const columns = {
        material: findFinanceColumn("Material", "Material Number"),
        description: findFinanceColumn("Material Description", "Description"),
        sloc: findFinanceColumn("Storage Location", "SLoc", "Storage Loc"),
        qty: findFinanceColumn("Total Quantity"),
        value: findFinanceColumn("Total Value")
      };

      // 4. Read inventory rows

      function parseFinanceNumber(value) {
        if (typeof value === "number") {
          return Number.isFinite(value) ? value : NaN;
        }

        const original = clean(value);
        if (!original) return NaN;

        const negative = original.startsWith("(") && original.endsWith(")");
        const normalized = (negative ? original.slice(1, -1) : original)
          .replace(/,/g, "")
          .trim();

        const numberPattern = negative
          ? /^(?:\d+\.?\d*|\.\d+)$/
          : /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

        if (!numberPattern.test(normalized)) return NaN;

        const parsed = Number(normalized);
        return negative ? -parsed : parsed;
      }

      const inventory = [];

      for (
        let rowNumber = headerRow + 1;
        rowNumber <= sheet.rowCount;
        rowNumber++
      ) {
        const row = sheet.getRow(rowNumber);
        const material = clean(getColumn(row, columns.material));

        if (!material) continue;

        const sloc = clean(getColumn(row, columns.sloc));
        if (!sloc) {
          throw new Error(`Storage Location missing on row ${rowNumber}.`);
        }

        const sapQty = parseFinanceNumber(getColumn(row, columns.qty));
        const sapValue = parseFinanceNumber(getColumn(row, columns.value));

        if (!Number.isFinite(sapQty)) {
          throw new Error(`Invalid Total Quantity on row ${rowNumber}.`);
        }

        if (!Number.isFinite(sapValue)) {
          throw new Error(`Invalid Total Value on row ${rowNumber}.`);
        }

        inventory.push({
          material,
          description: clean(getColumn(row, columns.description)),
          sloc,
          sap_qty: sapQty,
          sap_value: sapValue,
          currency
        });
      }

      if (!inventory.length) {
        return res.status(400).json({
          message: "No valid inventory materials found."
        });
      }

      // 5. Save the Finance upload

      await ensureFinanceTables();

      let uploadId;
      const pool = await getSqlPool();
      const transaction = new sql.Transaction(pool);
      await transaction.begin();

      try {
        const uploadResult = await new sql.Request(transaction)
          .input("filename", sql.NVarChar(260), filename)
          .input("uploadedBy", sql.NVarChar(128), req.session.user.username)
          .input("snapshotDate", sql.Date, cutoffDate)
          .query(`
            INSERT INTO INV.FinanceUploads (
              Filename,
              UploadedBy,
              SnapshotDate,
              Status
            )
            OUTPUT INSERTED.ID AS id
            VALUES (@filename, @uploadedBy, @snapshotDate, N'imported');
          `);

        uploadId = Number(uploadResult.recordset[0].id);

        const inventoryTable = new sql.Table("INV.FinanceInventory");
        inventoryTable.create = false;

        inventoryTable.columns.add("UploadID", sql.Int, { nullable: false });
        inventoryTable.columns.add("Material", sql.NVarChar(100), { nullable: false });
        inventoryTable.columns.add("Description", sql.NVarChar(sql.MAX), { nullable: false });
        inventoryTable.columns.add("SLoc", sql.NVarChar(16), { nullable: false });
        inventoryTable.columns.add("SapQty", sql.Decimal(28, 8), { nullable: false });
        inventoryTable.columns.add("SapValue", sql.Decimal(28, 8), { nullable: false });
        inventoryTable.columns.add("Currency", sql.Char(3), { nullable: false });

        for (const item of inventory) {
          inventoryTable.rows.add(
            uploadId,
            item.material,
            item.description,
            item.sloc,
            item.sap_qty,
            item.sap_value,
            item.currency
          );
        }

        await new sql.Request(transaction).bulk(inventoryTable);
        await transaction.commit();
      } catch (error) {
        await transaction.rollback().catch(() => {});
        throw error;
      }

      // 6. Return the upload summary

      res.json({
        success: true,
        uploadId,
        filename,
        snapshotDate,
        currency,
        materials: inventory.length,
        totalValue: inventory.reduce((sum, item) => sum + item.sap_value, 0)
      });
    } catch (error) {
      console.error("Finance upload error:", error.message);
      res.status(error.code ? 500 : 400).json({ message: error.message });
    }
  }
);

/* =========================================
   FINANCE UPLOAD HISTORY
========================================= */

app.get("/api/finance/uploads", requireFinance, async (req, res) => {
  try {
    await ensureFinanceTables();

    const pool = await getSqlPool();
    const result = await pool.request().query(`
      SELECT
        u.ID AS id,
        u.Filename AS filename,
        u.UploadedBy AS uploaded_by,
        u.UploadedAt AS uploaded_at,
        u.SnapshotDate AS snapshot_date,
        u.Status AS status,
        COUNT(i.ID) AS materials,
        SUM(i.SapValue) AS total_value,
        MIN(i.Currency) AS currency
      FROM INV.FinanceUploads u
      LEFT JOIN INV.FinanceInventory i ON i.UploadID = u.ID
      GROUP BY
        u.ID, u.Filename, u.UploadedBy, u.UploadedAt, u.SnapshotDate, u.Status
      ORDER BY u.ID DESC
    `);

    res.json(result.recordset);
  } catch (error) {
    console.error("Finance upload history load failed:", error.message);
    res.status(503).json({
      message: "Unable to load Finance upload history from SQL Server"
    });
  }
});

/* =========================================
   FINANCE MATERIAL RECONCILIATION
========================================= */

const financePips = `
  SELECT
    PIPNum,
    LOWER(LTRIM(RTRIM(COALESCE(Status, '')))) AS status,
    COALESCE(
      NULLIF(LTRIM(RTRIM(Area)), ''),
      NULLIF(LTRIM(RTRIM(SubArea)), ''),
      'Unassigned'
    ) AS area
  FROM INV.PIP
  WHERE PIPNum LIKE 'PIP-' + @sloc + '-%'
`;

async function readFinanceReconciliation(
  connection,
  sloc,
  uploadId,
  psa,
  material = null
) {
  const sapQuery = uploadId === null
    ? `
      SELECT
        CAST(NULL AS NVARCHAR(100)) AS material,
        CAST(NULL AS DECIMAL(28, 8)) AS sap_qty,
        CAST(NULL AS DECIMAL(28, 8)) AS sap_cost,
        CAST(NULL AS CHAR(3)) AS currency
      WHERE 1 = 0
    `
    : `
      SELECT
        Material AS material,
        SUM(SapQty) AS sap_qty,
        SUM(SapValue) AS sap_cost,
        MIN(Currency) AS currency
      FROM INV.FinanceInventory
      WHERE UploadID = @uploadId
        AND SLoc = @sloc
        AND (@material IS NULL OR Material = @material)
      GROUP BY Material
    `;

  const result = await connection.request()
    .input("sloc", sql.NVarChar(16), sloc)
    .input("psa", sql.NVarChar(256), psa)
    .input("uploadId", sql.Int, uploadId)
    .input("material", sql.NVarChar(100), material)
    .query(`
      WITH Pips AS (${financePips}),
      IncompleteAreas AS (
        SELECT DISTINCT area
        FROM Pips
        WHERE status NOT IN ('confirmed', 'rc pending')
      ),
      Tickets AS (
        SELECT
          t.PIPNum,
          t.TicketNumber,
          p.area,
          LTRIM(RTRIM(t.Material)) AS material,
          LOWER(LTRIM(RTRIM(COALESCE(t.Status, '')))) AS status,
          p.status AS pip_status,
          COALESCE(t.Recount, 0) AS recount,
          CASE WHEN i.area IS NULL THEN 0 ELSE 1 END AS incomplete_area
        FROM Pips p
        JOIN INV.Tickets t ON t.PIPNum = p.PIPNum
        LEFT JOIN IncompleteAreas i ON i.area = p.area
        WHERE NULLIF(LTRIM(RTRIM(t.Material)), '') IS NOT NULL
          AND LOWER(LTRIM(RTRIM(COALESCE(t.Status, '')))) <> 'voided'
          AND LOWER(LTRIM(RTRIM(COALESCE(t.TypeOfAdd, 'cancelled'))))
              NOT IN ('po', 'cancelled')
          AND (@material IS NULL OR LTRIM(RTRIM(t.Material)) = @material)
      ),
      ActiveCounts AS (
        SELECT
          PI_Card,
          TicketNumber,
          LTRIM(RTRIM(Material)) AS material,
          COUNT(*) AS row_count,
          MAX(PI_Card_Qty) AS qty,
          MAX(MaterialCost) AS cost
        FROM INV.BOM_Complex_Catalog
        WHERE PI_Card LIKE 'PIP-' + @sloc + '-%'
          AND LOWER(LTRIM(RTRIM(COALESCE(Status, ''))))
              NOT IN ('cancelled', 'canceled')
          AND (@material IS NULL OR LTRIM(RTRIM(Material)) = @material)
        GROUP BY PI_Card, TicketNumber, LTRIM(RTRIM(Material))
      ),
      Audited AS (
        SELECT
          t.material,
          SUM(CASE WHEN c.row_count = 1 THEN c.qty END) AS counted_qty,
          SUM(CASE WHEN c.row_count = 1 THEN c.cost END) AS counted_cost,
          MAX(t.recount) AS requested,
          MAX(CASE
            WHEN t.incomplete_area = 1
              OR t.pip_status <> 'confirmed'
              OR t.status NOT IN ('confirmed', 'rc confirmed')
              OR COALESCE(c.row_count, 0) <> 1
              OR c.qty IS NULL
            THEN 1 ELSE 0
          END) AS blocked
        FROM Tickets t
        LEFT JOIN ActiveCounts c ON c.PI_Card = t.PIPNum
          AND c.TicketNumber = t.TicketNumber
          AND c.material = t.material
          AND t.status IN ('confirmed', 'rc confirmed', 'rc pending')
          AND t.pip_status IN ('confirmed', 'rc pending')
        WHERE t.area = @psa
        GROUP BY t.material
        HAVING MAX(CASE
          WHEN t.pip_status IN ('confirmed', 'rc pending')
            AND t.status IN ('confirmed', 'rc confirmed', 'rc pending')
          THEN 1 ELSE 0
        END) = 1
      ),
      Sap AS (${sapQuery})
      SELECT
        a.material,
        a.counted_qty,
        a.counted_cost,
        s.sap_qty,
        s.sap_cost,
        s.currency,
        COALESCE(a.requested, 0) AS requested,
        CASE
          WHEN a.blocked = 0
            AND a.requested = 0
            AND a.counted_qty <> s.sap_qty
          THEN 1 ELSE 0
        END AS can_recount
      FROM Audited a
      LEFT JOIN Sap s ON s.material = a.material
        AND NOT EXISTS (
          SELECT 1
          FROM Tickets other
          WHERE other.material = a.material AND other.area <> @psa
        )
      ORDER BY a.material
    `);

  return result.recordset;
}

app.get("/api/finance/reconciliation", requireFinance, async (req, res) => {
  const sloc = clean(req.query.sloc);
  const psa = clean(req.query.psa);
  const rawUploadId = clean(req.query.uploadId);
  const uploadId = rawUploadId === "" ? null : Number(rawUploadId);

  if (!LOCATIONS.includes(sloc) || !psa || psa.length > 256) {
    return res.status(400).json({
      message: "Select a valid Production Supply Area."
    });
  }

  if (
    uploadId !== null &&
    (!Number.isSafeInteger(uploadId) || uploadId < 1 || uploadId > 2147483647)
  ) {
    return res.status(400).json({ message: "Select a valid SAP upload." });
  }

  try {
    if (uploadId !== null) await ensureFinanceTables();

    const pool = await getSqlPool();
    const materials = await readFinanceReconciliation(pool, sloc, uploadId, psa);

    res.json(materials);
  } catch (error) {
    console.error("Finance reconciliation failed:", error.message);
    res.status(503).json({ message: "Unable to load material reconciliation." });
  }
});

app.post("/api/finance/reconciliation/recount", requireFinance, async (req, res) => {
  const sloc = clean(req.body?.sloc);
  const psa = clean(req.body?.psa);
  const uploadId = Number(req.body?.uploadId);
  const material = clean(req.body?.material);

  if (
    !LOCATIONS.includes(sloc) ||
    !psa ||
    psa.length > 256 ||
    !Number.isSafeInteger(uploadId) ||
    uploadId < 1 ||
    uploadId > 2147483647 ||
    !material ||
    material.length > 100
  ) {
    return res.status(400).json({ message: "Invalid recount request." });
  }

  let transaction;

  try {
    await ensureFinanceTables();

    transaction = new sql.Transaction(await getSqlPool());
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    const [row] = await readFinanceReconciliation(
      transaction, sloc, uploadId, psa, material
    );

    if (row?.can_recount !== 1) {
      await transaction.rollback();
      return res.status(409).json({
        message: "This material is no longer eligible for recount. Refresh the table."
      });
    }

    const result = await transaction.request()
      .input("sloc", sql.NVarChar(16), sloc)
      .input("psa", sql.NVarChar(256), psa)
      .input("material", sql.NVarChar(100), material)
      .query(`
        WITH Pips AS (${financePips})
        UPDATE t
        SET Recount = 1
        FROM INV.Tickets t
        JOIN Pips p ON p.PIPNum = t.PIPNum
        WHERE p.status = 'confirmed'
          AND p.area = @psa
          AND LTRIM(RTRIM(t.Material)) = @material
          AND LOWER(LTRIM(RTRIM(COALESCE(t.Status, ''))))
              IN ('confirmed', 'rc confirmed')
          AND LOWER(LTRIM(RTRIM(COALESCE(t.TypeOfAdd, 'cancelled'))))
              NOT IN ('po', 'cancelled')
          AND COALESCE(t.Recount, 0) = 0
      `);

    await transaction.commit();

    const tickets = result.rowsAffected[0];
    void writeLog({
      activity: "finance_recount_requested",
      userName: req.session.user.username,
      message: `${material} at ${psa} (${sloc}) | SAP upload ${uploadId} | ${tickets} ticket(s)`
    });

    res.json({ tickets });
  } catch (error) {
    if (transaction) await transaction.rollback().catch(() => {});

    console.error("Finance recount request failed:", error.message);
    res.status(503).json({ message: "Unable to request recount." });
  }
});

      
// 4. Protected Finance workspace
app.get(
  "/api/finance/workspace",
  requireFinance,
  (req, res) => {
    res.json({
      message: "Finance workspace authorized"
    });
  }
);


const frontendDist = path.resolve(__dirname, "..", "frontend", "dist");

app.use("/assets", express.static(path.join(frontendDist, "assets"), {
  immutable: true,
  maxAge: "1y"
}));

app.use(express.static(frontendDist, {
  extensions: ["html"],
  maxAge: "1h"
}));

app.use((req, res, next) => {
  if (req.path.startsWith("/api/") || req.method !== "GET") {
    return next();
  }

  res.sendFile(path.join(frontendDist, "index.html"), error => {
    if (error) next(error);
  });
});

const listenHost = process.env.HOST || "0.0.0.0";
const listenPort = process.env.PORT || PORT;

app.listen(listenPort, listenHost, () => {
  console.log(
    `ABB PIP Audit backend running at http://${listenHost}:${listenPort}`
  );
});
