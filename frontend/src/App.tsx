
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import JsBarcode from "jsbarcode";
import "./App.css";

// =====================================================
// TYPES
// =====================================================

type User = {
  username: string;
  role: "manager" | "auditor";
};

type ProductionArea = {
  id: number;
  strName: string;
};

type Batch = {
  id: number;
  sloc: string;
  area: string;
  area_id: number | null;
  created_at: string;
};

type MaterialLine = {
  id: number;
  line_no: number;
  material: string;
  description: string;
  bin: string;
  plant: string;
  stock_category: string;
  batch: string;
  uom: string;
  physical_qty: number | null;
  leader_qty?: number | null;
  sap_qty?: number | null;
  is_void: number;
};

type PipCard = {
  id: number;
  code: string;
  kind: "filled" | "blank";
  sloc: string;
  area: string;
  submitted_at: string | null;
  lines: MaterialLine[];
};

type CountEntry = {
  material: string;
  description: string;
  bin: string;
  qty: string;
};

type OverviewRow = {
  area: string;
  generated: number;
  submitted: number;
  pending: number;
};

type OverviewCard = {
  id: number;
  code: string;
  kind: "filled" | "blank";
  area: string;
  sloc: string;
  batch_id: number;
  submitted_at: string | null;
};

type OverviewData = {
  summary: {
    generated: number;
    submitted: number;
    pending: number;
  };
  byPsa: OverviewRow[];
  cards: OverviewCard[];
};

type FinanceUpload = {
  id: number;
  filename: string;
  uploaded_by: string;
  uploaded_at: string;
  snapshot_date: string | null;
  status: string;
  materials: number;
  total_value: number | null;
  currency: string | null;
};

type ManagerTab = "overview" | "cards" | "finance";

const STORAGE_LOCATIONS = ["1000", "2000", "3000"];

// =====================================================
// API HELPER
// =====================================================

async function api(
  endpoint: string,
  options: RequestInit = {}
) {
  const response = await fetch(`/api${endpoint}`, {
    credentials: "same-origin",
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }

  return data;
}

// =====================================================
// FINANCIAL FORMATTING
// =====================================================

function formatMoney(
  value: number | null,
  currency: string | null
) {
  if (
    value === null ||
    !Number.isFinite(value) ||
    !currency
  ) {
    return "—";
  }

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function formatFilename(filename: string) {
  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
}

// =====================================================
// BARCODE
// =====================================================

function PipBarcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    JsBarcode(ref.current, value, {
      format: "CODE128",
      width: 1.15,
      height: 38,
      displayValue: false,
      margin: 4,
      lineColor: "#000",
      background: "#fff"
    });
  }, [value]);

  return (
    <svg
      ref={ref}
      className="pip-barcode"
      aria-label={`Barcode ${value}`}
      role="img"
    />
  );
}

// =====================================================
// PIP CARD PRINT / PREVIEW
// =====================================================

