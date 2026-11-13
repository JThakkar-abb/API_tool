type JsonRecord = Record<string, unknown>;

async function api<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${endpoint}`, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error((data as { message?: string }).message || "Request failed");
  }

  return data as T;
}

export async function fetchSqlAreas(location?: number) {
  const query = location !== undefined ? `?location=${encodeURIComponent(location)}` : "";
  return api<JsonRecord[]>(`/sql/areas${query}`);
}

export async function fetchSqlParts(area?: string) {
  const query = area ? `?area=${encodeURIComponent(area)}` : "";
  return api<JsonRecord[]>(`/sql/parts${query}`);
}

export async function fetchSqlPipCards(pipId?: string) {
  const query = pipId ? `?pipId=${encodeURIComponent(pipId)}` : "";
  return api<JsonRecord[]>(`/sql/pip-cards${query}`);
}

export async function fetchSqlOrder(orderNum: string) {
  return api<JsonRecord[]>(`/sql/order?orderNum=${encodeURIComponent(orderNum)}`);
}

export async function fetchSqlUsers() {
  return api<JsonRecord[]>("/sql/users");
}

export async function fetchSqlTable(table: string, schema = "INV", top = 100) {
  return api<JsonRecord[]>(`/sql/table?schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(table)}&top=${encodeURIComponent(String(top))}`);
}

export async function executeSqlReadOnly(query: string, params: JsonRecord = {}) {
  return api<JsonRecord[]>("/sql/query", {
    method: "POST",
    body: JSON.stringify({ sqlText: query, params })
  });
}
