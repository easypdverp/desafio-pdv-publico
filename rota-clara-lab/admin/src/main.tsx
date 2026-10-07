import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { call, Row, Item, RequestData, DocumentData } from "./api";
import "./style.css";
function App() {
  const [token, setToken] = useState("gestor-local"),
    [store, setStore] = useState("loja-aurora");
  const [inventory, setInventory] = useState<Row[]>([]),
    [needs, setNeeds] = useState<Row[]>([]),
    [requests, setRequests] = useState<RequestData[]>([]);
  const [detail, setDetail] = useState<RequestData | null>(null),
    [doc, setDoc] = useState<DocumentData | null>(null),
    [received, setReceived] = useState<Record<string, number>>({});
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState("sucesso");
  async function refresh() {
    const [a, b, c] = await Promise.all([
      call<Row[]>("/inventory", token),
      call<Row[]>("/needs?store=" + store, token),
      call<RequestData[]>("/requests", token),
    ]);
    setInventory(a);
    setNeeds(b);
    setRequests(c);
  }
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      call<Row[]>("/inventory", token),
      call<Row[]>("/needs?store=" + store, token),
      call<RequestData[]>("/requests", token),
    ])
      .then(([a, b, c]) => {
        if (!cancelled) {
          setInventory(a);
          setNeeds(b);
          setRequests(c);
        }
      })
      .catch((e) => {
        if (!cancelled) setMessage(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [token, store]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string) {
    const [r, d] = await Promise.all([
      call<RequestData>("/requests/" + id, token),
      call<DocumentData>("/requests/" + id + "/document", token),
    ]);
    setDetail(r);
    setDoc(d);
    setReceived(
      Object.fromEntries(
        r.items.map((i) => [i.product_id, i.received ?? i.requested]),
      ),
    );
  }
  async function create() {
    const r = await call<RequestData>("/requests", token, "POST", {
      destination: store,
      items: needs.map((i) => ({
        product_id: i.product_id,
        requested: i.need,
      })),
    });
    await refresh();
    await open(r.id);
    setMessage("Solicitação criada.");
  }
  async function confirm() {
    if (!detail) return;
    await call("/requests/" + detail.id + "/confirm", token, "POST", {
      items: detail.items.map((i) => ({
        product_id: i.product_id,
        received: received[i.product_id],
      })),
    });
    await refresh();
    await open(detail.id);
    setMessage("Entrega confirmada.");
  }
  async function download() {
    if (!detail) return;
    const r = await fetch("/admin/requests/" + detail.id + "/document/xml", {
      headers: { Authorization: "Bearer " + token },
    });
    if (!r.ok || r.headers.get("content-type")?.includes("json"))
      throw new Error("XML indisponível");
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = detail.id + ".xml";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <header>
        <div className="brand">RC</div>
        <div>
          <strong>Rota Clara</strong>
          <small>Rede Brisa 27 · laboratório local</small>
        </div>
        <label className="profile">
          Perfil
          <select value={token} onChange={(e) => setToken(e.target.value)}>
            <option value="gestor-local">Gestor</option>
            <option value="operador-local">Operador</option>
          </select>
        </label>
      </header>
      <main>
        <div className="heading">
          <div>
            <span className="eyebrow">OPERAÇÃO DE LOJAS</span>
            <h1>Reposição e transferências</h1>
            <p>
              Consulte o estoque, solicite mercadorias e confira o recebido.
            </p>
          </div>
          <button onClick={() => run(refresh)} disabled={busy}>
            Atualizar
          </button>
        </div>
        {message && (
          <div role="status" className="message">
            {message}
          </div>
        )}
        <section>
          <div className="section-head">
            <h2>Necessidade de reposição</h2>
            <label>
              Loja
              <select value={store} onChange={(e) => setStore(e.target.value)}>
                <option value="loja-aurora">Loja Aurora</option>
                <option value="loja-lagoa">Loja Lagoa</option>
              </select>
            </label>
          </div>
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Saldo</th>
                <th>Meta</th>
                <th>Necessidade</th>
              </tr>
            </thead>
            <tbody>
              {needs.map((i) => (
                <tr key={i.product_id}>
                  <td>{i.product_name}</td>
                  <td>{i.stock}</td>
                  <td>{i.target}</td>
                  <td>
                    <strong>{i.need}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {needs.length === 0 && <p>Nenhum item para repor.</p>}
          <button
            className="primary"
            disabled={busy || !needs.length || token !== "gestor-local"}
            onClick={() => run(create)}
          >
            Criar solicitação com estes itens
          </button>
        </section>
        <div className="grid">
          <section>
            <h2>Solicitações</h2>
            {requests.length === 0 ? (
              <p>Ainda não há solicitações.</p>
            ) : (
              requests.map((r) => (
                <button
                  className="request-row"
                  key={r.id}
                  onClick={() => run(() => open(r.id))}
                >
                  <span>
                    <strong>
                      {r.destination === "loja-aurora"
                        ? "Loja Aurora"
                        : "Loja Lagoa"}
                    </strong>
                    <small>{r.id.slice(0, 8)}</small>
                  </span>
                  <span className="badge">{r.status}</span>
                </button>
              ))
            )}
          </section>
          <section>
            <h2>Conferência da entrega</h2>
            {!detail ? (
              <p>Selecione uma solicitação ao lado.</p>
            ) : (
              <>
                <p className="mono">{detail.id}</p>
                <table>
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Solicitado</th>
                      <th>Recebido</th>
                      <th>Falta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((i: Item) => (
                      <tr key={i.product_id}>
                        <td>{i.product_name}</td>
                        <td>{i.requested}</td>
                        <td>
                          <input
                            aria-label={"Recebido " + i.product_name}
                            type="number"
                            min="0"
                            value={received[i.product_id] ?? 0}
                            onChange={(e) =>
                              setReceived({
                                ...received,
                                [i.product_id]: Number(e.target.value),
                              })
                            }
                          />
                        </td>
                        <td>{i.missing}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  className="primary"
                  disabled={busy || token !== "operador-local"}
                  onClick={() => run(confirm)}
                >
                  Confirmar entrega
                </button>
                <p>
                  Estado: <strong>{detail.status}</strong> · autor:{" "}
                  {detail.confirmed_by ?? "—"}
                </p>
                <div className="document">
                  <h3>Documento da transferência</h3>
                  <p>{doc?.status ?? "—"}</p>
                  {doc?.reason && <p>{doc.reason}</p>}
                  <small>Tentativas: {doc?.attempts ?? 0}</small>
                  <button
                    disabled={busy || doc?.status !== "AUTHORIZED_SIMULATION"}
                    onClick={() => run(download)}
                  >
                    Baixar XML demonstrativo
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
        <section>
          <h2>Estoque por local</h2>
          <table>
            <thead>
              <tr>
                <th>Local</th>
                <th>Produto</th>
                <th>Saldo</th>
                <th>Meta</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((i) => (
                <tr key={i.location_id + i.product_id}>
                  <td>{i.location_name}</td>
                  <td>{i.product_name}</td>
                  <td>{i.stock}</td>
                  <td>{i.target ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h2>Controles do laboratório</h2>
          <p>
            O provedor documental é fictício. Nenhum arquivo tem validade
            fiscal.
          </p>
          <label>
            Cenário fiscal
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="sucesso">Sucesso</option>
              <option value="rejeicao">Rejeição</option>
              <option value="indisponivel">Indisponível</option>
              <option value="resposta-perdida">Resposta perdida</option>
            </select>
          </label>
          <button
            disabled={busy || token !== "gestor-local"}
            onClick={() =>
              run(async () => {
                await call("/lab/fiscal-mode", token, "PUT", { mode });
                setMessage("Cenário fiscal configurado.");
              })
            }
          >
            Aplicar cenário
          </button>
        </section>
      </main>
      <footer>Ambiente sintético · Rota Clara 1.0</footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
