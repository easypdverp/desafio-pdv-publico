export type Row = {
  location_id: string;
  product_id: string;
  product_name: string;
  location_name: string;
  stock: number;
  target: number | null;
  need: number;
};
export type Item = {
  product_id: string;
  product_name: string;
  requested: number;
  received: number | null;
  missing: number;
};
export type RequestData = {
  id: string;
  status: string;
  destination: string;
  origin: string;
  created_by: string;
  confirmed_by: string | null;
  items: Item[];
  document_status?: string;
};
export type DocumentData = {
  status: string;
  reason?: string;
  protocol?: string;
  attempts?: number;
};
export async function call<T>(
  path: string,
  token: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const r = await fetch("/admin" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const envelope = await r.json();
  if (!r.ok || !envelope.success)
    throw new Error(envelope.message || "Falha na requisição");
  return envelope.data as T;
}
