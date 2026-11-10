import sql from "mssql";
import { getSqlPool } from "./connection";
import type {
  Areas,
  Log,
  Settings,
  RawCatalog,
  BomComplexCatalog,
  PartUniverse,
  Pip,
  User
} from "./models";

class Queries {
  private async getRequest() {
    const pool = await getSqlPool();
    return pool.request();
  }

  private async runQuery<T>(query: string, params: Record<string, unknown> = {}) {
    const request = await this.getRequest();

    Object.entries(params).forEach(([name, value]) => {
      if (value === undefined || value === null) {
        return;
      }

      if (typeof value === "number") {
        request.input(name, sql.Int, value);
        return;
      }

      if (typeof value === "boolean") {
        request.input(name, sql.Bit, value);
        return;
      }

      request.input(name, sql.NVarChar, String(value));
    });

    const result = await request.query(query);
    return result.recordset as T[];
  }

  async fetchAreas(location?: number): Promise<Areas[]> {
    if (typeof location === "number") {
      return this.runQuery<Areas>(
        "SELECT * FROM INV.Areas WHERE InventoryLocation = @location ORDER BY AreaPK",
        { location }
      );
    }

    return this.runQuery<Areas>("SELECT * FROM INV.Areas ORDER BY AreaPK");
  }

  async fetchParts(area?: string): Promise<PartUniverse[]> {
    if (area) {
      return this.runQuery<PartUniverse>(
        `SELECT a.*
         FROM INV.PartUniverse a
         WHERE a.Area = @area OR a.Location = @area
         ORDER BY a.Material`,
        { area }
      );
    }

    return this.runQuery<PartUniverse>("SELECT * FROM INV.PartUniverse ORDER BY Material");
  }

  async fetchPipCards(pipId?: string): Promise<Pip[]> {
    if (pipId) {
      return this.runQuery<Pip>(
        "SELECT * FROM INV.PipCards WHERE PipId = @pipId ORDER BY PipId",
        { pipId }
      );
    }

    return this.runQuery<Pip>("SELECT * FROM INV.Pip ORDER BY ID");
  }

  async fetchOrder(orderNum: string): Promise<RawCatalog[]> {
    return this.runQuery<RawCatalog>(
      "SELECT * FROM INV.Raw_Catalog WHERE OrderNum = @orderNum ORDER BY ID",
      { orderNum }
    );
  }

  async fetchUsers(): Promise<User[]> {
    return this.runQuery<User>("SELECT * FROM INV.Users ORDER BY FullName");
  }

  async fetchTable(schema: string = "INV", table: string, options?: { top?: number; orderBy?: string }) {
    const safeSchema = schema.replace(/[^a-zA-Z0-9_]/g, "");
    const safeTable = table.replace(/[^a-zA-Z0-9_]/g, "");
    const top = options?.top && Number.isFinite(options.top) ? Math.min(Math.max(Number(options.top), 1), 1000) : 100;
    const orderBy = options?.orderBy && options.orderBy.trim() ? ` ORDER BY ${options.orderBy.trim()}` : "";

    return this.runQuery(
      `SELECT TOP (${top}) * FROM ${safeSchema}.${safeTable}${orderBy}`
    );
  }

  async executeReadOnly(query: string, params: Record<string, unknown> = {}) {
    const safeSql = String(query || "").trim();

    if (!safeSql || !/^(SELECT|WITH)\b/i.test(safeSql)) {
      throw new Error("Only SELECT queries are allowed through the read-only API.");
    }

    return this.runQuery(safeSql, params);
  }
}

export default new Queries();