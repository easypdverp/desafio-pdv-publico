package fiction.brisa27.replenishment;

import fiction.brisa27.common.BusinessException;
import fiction.brisa27.documents.DocumentService;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RequestService {
  private final RequestRepository repository;
  private final DocumentService documents;

  public RequestService(RequestRepository r, DocumentService d) {
    repository = r;
    documents = d;
  }

  public List<Map<String, Object>> needs(String store) {
    var rows =
        repository.jdbc().queryForList(
            "SELECT i.product_id,p.name product_name,i.stock,i.target FROM inventory i JOIN"
                + " products p ON p.id=i.product_id WHERE i.location_id=? AND i.target IS NOT NULL"
                + " ORDER BY product_id",
            store);
    if (rows.isEmpty()) throw new BusinessException(404, "Loja não encontrada");
    var result = new ArrayList<Map<String, Object>>();
    for (var row : rows) {
      int need =
          NeedCalculator.calculate(
              ((Number) row.get("stock")).intValue(), ((Number) row.get("target")).intValue());
      if (need > 0) {
        row.put("need", need);
        result.add(row);
      }
    }
    return result;
  }

  @Transactional
  public Map<String, Object> create(Inputs.Create input, String actor) {
    if (input == null || input.items() == null || input.items().isEmpty())
      throw new BusinessException(400, "Selecionar pelo menos um item");
    var available = needs(input.destination());
    var seen = new HashSet<String>();
    for (var item : input.items()) {
      if (item.requested() == null || item.requested() <= 0 || !seen.add(item.product_id()))
        throw new BusinessException(400, "Quantidade inválida ou produto repetido");
      var row =
          available.stream()
              .filter(r -> Objects.equals(r.get("product_id"), item.product_id()))
              .findFirst()
              .orElseThrow(
                  () -> new BusinessException(400, "Produto sem necessidade de reposição"));
      if (item.requested() > ((Number) row.get("need")).intValue())
        throw new BusinessException(400, "Quantidade acima da necessidade");
    }
    String id = UUID.randomUUID().toString();
    repository.jdbc().update(
        "INSERT INTO replenishment_requests(id,destination,origin,status,created_by) VALUES"
            + " (?,?,?,'OPEN',?)",
        id,
        input.destination(),
        "centro-horizonte",
        actor);
    for (var item : input.items())
      repository.jdbc().update(
          "INSERT INTO request_items(request_id,product_id,requested) VALUES (?,?,?)",
          id,
          item.product_id(),
          item.requested());
    return repository.detail(id);
  }

  @Transactional
  public Map<String, Object> confirm(String id, Inputs.Confirm input, String actor) {
    var request = repository.detail(id);
    var items = repository.items(id);
    if (input == null || input.items() == null || input.items().size() != items.size())
      throw new BusinessException(400, "Informar todos os itens");
    var received = new TreeMap<String, Integer>();
    for (var item : input.items()) {
      if (item.received() == null
          || item.received() < 0
          || received.put(item.product_id(), item.received()) != null)
        throw new BusinessException(400, "Recebimento inválido");
    }
    if (received.values().stream().mapToInt(Integer::intValue).sum() == 0)
      throw new BusinessException(400, "Entrega totalmente zerada");
    for (var item : items) {
      String product = (String) item.get("product_id");
      Integer amount = received.get(product);
      if (amount == null || amount > ((Number) item.get("requested")).intValue())
        throw new BusinessException(400, "Quantidade acima da solicitação");
      int stock =
          repository.jdbc().queryForObject(
              "SELECT stock FROM inventory WHERE location_id=? AND product_id=? FOR UPDATE",
              Integer.class,
              request.get("origin"),
              product);
      if (stock < amount) throw new BusinessException(400, "Saldo insuficiente no centro");
    }
    for (var item : items) {
      String product = (String) item.get("product_id");
      int amount = received.get(product);
      repository.jdbc().update(
          "UPDATE inventory SET stock=stock-? WHERE location_id=? AND product_id=?",
          amount,
          request.get("origin"),
          product);
      repository.jdbc().update(
          "UPDATE inventory SET stock=stock+? WHERE location_id=? AND product_id=?",
          amount,
          request.get("destination"),
          product);
      repository.jdbc().update(
          "UPDATE request_items SET requested=?,received=? WHERE request_id=? AND product_id=?",
          amount,
          amount,
          id,
          product);
    }
    repository.jdbc().update(
        "UPDATE replenishment_requests SET"
            + " status='CONFIRMED',confirmed_by=?,confirmed_at=CURRENT_TIMESTAMP WHERE id=?",
        actor,
        id);
    documents.process(id);
    return repository.detail(id);
  }
}
