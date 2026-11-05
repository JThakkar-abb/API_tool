
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import JsBarcode from "jsbarcode";
import "./App.css";

/* ======================================
   TYPES
====================================== */

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
  sap_qty?: number | null;
  entered_by?: string | null;
};

type PipCard = {
  id: number;
  code: string;
  kind: "filled" | "blank";
  sloc: string;
  area: string;
  area_id?: number | null;
  lines: MaterialLine[];
};

type CountEntry = {
  material: string;
  description: string;
  bin: string;
  qty: string;
};

const STORAGE_LOCATIONS = [
  "1000",
  "2000",
  "3000",
  "5000"
];

/* ======================================
   API HELPER
====================================== */

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

/* ======================================
   REAL CODE 128 BARCODE
====================================== */

function PipBarcode({ value }: { value: string }) {
  const barcodeRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!barcodeRef.current) return;

    JsBarcode(barcodeRef.current, value, {
      format: "CODE128",
      width: 1.15,
      height: 38,
      margin: 4,
      displayValue: false,
      lineColor: "#000000",
      background: "#ffffff"
    });
  }, [value]);

  return (
    <svg
      ref={barcodeRef}
      className="pip-barcode"
      role="img"
      aria-label={`Barcode for ${value}`}
    />
  );
}

/* ======================================
   PIP CARD COMPONENT
   Used for preview and printing
====================================== */

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

  return (
    <article className="pip-sheet">

      {/* HEADER */}

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

          {/* Actual scannable barcode */}
          <PipBarcode value={card.code} />

          <small>
            Page {pageNumber} of {totalPages}
          </small>
        </div>
      </div>

      {/* CARD INFORMATION */}

      <div className="pip-sheet-information">
        <div>
          <strong>Storage Location:</strong>{" "}
          {card.sloc}
        </div>

        <div>
          <strong>Production Supply Area:</strong>{" "}
          {card.area}
        </div>

        <div>
          <strong>Count Date:</strong>{" "}
          __________________
        </div>

        <div>
          <strong>Counted By:</strong>{" "}
          __________________
        </div>
      </div>

      {/* SIX-COLUMN TABLE */}

      <table className="pip-sheet-table">
        <colgroup>
          <col style={{ width: "5%" }} />
          <col style={{ width: "19%" }} />
          <col style={{ width: "26%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "17%" }} />
        </colgroup>

        <thead>
          <tr>
            <th>No.</th>
            <th>Material Number</th>
            <th>Material Description</th>
            <th>PSA</th>
            <th>Storage Bin</th>
            <th>Physical Count</th>
          </tr>
        </thead>

        <tbody>
          {Array.from({ length: 10 }, (_, index) => {
            const line = card.lines[index];

            return (
              <tr key={index}>
                <td>{index + 1}</td>

                <td>
                  {isBlank
                    ? ""
                    : line?.material ?? ""}
                </td>

                <td>
                  {isBlank
                    ? ""
                    : line?.description ?? ""}
                </td>

                <td>
                  {isBlank || !line
                    ? ""
                    : card.area}
                </td>

                <td>
                  {isBlank
                    ? ""
                    : line?.bin ?? ""}
                </td>

                {/* Always blank for floor counting */}
                <td className="count-space"></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* AUDITOR AND LEADER SIGNATURES */}

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

      {/* REMARKS */}

      <div className="pip-remarks">
        <strong>Remarks:</strong>
        <span>
          ____________________________________________
        </span>
      </div>

      {/* FOOTER */}

      <div className="pip-sheet-bottom">
        <span>ABB | INTERNAL INVENTORY CONTROL</span>
        <span>{card.code}</span>
      </div>
    </article>
  );
}

/* ======================================
   MAIN APPLICATION
====================================== */

function App() {
  const [user, setUser] = useState<User | null>(null);

  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [sloc, setSloc] = useState("1000");

  const [productionAreas, setProductionAreas] =
    useState<ProductionArea[]>([]);

  const [selectedAreaId, setSelectedAreaId] =
    useState("");

  const [areasLoading, setAreasLoading] =
    useState(false);

  const [file, setFile] = useState<File | null>(null);

  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatchId] =
    useState<number | null>(null);

  const [cards, setCards] = useState<PipCard[]>([]);
  const [showPreview, setShowPreview] =
    useState(false);

  const [printCards, setPrintCards] =
    useState<PipCard[]>([]);

  const [blankQuantity, setBlankQuantity] =
    useState(5);

  const [cardSearch, setCardSearch] = useState("");

  const [selectedCard, setSelectedCard] =
    useState<PipCard | null>(null);

  const [entries, setEntries] =
    useState<Record<number, CountEntry>>({});

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const isManager = user?.role === "manager";

  const selectedArea = productionAreas.find(
    area => String(area.id) === selectedAreaId
  );

  /* ==================================
     INITIAL SESSION CHECK
  ================================== */

  useEffect(() => {
    api("/me")
      .then(data => setUser(data))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  /* ==================================
     LOAD MANAGER DATA
  ================================== */

  useEffect(() => {
    if (user?.role !== "manager") return;

    loadBatches();

    setAreasLoading(true);

    api("/production-areas")
      .then((data: ProductionArea[]) => {
        setProductionAreas(data);
      })
      .catch(err => {
        setError(err.message);
      })
      .finally(() => setAreasLoading(false));
  }, [user]);

  async function loadBatches() {
    try {
      const data: Batch[] = await api("/batches");

      setBatches(data);

      setBatchId(previous => {
        if (
          previous !== null &&
          data.some(batch => batch.id === previous)
        ) {
          return previous;
        }

        return data.length ? data[0].id : null;
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  /* ==================================
     LOGIN
  ================================== */

  async function login(event: FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result: User = await api("/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          username,
          password
        })
      });

      setUser(result);
      setPassword("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /* ==================================
     LOGOUT
  ================================== */

  async function logout() {
    try {
      await api("/logout", {
        method: "POST"
      });
    } catch {
      setError("Logout request failed");
      return;
    }

    setUser(null);
    setProductionAreas([]);
    setSelectedAreaId("");
    setBatches([]);
    setBatchId(null);
    setCards([]);
    setShowPreview(false);
    setPrintCards([]);
    setSelectedCard(null);
    setEntries({});
    setError("");
    setMessage("");
  }

  /* ==================================
     MANAGER: UPLOAD EXCEL
  ================================== */

  async function uploadExcel() {
    if (!selectedAreaId) {
      setError("Select a Production Supply Area.");
      return;
    }

    if (!file) {
      setError("Select an Excel file.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const buffer = await file.arrayBuffer();

      const result = await api("/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
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

      setMessage(
        `${result.materials} materials imported for ` +
        `${result.area}. ` +
        `${result.cards} PIP cards generated.`
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /* ==================================
     MANAGER: FETCH CARDS
  ================================== */

  async function fetchCards(): Promise<PipCard[]> {
    if (!batchId) {
      throw new Error("Select an audit batch.");
    }

    return await api(`/batches/${batchId}/cards`);
  }

  /* ==================================
     MANAGER: VIEW CARDS
  ================================== */

  async function viewCards() {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await fetchCards();

      setCards(result);
      setShowPreview(true);

      if (!result.length) {
        setMessage("No cards found for this batch.");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /* ==================================
     MANAGER: GENERATE BLANK CARDS
  ================================== */

  async function generateBlankCards() {
    if (!batchId) {
      setError("Select an audit batch.");
      return;
    }

    if (
      !Number.isInteger(blankQuantity) ||
      blankQuantity < 1 ||
      blankQuantity > 100
    ) {
      setError("Choose 1 to 100 blank cards.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await api("/blank-cards", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          batchId,
          quantity: blankQuantity
        })
      });

      const updated = await fetchCards();

      setCards(updated);
      setShowPreview(true);

      setMessage(
        `${result.generated.length} blank cards created.`
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /* ==================================
     MANAGER: PRINT CARDS
  ================================== */

  async function printPipCards(
    kind: "filled" | "blank"
  ) {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const allCards = await fetchCards();

      const selected = allCards.filter(
        card => card.kind === kind
      );

      if (!selected.length) {
        setError(
          kind === "blank"
            ? "Generate blank cards first."
            : "No filled cards found."
        );
        return;
      }

      setPrintCards(selected);

      // Let React render the barcode SVG before print.
      window.setTimeout(() => {
        window.print();
      }, 500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /* ==================================
     AUDITOR: FIND PIP CARD
  ================================== */

  async function findCard(event: FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const code = cardSearch.trim().toUpperCase();

      const card: PipCard = await api(
        `/cards/${encodeURIComponent(code)}`
      );

      setSelectedCard(card);

      const initial: Record<number, CountEntry> = {};

      for (const line of card.lines) {
        initial[line.id] = {
          material: line.material || "",
          description: line.description || "",
          bin: line.bin || "",
          qty: line.physical_qty === null
            ? ""
            : String(line.physical_qty)
        };
      }

      setEntries(initial);
    } catch (err) {
      setSelectedCard(null);
      setError((err as Error).message);
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

  /* ==================================
     AUDITOR: SAVE PHYSICAL COUNTS
  ================================== */

  async function saveCounts() {
    if (!selectedCard) return;

    const submitted = selectedCard.lines.map(line => {
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

    const invalid = submitted.some(item => {
      const emptyBlankRow =
        selectedCard.kind === "blank" &&
        !item.material.trim() &&
        !item.description.trim() &&
        !item.bin.trim() &&
        item.qty === null;

      if (emptyBlankRow) return false;

      if (
        selectedCard.kind === "blank" &&
        !item.material.trim()
      ) {
        return true;
      }

      return (
        item.qty === null ||
        !Number.isSafeInteger(item.qty) ||
        item.qty < 0
      );
    });

    if (invalid) {
      setError(
        "Enter a valid whole-number count for each " +
        "material. Use 0 when the physical count is zero."
      );
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await api(
        `/cards/${encodeURIComponent(selectedCard.code)}/counts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            lines: submitted
          })
        }
      );

      setMessage(
        `Counts saved for ${selectedCard.code}`
      );

      setSelectedCard(null);
      setCardSearch("");
      setEntries({});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /* ==================================
     LOADING
  ================================== */

  if (checking) {
    return (
      <div className="loading-screen">
        Loading ABB Warehouse Audit...
      </div>
    );
  }

  /* ==================================
     LOGIN SCREEN
  ================================== */

  if (!user) {
    return (
      <main className="login-screen">
        <form className="login-box" onSubmit={login}>
          <img
            src="/OIP.webp"
            alt="ABB Logo"
            className="login-logo"
          />

          <h1>Warehouse Inventory Audit</h1>

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
            <p className="error">{error}</p>
          )}

          <button
            type="submit"
            className="primary"
            disabled={busy}
          >
            {busy ? "Signing in..." : "Sign In"}
          </button>

          <small>
            Authorized warehouse personnel only
          </small>
        </form>
      </main>
    );
  }

  /* ==================================
     MAIN DASHBOARD
  ================================== */

  return (
    <div className="app-shell">

      {/* SIDEBAR */}

      <aside className="sidebar">
        <div className="sidebar-brand">
          <img
            src="/OIP.webp"
            alt="ABB Logo"
          />

          <h2>Warehouse Audit</h2>
          <p>Inventory Control System</p>
        </div>

        <div className="sidebar-navigation">
          <div className="sidebar-active">
            {isManager
              ? "PIP Card Management"
              : "Physical Count Entry"}
          </div>
        </div>

        <button
          className="logout-button"
          onClick={logout}
        >
          Sign Out
        </button>
      </aside>

      {/* MAIN WORKSPACE */}

      <main className="main-workspace">

        <header className="topbar">
          <div>
            <h2>ABB Warehouse Inventory Audit</h2>
            <p>Annual Physical Inventory</p>
          </div>

          <div className="user-information">
            <strong>{user.username}</strong>
            <span>{user.role.toUpperCase()}</span>
          </div>
        </header>

        <div className="page-content">

          {isManager ? (
            <>

              {/* MANAGER PORTAL */}

              <div className="page-heading">
                <h1>PIP Card Management</h1>

                <p>
                  Select a Storage Location and Production
                  Supply Area to generate physical count cards.
                </p>
              </div>

              {/* SELECT LOCATION */}

              <section className="panel">
                <h3>1. Select Storage Location</h3>

                <div className="location-grid">
                  {STORAGE_LOCATIONS.map(location => (
                    <button
                      type="button"
                      key={location}
                      className={
                        sloc === location
                          ? "location-button selected"
                          : "location-button"
                      }
                      onClick={() => setSloc(location)}
                    >
                      {location}
                    </button>
                  ))}
                </div>

                {/* SQL SERVER PSA DROPDOWN */}

                <div className="production-area-select">
                  <label htmlFor="productionArea">
                    Production Supply Area
                  </label>

                  <select
                    id="productionArea"
                    value={selectedAreaId}
                    onChange={event =>
                      setSelectedAreaId(event.target.value)
                    }
                    disabled={areasLoading}
                  >
                    <option value="">
                      {areasLoading
                        ? "Loading Production Supply Areas..."
                        : "-- Select Production Supply Area --"}
                    </option>

                    {productionAreas.map(area => (
                      <option
                        key={area.id}
                        value={String(area.id)}
                      >
                        {area.strName}
                      </option>
                    ))}
                  </select>

                  {selectedArea && (
                    <p className="muted">
                      Selected: {selectedArea.strName}
                    </p>
                  )}
                </div>

                {/* EXCEL UPLOAD */}

                <h3>2. Upload Excel Material List</h3>

                <p className="muted">
                  Every 10 material rows will create one
                  numbered PIP card.
                </p>

                <input
                  className="file-input"
                  type="file"
                  accept=".xlsx"
                  onChange={event =>
                    setFile(
                      event.target.files?.[0] || null
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
                    Upload Excel & Generate PIP Cards
                  </button>
                </div>
              </section>

              {/* SELECT BATCH */}

              <section className="panel">
                <h3>3. Select Audit Batch</h3>

                <p className="muted">
                  Select a saved audit batch to view and
                  print its PIP cards.
                </p>

                <select
                  className="batch-select"
                  value={batchId ?? ""}
                  onChange={event => {
                    setBatchId(
                      Number(event.target.value)
                    );
                    setCards([]);
                    setShowPreview(false);
                  }}
                >
                  <option value="" disabled>
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

              {/* BLANK CARDS */}

              <section className="panel">
                <h3>4. Additional Blank PIP Cards</h3>

                <p className="muted">
                  Use blank cards for materials not
                  listed in the uploaded Excel file.
                </p>

                <div className="blank-card-controls">
                  <label>Number of Blank Cards</label>

                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={blankQuantity}
                    onChange={event =>
                      setBlankQuantity(
                        Number(event.target.value)
                      )
                    }
                  />
                </div>

                <div className="button-row">
                  <button
                    className="primary"
                    onClick={generateBlankCards}
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

              {/* PIP CARD PREVIEW */}

              {showPreview && (
                <section className="panel preview-panel">

                  <div className="preview-title-row">
                    <div>
                      <h3>PIP Card Preview</h3>

                      <p className="muted">
                        ABB-branded inventory cards
                        with barcodes, PSA column,
                        and Auditor / Leader signatures.
                      </p>
                    </div>

                    <strong className="total-cards">
                      {cards.length} Cards
                    </strong>
                  </div>

                  {cards.length ? (
                    <div className="pip-preview-list">
                      {cards.map((card, index) => (
                        <PipCardSheet
                          key={card.id}
                          card={card}
                          pageNumber={index + 1}
                          totalPages={cards.length}
                        />
                      ))}
                    </div>
                  ) : (
                    <p>No cards found.</p>
                  )}
                </section>
              )}
            </>
          ) : (
            <>

              {/* AUDITOR PORTAL */}

              <div className="page-heading">
                <h1>Physical Count Data Entry</h1>

                <p>
                  Enter quantities from completed
                  paper PIP cards.
                </p>
              </div>

              {/* CARD SEARCH */}

              <section className="panel">
                <h3>Find PIP Card</h3>

                <form
                  className="search-form"
                  onSubmit={findCard}
                >
                  <input
                    value={cardSearch}
                    onChange={event =>
                      setCardSearch(event.target.value)
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

              {/* COUNT ENTRY */}

              {selectedCard && (
                <section className="panel">

                  <div className="entry-card-heading">
                    <div>
                      <h3>{selectedCard.code}</h3>

                      <p className="muted">
                        SLoc: {selectedCard.sloc}
                        {" | "}
                        PSA: {selectedCard.area}
                      </p>
                    </div>

                    <span className="card-type">
                      {selectedCard.kind === "blank"
                        ? "Blank Card"
                        : "Material Card"}
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
                        {selectedCard.lines.map(line => {
                          const entry = entries[line.id];

                          if (!entry) return null;

                          const isBlank =
                            selectedCard.kind === "blank";

                          return (
                            <tr key={line.id}>

                              <td>{line.line_no}</td>

                              {(
                                [
                                  "material",
                                  "description"
                                ] as const
                              ).map(field => (
                                <td key={field}>
                                  {isBlank ? (
                                    <input
                                      value={entry[field]}
                                      onChange={event =>
                                        updateEntry(
                                          line.id,
                                          field,
                                          event.target.value
                                        )
                                      }
                                      placeholder={field}
                                    />
                                  ) : (
                                    entry[field] || "—"
                                  )}
                                </td>
                              ))}

                              <td>
                                {selectedCard.area}
                              </td>

                              <td>
                                {isBlank ? (
                                  <input
                                    value={entry.bin}
                                    onChange={event =>
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
                                  value={entry.qty}
                                  onChange={event =>
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
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="button-row">
                    <button
                      className="primary"
                      onClick={saveCounts}
                      disabled={busy}
                    >
                      Save Physical Counts
                    </button>
                  </div>
                </section>
              )}
            </>
          )}

          {/* MESSAGES */}

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

      {/* PRINTING — MANAGER ONLY */}

      {isManager && (
        <div className="print-only">
          {printCards.map((card, index) => (
            <PipCardSheet
              key={card.id}
              card={card}
              pageNumber={index + 1}
              totalPages={printCards.length}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