function PipCardSheet({
  card,
  pageNumber,
  totalPages
}: {
  card: PipCard;
  pageNumber: number;
  totalPages: number;
}) {
  const isBlank = card.kind === "blank";
  const isSubmitted = !!card.submitted_at;

  return (
    <article className="pip-sheet">
      <div className="pip-sheet-header">
        <div className="pip-sheet-logo">
          <img src="/OIP.webp" alt="ABB Logo" />
        </div>

        <div className="pip-sheet-title">
          <h2>ANNUAL PHYSICAL INVENTORY</h2>
          <h3>PRODUCTION SUPPLY AREA</h3>

          <p className="pip-area-name">
            {card.area}
          </p>

          <p>PHYSICAL INVENTORY COUNT SHEET</p>
        </div>

        <div className="pip-sheet-id">
          <span>PIP CARD ID</span>
          <strong>{card.code}</strong>

          <PipBarcode value={card.code} />

          <small>
            Page {pageNumber} of {totalPages}
          </small>
        </div>
      </div>

      <div className="pip-sheet-information">
        <div>
          <strong>Storage Location:</strong>{" "}
          {card.sloc}
        </div>

        <div>
          <strong>Card Status:</strong>{" "}
          {isSubmitted ? "SUBMITTED" : "PENDING"}
        </div>

        <div>
          <strong>Count Date:</strong> ______________
        </div>
      </div>

      <table className="pip-sheet-table">
        <colgroup>
          <col style={{ width: "5%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "29%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "16%" }} />
        </colgroup>

        <thead>
          <tr>
            <th>No.</th>
            <th>Material Number</th>
            <th>Material Description</th>
            <th>Storage Bin</th>
            <th>Physical Count</th>
            <th>Leader Count</th>
          </tr>
        </thead>

        <tbody>
          {Array.from(
            { length: 10 },
            (_, index) => {
              const line = card.lines[index];

              const voidRow =
                isBlank &&
                isSubmitted &&
                line?.is_void === 1;

              if (voidRow) {
                return (
                  <tr
                    key={index}
                    className="pip-void-row"
                  >
                    <td>{index + 1}</td>

                    <td
                      colSpan={5}
                      className="pip-void-cell"
                    >
                      VOID — UNUSED ROW
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td>{line?.material ?? ""}</td>
                  <td>{line?.description ?? ""}</td>
                  <td>{line?.bin ?? ""}</td>
                  <td className="count-space"></td>
                  <td className="leader-count-space"></td>
                </tr>
              );
            }
          )}
        </tbody>
      </table>

      <div className="pip-signature-section">
        <div className="signature-box">
          <strong>Auditor Signature</strong>
          <div className="signature-line"></div>
          <span>Date: __________________</span>
        </div>

        <div className="signature-box">
          <strong>Leader Signature</strong>
          <div className="signature-line"></div>
          <span>Date: __________________</span>
        </div>
      </div>

      <div className="pip-remarks">
        <strong>Remarks:</strong>
        <span>
          ________________________________________
        </span>
      </div>

      <div className="pip-sheet-bottom">
        <span>ABB | INTERNAL INVENTORY CONTROL</span>
        <span>{card.code}</span>
      </div>
    </article>
  );
}

// =====================================================
// MANAGER OVERVIEW
// =====================================================

function ManagerOverview({
  data,
  loading,
  onRefresh
}: {
  data: OverviewData | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const [filterArea, setFilterArea] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  if (loading && !data) {
    return (
      <section className="panel">
        Loading audit overview...
      </section>
    );
  }

  if (!data) {
    return (
      <section className="panel">
        <p>Overview is not available yet.</p>

        <button
          className="secondary"
          onClick={onRefresh}
        >
          Retry
        </button>
      </section>
    );
  }

  const { summary, byPsa, cards } = data;

  const completion = summary.generated
    ? (summary.submitted / summary.generated) * 100
    : 0;

  const visibleCards = cards.filter(card => {
    const areaMatches =
      !filterArea || card.area === filterArea;

    const statusMatches =
      statusFilter === "all" ||
      (
        statusFilter === "submitted" &&
        !!card.submitted_at
      ) ||
      (
        statusFilter === "pending" &&
        !card.submitted_at
      );

    return areaMatches && statusMatches;
  });

  return (
    <>
      <div className="page-heading overview-heading">
        <div>
          <h1>Inventory Audit Overview</h1>

          <p>
            PIP card generation and submission status
            for all Production Supply Areas.
          </p>
        </div>

        <button
          className="secondary"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading
            ? "Refreshing..."
            : "Refresh Overview"}
        </button>
      </div>

      <div className="overview-kpis">
        <div className="overview-kpi">
          <span>Total PIP Generated</span>
          <strong>{summary.generated}</strong>
        </div>

        <div className="overview-kpi submitted">
          <span>PIP Submitted</span>
          <strong>{summary.submitted}</strong>
        </div>

        <div className="overview-kpi pending">
          <span>Pending PIP</span>
          <strong>{summary.pending}</strong>
        </div>

        <div className="overview-kpi">
          <span>Completion Rate</span>
          <strong>
            {completion.toFixed(1)}%
          </strong>
        </div>
      </div>

      <section className="panel">
        <h3>Overall Audit Progress</h3>

        <div className="overview-progress">
          <div
            className="overview-progress-fill"
            style={{
              width: `${completion}%`
            }}
          />
        </div>

        <p className="muted">
          {summary.submitted} of {summary.generated}
          {" "}PIP cards submitted.
        </p>
      </section>

      <section className="panel">
        <h3>PSA-wise PIP Status</h3>

        <div className="table-scroll">
          <table className="overview-table">
            <thead>
              <tr>
                <th>Production Supply Area</th>
                <th>Generated</th>
                <th>Submitted</th>
                <th>Pending</th>
                <th>Completion</th>
              </tr>
            </thead>

            <tbody>
              {byPsa.map(row => {
                const percent = row.generated
                  ? (
                      row.submitted /
                      row.generated
                    ) * 100
                  : 0;

                return (
                  <tr key={row.area}>
                    <td>
                      <strong>{row.area}</strong>
                    </td>

                    <td>{row.generated}</td>
                    <td>{row.submitted}</td>
                    <td>{row.pending}</td>

                    <td>
                      <div className="psa-progress">
                        <div
                          style={{
                            width: `${percent}%`
                          }}
                        />
                      </div>

                      <small>
                        {percent.toFixed(1)}%
                      </small>
                    </td>
                  </tr>
                );
              })}

              {byPsa.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    No PIP cards generated yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h3>Individual PIP Card Tracking</h3>

        <div className="overview-filters">
          <div>
            <label>Production Supply Area</label>

            <select
              value={filterArea}
              onChange={event =>
                setFilterArea(event.target.value)
              }
            >
              <option value="">All PSAs</option>

              {byPsa.map(row => (
                <option
                  key={row.area}
                  value={row.area}
                >
                  {row.area}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>Card Status</label>

            <select
              value={statusFilter}
              onChange={event =>
                setStatusFilter(event.target.value)
              }
            >
              <option value="all">All Cards</option>
              <option value="submitted">Submitted</option>
              <option value="pending">Pending</option>
            </select>
          </div>
        </div>

        <div className="table-scroll">
          <table className="overview-table">
            <thead>
              <tr>
                <th>PIP Card ID</th>
                <th>PSA</th>
                <th>SLoc</th>
                <th>Type</th>
                <th>Status</th>
                <th>Submitted At</th>
              </tr>
            </thead>

            <tbody>
              {visibleCards.map(card => (
                <tr key={card.id}>
                  <td>
                    <strong>{card.code}</strong>
                  </td>

                  <td>{card.area}</td>
                  <td>{card.sloc}</td>

                  <td>
                    {card.kind === "blank"
                      ? "Blank"
                      : "Material"}
                  </td>

                  <td>
                    <span
                      className={
                        card.submitted_at
                          ? "status-chip status-submitted"
                          : "status-chip status-pending"
                      }
                    >
                      {card.submitted_at
                        ? "Submitted"
                        : "Pending"}
                    </span>
                  </td>

                  <td>
                    {card.submitted_at || "—"}
                  </td>
                </tr>
              ))}

              {visibleCards.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    No PIP cards match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// =====================================================
// FINANCE: SAP UPLOAD + PSA MONITORING
// =====================================================

function FinanceMonitoring({
  overview,
  overviewLoading,
  onRefresh,
  sapFile,
  onFileChange,
  sapCutoffDate,
  onDateChange,
  sapCurrency,
  onCurrencyChange,
  sapUploading,
  onUpload,
  sapUploads,
  sapUploadsLoading,
  onRefreshUploads,
  sapUploadMessage,
  sapUploadError
}: {
  overview: OverviewData | null;
  overviewLoading: boolean;
  onRefresh: () => void;

  sapFile: File | null;
  onFileChange: (file: File | null) => void;

  sapCutoffDate: string;
  onDateChange: (value: string) => void;

  sapCurrency: string;
  onCurrencyChange: (value: string) => void;

  sapUploading: boolean;
  onUpload: (event: FormEvent<HTMLFormElement>) => void;

  sapUploads: FinanceUpload[];
  sapUploadsLoading: boolean;
  onRefreshUploads: () => void;

  sapUploadMessage: string;
  sapUploadError: string;
}) {
  const completedPsaCount =
    overview?.byPsa.filter(
      area =>
        area.generated > 0 &&
        area.submitted === area.generated
    ).length ?? 0;

  return (
    <div className="finance-monitoring">

      {/* =====================================
          SAP INVENTORY UPLOAD
      ===================================== */}

      <section className="finance-sap-upload">
        <div className="finance-sap-heading">
          <h3>SAP Inventory Data Upload</h3>

          <p className="muted">
            Upload the official SAP inventory report
            containing material quantities and
            inventory values.
          </p>
        </div>

        <form
          className="finance-sap-form"
          onSubmit={onUpload}
        >
          <div className="finance-sap-field">
            <label htmlFor="sapExcelFile">
              SAP Inventory Excel File
            </label>

            <input
              id="sapExcelFile"
              type="file"
              accept=".xlsx"
              disabled={sapUploading}
              onChange={event =>
                onFileChange(
                  event.target.files?.[0] || null
                )
              }
              required
            />

            {sapFile && (
              <small className="muted">
                Selected: {sapFile.name}
              </small>
            )}
          </div>

          <div className="finance-sap-fields">
            <div className="finance-sap-field">
              <label htmlFor="sapCutoffDate">
                Inventory Cutoff Date
              </label>

              <input
                id="sapCutoffDate"
                type="date"
                value={sapCutoffDate}
                onChange={event =>
                  onDateChange(event.target.value)
                }
                disabled={sapUploading}
                required
              />
            </div>

            <div className="finance-sap-field">
              <label htmlFor="sapCurrency">
                Inventory Currency
              </label>

              <select
                id="sapCurrency"
                value={sapCurrency}
                onChange={event =>
                  onCurrencyChange(
                    event.target.value
                  )
                }
                disabled={sapUploading}
              >
                <option value="USD">
                  USD — US Dollar
                </option>
                <option value="EUR">
                  EUR — Euro
                </option>
                <option value="INR">
                  INR — Indian Rupee
                </option>
                <option value="GBP">
                  GBP — British Pound
                </option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            className="primary"
            disabled={
              sapUploading ||
              !sapFile ||
              !sapCutoffDate
            }
          >
            {sapUploading
              ? "Uploading SAP Inventory..."
              : "Upload SAP Inventory"}
          </button>
        </form>

        {sapUploadMessage && (
          <div className="success-message">
            {sapUploadMessage}
          </div>
        )}

        {sapUploadError && (
          <div className="error-message">
            {sapUploadError}
          </div>
        )}

        {/* SAP UPLOAD HISTORY */}

        <div className="finance-upload-history">
          <div className="finance-history-title">
            <h3>SAP Upload History</h3>

            <button
              type="button"
              className="secondary"
              onClick={onRefreshUploads}
              disabled={sapUploadsLoading}
            >
              {sapUploadsLoading
                ? "Refreshing..."
                : "Refresh History"}
            </button>
          </div>

          <div className="table-scroll">
            <table className="overview-table">
              <thead>
                <tr>
                  <th>Upload ID</th>
                  <th>File</th>
                  <th>Cutoff Date</th>
                  <th>Material Rows</th>
                  <th>Inventory Value</th>
                  <th>Currency</th>
                  <th>Status</th>
                </tr>
              </thead>

              <tbody>
                {sapUploads.map(upload => (
                  <tr key={upload.id}>
                    <td>{upload.id}</td>

                    <td>
                      {formatFilename(
                        upload.filename
                      )}
                    </td>

                    <td>
                      {upload.snapshot_date || "—"}
                    </td>

                    <td>
                      {upload.materials}
                    </td>

                    <td>
                      {formatMoney(
                        upload.total_value,
                        upload.currency
                      )}
                    </td>

                    <td>
                      {upload.currency || "—"}
                    </td>

                    <td>
                      <span className="status-chip status-submitted">
                        {upload.status}
                      </span>
                    </td>
                  </tr>
                ))}

                {sapUploads.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      {sapUploadsLoading
                        ? "Loading upload history..."
                        : "No SAP inventory files uploaded yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* =====================================
          PLANT AUDIT MONITORING
      ===================================== */}

      <section className="panel">
        <div className="finance-history-title">
          <div>
            <h3>Plant Audit Monitoring</h3>

            <p className="muted">
              Monitor original PIP card submission
              progress for each Production Supply Area.
            </p>
          </div>

          <button
            type="button"
            className="secondary"
            onClick={onRefresh}
            disabled={overviewLoading}
          >
            {overviewLoading
              ? "Refreshing..."
              : "Refresh Audit Status"}
          </button>
        </div>

        {overview ? (
          <>
            <div className="overview-kpis">
              <div className="overview-kpi">
                <span>Total PIP Generated</span>
                <strong>
                  {overview.summary.generated}
                </strong>
              </div>

              <div className="overview-kpi submitted">
                <span>PIP Submitted</span>
                <strong>
                  {overview.summary.submitted}
                </strong>
              </div>

              <div className="overview-kpi pending">
                <span>Pending PIP</span>
                <strong>
                  {overview.summary.pending}
                </strong>
              </div>

              <div className="overview-kpi">
                <span>Completed PSAs</span>
                <strong>
                  {completedPsaCount}
                </strong>
              </div>
            </div>

            <h3>PSA Audit Completion</h3>

            <div className="table-scroll">
              <table className="overview-table">
                <thead>
                  <tr>
                    <th>Production Supply Area</th>
                    <th>Total PIP</th>
                    <th>Submitted</th>
                    <th>Pending</th>
                    <th>Completion</th>
                    <th>Recount Eligibility</th>
                  </tr>
                </thead>

                <tbody>
                  {overview.byPsa.map(area => {
                    const completion =
                      area.generated > 0
                        ? (
                            area.submitted /
                            area.generated
                          ) * 100
                        : 0;

                    const eligible =
                      area.generated > 0 &&
                      area.submitted ===
                        area.generated;

                    return (
                      <tr key={area.area}>
                        <td>
                          <strong>
                            {area.area}
                          </strong>
                        </td>

                        <td>{area.generated}</td>
                        <td>{area.submitted}</td>
                        <td>{area.pending}</td>

                        <td>
                          <div className="psa-progress">
                            <div
                              style={{
                                width: `${completion}%`
                              }}
                            />
                          </div>

                          <small>
                            {completion.toFixed(1)}%
                          </small>
                        </td>

                        <td>
                          <span
                            className={
                              eligible
                                ? "status-chip status-submitted"
                                : "status-chip status-pending"
                            }
                          >
                            {eligible
                              ? "Eligible"
                              : "Locked"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}

                  {overview.byPsa.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        No PIP cards generated yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <p className="muted">
              Recount eligibility is currently shown
              for monitoring. Actual recount requests
              will only be enabled after Finance
              reconciliation and backend eligibility
              validation are implemented.
            </p>
          </>
        ) : (
          <p className="muted">
            {overviewLoading
              ? "Loading Finance audit progress..."
              : "Finance audit progress is not available."}
          </p>
        )}
      </section>
    </div>
  );
}

// =====================================================
// MAIN APPLICATION
// =====================================================

function App() {
  // =====================================
  // LOGIN
  // =====================================

  const [user, setUser] =
    useState<User | null>(null);

  const [checking, setChecking] =
    useState(true);

  const [busy, setBusy] =
    useState(false);

  const [username, setUsername] =
    useState("");

  const [password, setPassword] =
    useState("");

  // =====================================
  // MANAGER TABS
  // =====================================

  const [managerTab, setManagerTab] =
    useState<ManagerTab>("overview");

  // =====================================
  // FINANCE ACCESS
  // =====================================

  const [financeUnlocked, setFinanceUnlocked] =
    useState(false);

  const [financePassword, setFinancePassword] =
    useState("");

  const [financeLoading, setFinanceLoading] =
    useState(false);

  const [financeError, setFinanceError] =
    useState("");

  // =====================================
  // FINANCE SAP UPLOAD
  // =====================================

  const [sapFile, setSapFile] =
    useState<File | null>(null);

  const sapFileInputRef =
    useRef<HTMLInputElement>(null);

  const [sapCutoffDate, setSapCutoffDate] =
    useState("");

  const [sapCurrency, setSapCurrency] =
    useState("USD");

  const [sapUploading, setSapUploading] =
    useState(false);

  const [sapUploadsLoading, setSapUploadsLoading] =
    useState(false);

  const [sapUploads, setSapUploads] =
    useState<FinanceUpload[]>([]);

  const [sapUploadMessage, setSapUploadMessage] =
    useState("");

  const [sapUploadError, setSapUploadError] =
    useState("");

  // =====================================
  // MANAGER OVERVIEW
  // =====================================

  const [overview, setOverview] =
    useState<OverviewData | null>(null);

  const [overviewLoading, setOverviewLoading] =
    useState(false);

  // =====================================
  // PIP CARD MANAGEMENT
  // =====================================

  const [sloc, setSloc] =
    useState("1000");

  const [productionAreas, setProductionAreas] =
    useState<ProductionArea[]>([]);

  const [selectedAreaId, setSelectedAreaId] =
    useState("");

  const [areasLoading, setAreasLoading] =
    useState(false);

  const [file, setFile] =
    useState<File | null>(null);

  const [batches, setBatches] =
    useState<Batch[]>([]);

  const [batchId, setBatchId] =
    useState<number | null>(null);

  const [cards, setCards] =
    useState<PipCard[]>([]);

  const [showPreview, setShowPreview] =
    useState(false);

  const [printCards, setPrintCards] =
    useState<PipCard[]>([]);

  const [blankQuantity, setBlankQuantity] =
    useState(1);

  // =====================================
  // AUDITOR
  // =====================================

  const [cardSearch, setCardSearch] =
    useState("");

  const [selectedCard, setSelectedCard] =
    useState<PipCard | null>(null);

  const [entries, setEntries] =
    useState<Record<number, CountEntry>>({});

  // =====================================
  // MESSAGES
  // =====================================

  const [error, setError] =
    useState("");

  const [message, setMessage] =
    useState("");

  const isManager =
    user?.role === "manager";

  const selectedArea = productionAreas.find(
    area =>
      String(area.id) === selectedAreaId
  );

  // ===================================================
  // SESSION CHECK
  // ===================================================

  useEffect(() => {
    api("/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  // ===================================================
  // MANAGER DATA
  // ===================================================

  useEffect(() => {
    if (user?.role !== "manager") return;

    void loadBatches();
    void loadOverview();

    setAreasLoading(true);

    api("/production-areas")
      .then((data: ProductionArea[]) => {
        setProductionAreas(data);
      })
      .catch(err => {
        setError(err.message);
      })
      .finally(() => {
        setAreasLoading(false);
      });
  }, [user]);

  async function loadBatches() {
    try {
      const data: Batch[] =
        await api("/batches");

      setBatches(data);

      setBatchId(previous => {
        if (
          previous !== null &&
          data.some(
            batch => batch.id === previous
          )
        ) {
          return previous;
        }

        return data.length
          ? data[0].id
          : null;
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function loadOverview() {
    setOverviewLoading(true);

    try {
      const data: OverviewData =
        await api("/overview");

      setOverview(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOverviewLoading(false);
    }
  }

  // ===================================================
  // FINANCE: LOAD UPLOAD HISTORY
  // ===================================================

  async function loadSapUploads() {
    setSapUploadsLoading(true);
    setSapUploadError("");

    try {
      const data: FinanceUpload[] =
        await api("/finance/uploads");

      setSapUploads(data);
    } catch (err) {
      setSapUploadError(
        (err as Error).message
      );
    } finally {
      setSapUploadsLoading(false);
    }
  }

  // ===================================================
  // FINANCE: CHECK ACCESS
  // ===================================================

  async function checkFinanceAccess() {
    setFinanceLoading(true);
    setFinanceError("");
    setFinanceUnlocked(false);

    try {
      const status: {
        unlocked: boolean;
      } = await api("/finance/status");

      if (status.unlocked) {
        await api("/finance/workspace");

        setFinanceUnlocked(true);

        await loadSapUploads();
      }
    } catch (err) {
      setFinanceUnlocked(false);

      setFinanceError(
        (err as Error).message
      );
    } finally {
      setFinanceLoading(false);
    }
  }

  // ===================================================
  // FINANCE: UNLOCK
  // ===================================================

  async function unlockFinance(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setFinanceLoading(true);
    setFinanceError("");

    try {
      await api("/finance/unlock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          password: financePassword
        })
      });

      await api("/finance/workspace");

      setFinanceUnlocked(true);
      setFinancePassword("");

      await loadSapUploads();
      await loadOverview();

    } catch (err) {
      setFinanceUnlocked(false);

      setFinanceError(
        (err as Error).message
      );
    } finally {
      setFinanceLoading(false);
    }
  }

  // ===================================================
  // FINANCE: LOCK
  // ===================================================

  async function lockFinance() {
    setFinanceLoading(true);
    setFinanceError("");

    try {
      await api("/finance/lock", {
        method: "POST"
      });

      setFinanceUnlocked(false);
      setFinancePassword("");

      setSapFile(null);
      setSapUploads([]);
      setSapUploadMessage("");
      setSapUploadError("");

      if (sapFileInputRef.current) {
        sapFileInputRef.current.value = "";
      }

    } catch (err) {
      setFinanceError(
        (err as Error).message
      );
    } finally {
      setFinanceLoading(false);
    }
  }

  // ===================================================
  // FINANCE: UPLOAD SAP INVENTORY
  // ===================================================

  async function uploadSapInventory(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!financeUnlocked) {
      setSapUploadError(
        "Unlock Finance access first."
      );
      return;
    }

    if (!sapFile) {
      setSapUploadError(
        "Select a SAP Excel file."
      );
      return;
    }

    if (
      !sapFile.name
        .toLowerCase()
        .endsWith(".xlsx")
    ) {
      setSapUploadError(
        "Only .xlsx Excel files are supported."
      );
      return;
    }

    if (!sapCutoffDate) {
      setSapUploadError(
        "Select the SAP inventory cutoff date."
      );
      return;
    }

    const currency =
      sapCurrency.trim().toUpperCase();

    if (!/^[A-Z]{3}$/.test(currency)) {
      setSapUploadError(
        "Select a valid three-letter currency."
      );
      return;
    }

    setSapUploading(true);
    setSapUploadError("");
    setSapUploadMessage("");

    try {
      const buffer =
        await sapFile.arrayBuffer();

      const result = await api(
        "/finance/upload-inventory",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/octet-stream",

            "X-Filename":
              encodeURIComponent(sapFile.name),

            "X-Snapshot-Date":
              sapCutoffDate,

            "X-Currency":
              currency
          },

          body: buffer
        }
      );

      setSapUploadMessage(
        `SAP inventory imported successfully. ` +
        `${result.materials} material rows uploaded. ` +
        `Total inventory value: ` +
        formatMoney(
          result.totalValue,
          currency
        )
      );

      setSapFile(null);

      if (sapFileInputRef.current) {
        sapFileInputRef.current.value = "";
      }

      await loadSapUploads();

    } catch (err) {
      setSapUploadError(
        (err as Error).message
      );
    } finally {
      setSapUploading(false);
    }
  }

  // ===================================================
  // MANAGER: CHANGE TAB
  // ===================================================

  function openManagerTab(tab: ManagerTab) {
    setManagerTab(tab);

    setError("");
    setMessage("");
    setFinanceError("");

    if (
      tab === "overview" ||
      tab === "finance"
    ) {
      void loadOverview();
    }

    if (tab === "finance") {
      void checkFinanceAccess();
    }
  }

  // ===================================================
  // LOGIN
  // ===================================================

  async function login(event: FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result: User =
        await api("/login", {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            username,
            password
          })
        });

      setUser(result);
      setPassword("");
    } catch (err) {
      setError(
        (err as Error).message
      );
    } finally {
      setBusy(false);
    }
  }

  // ===================================================
  // LOGOUT
  // ===================================================

  async function logout() {
    try {
      await api("/logout", {
        method: "POST"
      });
    } catch (err) {
      setError(
        (err as Error).message
      );
      return;
    }

    setUser(null);
    setOverview(null);
    setManagerTab("overview");

    setFinanceUnlocked(false);
    setFinancePassword("");
    setFinanceError("");
    setFinanceLoading(false);

    setSapFile(null);
    setSapCutoffDate("");
    setSapUploads([]);
    setSapUploadMessage("");
    setSapUploadError("");

    setProductionAreas([]);
    setSelectedAreaId("");
    setBatches([]);
    setBatchId(null);
    setCards([]);
    setPrintCards([]);
    setSelectedCard(null);
    setEntries({});
    setShowPreview(false);

    setError("");
    setMessage("");
  }

  // ===================================================
  // MANAGER: UPLOAD EXCEL
  // ===================================================

  async function uploadExcel() {
    if (!selectedAreaId) {
      setError(
        "Select a Production Supply Area."
      );
      return;
    }

    if (!file) {
      setError(
        "Select an Excel file."
      );
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const buffer =
        await file.arrayBuffer();

      const result =
        await api("/import", {
          method: "POST",
          headers: {
            "Content-Type":
              "application/octet-stream",
            "X-SLoc": sloc,
            "X-Area-Id": selectedAreaId
          },
          body: buffer
        });

      setBatchId(result.batchId);
      setFile(null);
      setCards([]);
      setShowPreview(false);

      await loadBatches();
      await loadOverview();

      setMessage(
        `${result.materials} materials imported ` +
        `for ${result.area}. ` +
        `${result.cards} PIP cards generated.`
      );

    } catch (err) {
      setError(
        (err as Error).message
      );
    } finally {
      setBusy(false);
    }
  }

  // ===================================================
  // MANAGER: FETCH CARDS
  // ===================================================

  async function fetchCards(): Promise<PipCard[]> {
    if (!batchId) {
      throw new Error(
        "Select an audit batch."
      );
    }

    return api(
      `/batches/${batchId}/cards`
    );
  }

  async function viewCards() {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result =
        await fetchCards();

      setCards(result);
      setShowPreview(true);

    } catch (err) {
      setError(
        (err as Error).message
      );
    } finally {
      setBusy(false);
    }
  }

  // ===================================================
  // MANAGER: BLANK CARDS
  // ===================================================

  async function generateBlankCards() {
    if (!batchId) {
      setError(
        "Select an audit batch."
      );
      return;
    }

    if (
      !Number.isInteger(blankQuantity) ||
      blankQuantity < 1 ||
      blankQuantity > 100
    ) {
      setError(
        "Choose between 1 and 100 blank cards."
      );
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result =
        await api("/blank-cards", {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            batchId,
            quantity: blankQuantity
          })
        });

      setCards(await fetchCards());
      setShowPreview(true);

      await loadOverview();

      setMessage(
        `${result.generated.length} ` +
        `blank cards generated.`
      );

    } catch (err) {
      setError(
        (err as Error).message
      );
    } finally {
      setBusy(false);
    }
  }

  // ===================================================
  // MANAGER: PRINT CARDS
  // ===================================================

  async function printPipCards(
    kind: "filled" | "blank"
  ) {
    setBusy(true);
    setError("");

    try {
      const allCards =
        await fetchCards();

      const chosen =
        allCards.filter(
          card => card.kind === kind
        );

      if (!chosen.length) {
        setError(
          kind === "blank"
            ? "Generate blank cards first."
            : "No filled PIP cards found."
        );
        return;
      }

      setPrintCards(chosen);

      window.setTimeout(() => {
        window.print();
      }, 500);

    } catch (err) {
      setError(
        (err as Error).message
      );
    } finally {
      setBusy(false);
    }
  }

  // ===================================================
  // AUDITOR: FIND PIP CARD
  // ===================================================

  async function findCard(event: FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const code =
        cardSearch.trim().toUpperCase();

      const card: PipCard =
        await api(
          `/cards/${encodeURIComponent(code)}`
        );

      setSelectedCard(card);

      const values:
        Record<number, CountEntry> = {};

      for (const line of card.lines) {
        values[line.id] = {
          material: line.material || "",
          description: line.description || "",
          bin: line.bin || "",
          qty: line.physical_qty == null
            ? ""
            : String(line.physical_qty)
        };
      }

      setEntries(values);

      if (card.submitted_at) {
        setMessage(
          "This PIP card has already been submitted. " +
          "It is now read-only."
        );
      }

    } catch (err) {
      setSelectedCard(null);
      setError(
        (err as Error).message
      );
    } finally {
      setBusy(false);
    }
  }

  function updateEntry(
    id: number,
    field: keyof CountEntry,
    value: string
  ) {
    setEntries(previous => ({
      ...previous,
      [id]: {
        ...previous[id],
        [field]: value
      }
    }));
  }

  // ===================================================
  // AUDITOR: SUBMIT COUNTS
  // ===================================================

  async function submitCounts() {
    if (
      !selectedCard ||
      selectedCard.submitted_at
    ) {
      return;
    }

    const submitted =
      selectedCard.lines.map(line => {
        const entry = entries[line.id];

        return {
          id: line.id,
          material: entry.material,
          description: entry.description,
          bin: entry.bin,
          qty: entry.qty.trim() === ""
            ? null
            : Number(entry.qty)
        };
      });

    let counted = 0;
    let voided = 0;

    for (const row of submitted) {
      const isBlankCard =
        selectedCard.kind === "blank";

      const isVoid =
        isBlankCard &&
        !row.material.trim() &&
        !row.description.trim() &&
        !row.bin.trim() &&
        row.qty === null;

      if (isVoid) {
        voided++;
        continue;
      }

      if (
        isBlankCard &&
        !row.material.trim()
      ) {
        setError(
          "Every used blank-card row needs " +
          "a material number."
        );
        return;
      }

      if (
        row.qty === null ||
        !Number.isSafeInteger(row.qty) ||
        row.qty < 0
      ) {
        setError(
          "Every used material row needs a " +
          "valid whole-number count. " +
          "Zero is allowed."
        );
        return;
      }

      counted++;
    }

    if (counted === 0) {
      setError(
        "Enter at least one material."
      );
      return;
    }

    const confirmed = window.confirm(
      `Submit ${selectedCard.code}?\n\n` +
      `${counted} counted material rows\n` +
      `${voided} VOID rows\n\n` +
      "This submission will be final."
    );

    if (!confirmed) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result =
        await api(
          `/cards/${encodeURIComponent(
            selectedCard.code
          )}/counts`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              lines: submitted
            })
          }
        );

      setMessage(
        `PIP ${result.code} submitted successfully. ` +
        `${result.counted} counted rows; ` +
        `${result.voided} VOID rows.`
      );

      setSelectedCard(null);
      setCardSearch("");
      setEntries({});

    } catch (err) {
      setError(
        (err as Error).message
      );
    } finally {
      setBusy(false);
    }
  }

  // ===================================================
  // LOADING SCREEN
  // ===================================================

  if (checking) {
    return (
      <div className="loading-screen">
        Loading ABB Physical Inventory Audit...
      </div>
    );
  }

  // ===================================================
  // LOGIN SCREEN
  // ===================================================

  if (!user) {
    return (
      <main className="login-screen">
        <form
          className="login-box"
          onSubmit={login}
        >
          <img
            src="/OIP.webp"
            alt="ABB Logo"
            className="login-logo"
          />

          <h1>
            Physical Inventory Audit
          </h1>

          <p className="muted">
            ABB Internal Inventory Management
          </p>

          <label>Username</label>

          <input
            value={username}
            onChange={event =>
              setUsername(event.target.value)
            }
            autoComplete="username"
            placeholder="Enter username"
            required
          />

          <label>Password</label>

          <input
            type="password"
            value={password}
            onChange={event =>
              setPassword(event.target.value)
            }
            autoComplete="current-password"
            placeholder="Enter password"
            required
          />

          {error && (
            <p className="error">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="primary"
            disabled={busy}
          >
            {busy
              ? "Signing in..."
              : "Sign In"}
          </button>

          <small>
            Authorized physical inventory personnel only
          </small>
        </form>
      </main>
    );
  }

  // ===================================================
  // MAIN DASHBOARD
  // ===================================================

  return (
    <div className="app-shell">

      {/* =====================================
          SIDEBAR
      ===================================== */}

      <aside className="sidebar">
        <div className="sidebar-brand">
          <img
            src="/OIP.webp"
            alt="ABB Logo"
          />

          <h2>Physical Inventory Audit</h2>

          <p>
            Inventory Control System
          </p>
        </div>

        <div className="sidebar-navigation">
          {isManager ? (
            <>
              <button
                type="button"
                className={
                  managerTab === "overview"
                    ? "sidebar-active sidebar-tab"
                    : "sidebar-tab"
                }
                onClick={() =>
                  openManagerTab("overview")
                }
              >
                Overview
              </button>

              <button
                type="button"
                className={
                  managerTab === "cards"
                    ? "sidebar-active sidebar-tab"
                    : "sidebar-tab"
                }
                onClick={() =>
                  openManagerTab("cards")
                }
              >
                PIP Card Management
              </button>

              <button
                type="button"
                className={
                  managerTab === "finance"
                    ? "sidebar-active sidebar-tab"
                    : "sidebar-tab"
                }
                onClick={() =>
                  openManagerTab("finance")
                }
              >
                <span className="finance-nav-label">
                  <span>
                    Finance Audit Control
                  </span>
                  <span>🔒</span>
                </span>
              </button>
            </>
          ) : (
            <div className="sidebar-active">
              Physical Count Entry
            </div>
          )}
        </div>

        <button
          className="logout-button"
          onClick={logout}
        >
          Sign Out
        </button>
      </aside>

      {/* =====================================
          MAIN CONTENT
      ===================================== */}

      <main className="main-workspace">
        <header className="topbar">
          <div>
            <h2>
              ABB Physical Inventory Audit
            </h2>

            <p>
              Annual Physical Inventory
            </p>
          </div>

          <div className="user-information">
            <strong>
              {user.username}
            </strong>

            <span>
              {user.role.toUpperCase()}
            </span>
          </div>
        </header>

        <div className="page-content">

          {/* =====================================
              FINANCE AUDIT CONTROL
          ===================================== */}

          {isManager &&
            managerTab === "finance" && (
              <>
                <div className="page-heading">
                  <h1>
                    Finance Audit Control
                  </h1>

                  <p>
                    Secure inventory reconciliation,
                    financial variance monitoring,
                    and recount management.
                  </p>
                </div>

                {financeLoading &&
                 !financeUnlocked ? (

                  <section className="panel finance-login-panel">
                    <p>
                      Checking Finance access...
                    </p>
                  </section>

                ) : !financeUnlocked ? (

                  /* FINANCE PASSWORD SCREEN */

                  <section className="panel finance-login-panel">
                    <div className="finance-lock-icon">
                      🔒
                    </div>

                    <h2>
                      Finance Access Required
                    </h2>

                    <p className="muted">
                      This section is restricted
                      to authorized Finance personnel.
                    </p>

                    <form onSubmit={unlockFinance}>
                      <label htmlFor="financePassword">
                        Finance Password
                      </label>

                      <input
                        id="financePassword"
                        type="password"
                        value={financePassword}
                        onChange={event =>
                          setFinancePassword(
                            event.target.value
                          )
                        }
                        placeholder="Enter Finance Password"
                        autoComplete="off"
                        required
                        disabled={financeLoading}
                      />

                      {financeError && (
                        <p className="error-message">
                          {financeError}
                        </p>
                      )}

                      <button
                        type="submit"
                        className="primary"
                        disabled={
                          financeLoading ||
                          !financePassword.trim()
                        }
                      >
                        {financeLoading
                          ? "Verifying Password..."
                          : "Unlock Finance Tab"}
                      </button>
                    </form>
                  </section>

                ) : (

                  /* FINANCE WORKSPACE */

                  <section className="finance-workspace">
                    <div className="panel">
                      <div className="finance-workspace-header">
                        <div>
                          <h2>
                            Finance Audit Workspace
                          </h2>

                          <p className="muted">
                            Finance access verified.
                            SAP inventory management
                            and audit monitoring.
                          </p>
                        </div>

                        <button
                          type="button"
                          className="secondary"
                          onClick={lockFinance}
                          disabled={financeLoading}
                        >
                          🔒 Lock Finance Tab
                        </button>
                      </div>
                    </div>

                    <FinanceMonitoring
                      overview={overview}
                      overviewLoading={
                        overviewLoading
                      }
                      onRefresh={loadOverview}

                      sapFile={sapFile}
                      onFileChange={setSapFile}

                      sapCutoffDate={
                        sapCutoffDate
                      }
                      onDateChange={
                        setSapCutoffDate
                      }

                      sapCurrency={
                        sapCurrency
                      }
                      onCurrencyChange={
                        setSapCurrency
                      }

                      sapUploading={
                        sapUploading
                      }
                      onUpload={
                        uploadSapInventory
                      }

                      sapUploads={
                        sapUploads
                      }
                      sapUploadsLoading={
                        sapUploadsLoading
                      }
                      onRefreshUploads={
                        loadSapUploads
                      }

                      sapUploadMessage={
                        sapUploadMessage
                      }
                      sapUploadError={
                        sapUploadError
                      }
                    />

                    {financeError && (
                      <div className="error-message">
                        {financeError}
                      </div>
                    )}
                  </section>
                )}
              </>
            )}

          {/* =====================================
              MANAGER OVERVIEW
          ===================================== */}

          {isManager &&
            managerTab === "overview" && (
              <ManagerOverview
                data={overview}
                loading={overviewLoading}
                onRefresh={loadOverview}
              />
            )}

          {/* =====================================
              PIP CARD MANAGEMENT
          ===================================== */}

          {isManager &&
            managerTab === "cards" && (
              <>
                <div className="page-heading">
                  <h1>
                    PIP Card Management
                  </h1>

                  <p>
                    Generate, preview, and print
                    physical inventory cards.
                  </p>
                </div>

                <section className="panel">
                  <h3>
                    1. Select Storage Location
                  </h3>

                  <div className="location-grid">
                    {STORAGE_LOCATIONS.map(
                      location => (
                        <button
                          type="button"
                          key={location}
                          className={
                            sloc === location
                              ? "location-button selected"
                              : "location-button"
                          }
                          onClick={() =>
                            setSloc(location)
                          }
                        >
                          {location}
                        </button>
                      )
                    )}
                  </div>

                  <div className="production-area-select">
                    <label htmlFor="productionArea">
                      Production Supply Area
                    </label>

                    <select
                      id="productionArea"
                      value={selectedAreaId}
                      onChange={event =>
                        setSelectedAreaId(
                          event.target.value
                        )
                      }
                      disabled={areasLoading}
                    >
                      <option value="">
                        {areasLoading
                          ? "Loading PSAs..."
                          : "-- Select Production Supply Area --"}
                      </option>

                      {productionAreas.map(
                        area => (
                          <option
                            key={area.id}
                            value={String(area.id)}
                          >
                            {area.strName}
                          </option>
                        )
                      )}
                    </select>

                    {selectedArea && (
                      <p className="muted">
                        Selected:{" "}
                        {selectedArea.strName}
                      </p>
                    )}
                  </div>

                  <h3>
                    2. Upload Excel Material List
                  </h3>

                  <p className="muted">
                    One PIP card is generated
                    for every 10 material rows.
                  </p>

                  <input
                    className="file-input"
                    type="file"
                    accept=".xlsx"
                    onChange={event =>
                      setFile(
                        event.target.files?.[0] ||
                        null
                      )
                    }
                  />

                  <div className="button-row">
                    <button
                      className="primary"
                      onClick={uploadExcel}
                      disabled={
                        busy ||
                        !file ||
                        !selectedAreaId
                      }
                    >
                      Upload Excel & Generate
                      PIP Cards
                    </button>
                  </div>
                </section>

                <section className="panel">
                  <h3>
                    3. Select Audit Batch
                  </h3>

                  <select
                    className="batch-select"
                    value={batchId ?? ""}
                    onChange={event => {
                      setBatchId(
                        Number(
                          event.target.value
                        )
                      );

                      setCards([]);
                      setShowPreview(false);
                    }}
                  >
                    <option
                      value=""
                      disabled
                    >
                      Select Audit Batch
                    </option>

                    {batches.map(batch => (
                      <option
                        key={batch.id}
                        value={batch.id}
                      >
                        Batch {batch.id}
                        {" — "}
                        SLoc {batch.sloc}
                        {" — "}
                        {batch.area}
                      </option>
                    ))}
                  </select>

                  <div className="button-row">
                    <button
                      className="primary"
                      onClick={viewCards}
                      disabled={busy || !batchId}
                    >
                      View PIP Cards
                    </button>

                    <button
                      className="secondary"
                      onClick={() =>
                        printPipCards("filled")
                      }
                      disabled={busy || !batchId}
                    >
                      Print Filled Cards
                    </button>
                  </div>
                </section>

                <section className="panel">
                  <h3>
                    4. Additional Blank PIP Cards
                  </h3>

                  <p className="muted">
                    Unused rows will become VOID
                    once the Auditor submits
                    a blank card.
                  </p>

                  <div className="blank-card-controls">
                    <label>
                      Number of Blank Cards
                    </label>

                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={blankQuantity}
                      onChange={event =>
                        setBlankQuantity(
                          Number(
                            event.target.value
                          )
                        )
                      }
                    />
                  </div>

                  <div className="button-row">
                    <button
                      className="primary"
                      onClick={
                        generateBlankCards
                      }
                      disabled={busy || !batchId}
                    >
                      Generate Blank Cards
                    </button>

                    <button
                      className="secondary"
                      onClick={() =>
                        printPipCards("blank")
                      }
                      disabled={busy || !batchId}
                    >
                      Print Blank Cards
                    </button>
                  </div>
                </section>

                {showPreview && (
                  <section className="panel preview-panel">
                    <div className="preview-title-row">
                      <div>
                        <h3>
                          PIP Card Preview
                        </h3>

                        <p className="muted">
                          Submitted blank cards
                          show unused material
                          rows as VOID.
                        </p>
                      </div>

                      <strong className="total-cards">
                        {cards.length} Cards
                      </strong>
                    </div>

                    {cards.length ? (
                      <div className="pip-preview-list">
                        {cards.map(
                          (card, index) => (
                            <PipCardSheet
                              key={card.id}
                              card={card}
                              pageNumber={
                                index + 1
                              }
                              totalPages={
                                cards.length
                              }
                            />
                          )
                        )}
                      </div>
                    ) : (
                      <p>No cards found.</p>
                    )}
                  </section>
                )}
              </>
            )}

          {/* =====================================
              AUDITOR PORTAL
          ===================================== */}

          {!isManager && (
            <>
              <div className="page-heading">
                <h1>
                  Physical Count Data Entry
                </h1>

                <p>
                  Find a PIP card and submit
                  physical quantities from
                  the completed paper form.
                </p>
              </div>

              <section className="panel">
                <h3>Find PIP Card</h3>

                <form
                  className="search-form"
                  onSubmit={findCard}
                >
                  <input
                    value={cardSearch}
                    onChange={event =>
                      setCardSearch(
                        event.target.value
                      )
                    }
                    placeholder="Enter or scan PIP Card ID"
                    required
                  />

                  <button
                    className="primary"
                    type="submit"
                    disabled={busy}
                  >
                    Find Card
                  </button>
                </form>
              </section>

              {selectedCard && (
                <section className="panel">
                  <div className="entry-card-heading">
                    <div>
                      <h3>
                        {selectedCard.code}
                      </h3>

                      <p className="muted">
                        SLoc: {selectedCard.sloc}
                        {" | "}
                        PSA: {selectedCard.area}
                      </p>
                    </div>

                    <span
                      className={
                        selectedCard.submitted_at
                          ? "status-chip status-submitted"
                          : "status-chip status-pending"
                      }
                    >
                      {selectedCard.submitted_at
                        ? "Submitted"
                        : "Pending"}
                    </span>
                  </div>

                  <div className="table-scroll">
                    <table className="entry-table">
                      <thead>
                        <tr>
                          <th>No.</th>
                          <th>Material</th>
                          <th>Description</th>
                          <th>PSA</th>
                          <th>Bin</th>
                          <th>Physical Qty</th>
                        </tr>
                      </thead>

                      <tbody>
                        {selectedCard.lines.map(
                          line => {
                            const entry =
                              entries[line.id];

                            if (!entry) {
                              return null;
                            }

                            const isBlank =
                              selectedCard.kind ===
                              "blank";

                            const locked =
                              !!selectedCard.submitted_at;

                            if (
                              line.is_void === 1
                            ) {
                              return (
                                <tr
                                  key={line.id}
                                  className="pip-void-row"
                                >
                                  <td>
                                    {line.line_no}
                                  </td>

                                  <td colSpan={5}>
                                    VOID — UNUSED ROW
                                  </td>
                                </tr>
                              );
                            }

                            return (
                              <tr key={line.id}>
                                <td>
                                  {line.line_no}
                                </td>

                                {(
                                  [
                                    "material",
                                    "description"
                                  ] as const
                                ).map(field => (
                                  <td key={field}>
                                    {isBlank ? (
                                      <input
                                        value={
                                          entry[field]
                                        }
                                        disabled={
                                          locked
                                        }
                                        onChange={
                                          event =>
                                            updateEntry(
                                              line.id,
                                              field,
                                              event.target.value
                                            )
                                        }
                                        placeholder={
                                          field
                                        }
                                      />
                                    ) : (
                                      entry[field] ||
                                      "—"
                                    )}
                                  </td>
                                ))}

                                <td>
                                  {selectedCard.area}
                                </td>

                                <td>
                                  {isBlank ? (
                                    <input
                                      value={
                                        entry.bin
                                      }
                                      disabled={
                                        locked
                                      }
                                      onChange={
                                        event =>
                                          updateEntry(
                                            line.id,
                                            "bin",
                                            event.target.value
                                          )
                                      }
                                      placeholder="Bin"
                                    />
                                  ) : (
                                    entry.bin || "—"
                                  )}
                                </td>

                                <td>
                                  <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={
                                      entry.qty
                                    }
                                    disabled={
                                      locked
                                    }
                                    onChange={
                                      event =>
                                        updateEntry(
                                          line.id,
                                          "qty",
                                          event.target.value
                                        )
                                    }
                                    placeholder="Qty"
                                  />
                                </td>
                              </tr>
                            );
                          }
                        )}
                      </tbody>
                    </table>
                  </div>

                  {!selectedCard.submitted_at && (
                    <p className="muted">
                      On blank PIP cards, leave
                      every unused row completely
                      empty. Those rows will be
                      marked VOID upon submission.
                    </p>
                  )}

                  <div className="button-row">
                    {!selectedCard.submitted_at ? (
                      <button
                        className="primary"
                        onClick={
                          submitCounts
                        }
                        disabled={busy}
                      >
                        Submit PIP Card
                      </button>
                    ) : (
                      <p className="muted">
                        This PIP card has already
                        been submitted and cannot
                        be edited.
                      </p>
                    )}
                  </div>
                </section>
              )}
            </>
          )}

          {/* =====================================
              APPLICATION MESSAGES
          ===================================== */}

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          {message && (
            <div className="success-message">
              {message}
            </div>
          )}

        </div>
      </main>

      {/* =====================================
          MANAGER-ONLY PRINTING
      ===================================== */}

      {isManager && (
        <div className="print-only">
          {printCards.map(
            (card, index) => (
              <PipCardSheet
                key={card.id}
                card={card}
                pageNumber={index + 1}
                totalPages={printCards.length}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

export default App;
