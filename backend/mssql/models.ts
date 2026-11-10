export interface User {
  ID: number;
  Alias: string;
  FullName: string;
  Level: string;
}

export interface Pip {
  ID: number;
  PipName: string | null;
  Description: string | null;
  Status: string | null;
  Owner: string | null;
  CreatedAt: Date | null;
  UpdatedAt: Date | null;
}

export interface Tickets {
  ID: number; 
  PipNum: string | null;
  Status: string | null;
  TypeOfAdd: string | null;
  LastUpdate: Date | null;
  TicketNumber: number | null;
  Material: string | null;
}

export interface Areas {
  ID: number;
  AreaPK: string;
  SubArea: string;
  Leader: string | null;
  InventoryLeader: string | null;
  AuditLeader: string | null;
  InventoryLocation: string | null;
  Plant: string | null;
  SortIndex: number | null;
}

export interface Log {
  ID: number;
  Activity: string | null;
  User: string | null;
  DateTime: Date | null;
  TargetUser: string | null;
  Pip: string | null;
  LetterHead: string | null;
  Message: string | null;
}

export interface Settings {
  Plant: string;
  Setting: string;
  Value: string;
}

export interface RawCatalog {
  ID: number;
  Date_In: Date | null;
  Production_Order: string;
  Item_Component: string | null;
  Material: string | null;
  Requirement_Qty: number | null;
  Material_Description: string | null;
  Pegged_Requirement: string | null;
  Storage_Location: string | null;
  UnitOfEntry: string | null;
  Proc_Type: string | null;
  Special_Stock: string | null;
  Bulk_Material: string | null;
  Phantom_Item: string | null;
  BOM_Index: number | null;
  WBS: string | null;
  Backflush: string | null;
  Pegged_Description: string | null;
  Pegged_Qty: number | null;
  Qty_Withdrawn: number | null;
}

export interface BomComplexCatalog {
  ID: number;
  Date_In: Date | null;
  PI_Card: string;
  Production_Order: string | null;
  Status: string | null;
  Employee_Alias: string | null;
  Material: string | null;
  PI_Card_Qty: number | null;
  Proctype: string | null;
  TicketNumber: number;
  TypeofAddition: string | null;
  UnitOfMeasure: string | null;
  Bulk_Material: string | null;
  Phantom_Item: string | null;
  Pegged_Requirement: string | null;
  Storage_Location: string | null;
  MaterialCost: number | null;
  WBS: string | null;
  WBS_Generic: string | null;
  POStatus: string | null;
  SpecialStock: string | null;
  Backflush: string | null;
  BOM_Index: number | null;
  Material_Location: string | null;
  Qty_Withdraw: number | null;
  WBS_Production_Order: string | null;
  SalesOrder: string | null;
  SalesOrderItem: string | null;
}

export interface PartUniverse {
  ID: number;
  Material: string;
  Plant: string;
  MatStatus: string | null;
  ProcurementType: string | null;
  SpecialProcType: string | null;
  BackFlush: string | null;
  COST: number | null;
  Location: string | null;
  UnitMeasurement: string | null;
  Bulk: string | null;
}

export type { User, Pip, Areas, Log, Settings, RawCatalog, BomComplexCatalog, PartUniverse };
