package fiction.brisa27.documents;

import fiction.brisa27.common.BusinessException;
import fiction.brisa27.replenishment.RequestRepository;
import java.net.URI;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import software.amazon.awssdk.auth.credentials.*;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;

@Service
public class DocumentService {
  private final RequestRepository repository;
  private final RestClient fiscal;
  private final S3Client s3;
  private final String bucket;

  public DocumentService(
      RequestRepository r,
      @Value("${lab.fiscal-url}") String url,
      @Value("${lab.s3-endpoint}") String endpoint,
      @Value("${lab.s3-user}") String user,
      @Value("${lab.s3-password}") String password,
      @Value("${lab.s3-bucket}") String bucket) {
    repository = r;
    fiscal = RestClient.builder().baseUrl(url).build();
    this.bucket = bucket;
    s3 =
        S3Client.builder()
            .endpointOverride(URI.create(endpoint))
            .region(Region.US_EAST_1)
            .forcePathStyle(true)
            .credentialsProvider(
                StaticCredentialsProvider.create(AwsBasicCredentials.create(user, password)))
            .build();
  }

  @jakarta.annotation.PostConstruct
  public void prepareBucket() {
    for (int attempt = 0; attempt < 40; attempt++) {
      try {
        s3.headBucket(b -> b.bucket(bucket));
        return;
      } catch (software.amazon.awssdk.services.s3.model.S3Exception e) {
        if (e.statusCode() == 404) {
          s3.createBucket(b -> b.bucket(bucket));
          return;
        }
      } catch (Exception e) {
      }
      try {
        Thread.sleep(250);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new IllegalStateException(e);
      }
    }
    throw new IllegalStateException("Armazenamento local indisponível no bootstrap");
  }

  public void process(String id) {
    String key = "doc-" + id;
    repository.jdbc().update(
        "INSERT INTO documents(request_id,document_key,status,attempts) VALUES (?,?,'PROCESSING',1)"
            + " ON DUPLICATE KEY UPDATE status='PROCESSING',attempts=attempts+1",
        id,
        key);
    try {
      var request = repository.detail(id);
      var items =
          repository.items(id).stream()
              .map(i -> Map.of("product_id", i.get("product_id"), "quantity", i.get("received")))
              .toList();
      Map<?, ?> response =
          fiscal
              .post()
              .uri("/documents")
              .body(
                  Map.of(
                      "document_key",
                      key,
                      "delivery_id",
                      id,
                      "origin_id",
                      request.get("origin"),
                      "destination_id",
                      request.get("destination"),
                      "items",
                      items))
              .retrieve()
              .body(Map.class);
      if ("REJECTED_SIMULATION".equals(response.get("status"))) {
        repository.jdbc().update(
            "UPDATE documents SET status='REJECTED_SIMULATION',reason=? WHERE request_id=?",
            response.get("reason"),
            id);
        return;
      }
      byte[] xml = fiscal.get().uri("/documents/{key}/xml", key).retrieve().body(byte[].class);
      String objectKey = key + ".xml";
      s3.putObject(
          b -> b.bucket(bucket).key(objectKey).contentType("application/xml"),
          RequestBody.fromBytes(xml));
      repository.jdbc().update(
          "UPDATE documents SET status='AUTHORIZED_SIMULATION',protocol=?,object_key=?,reason=NULL"
              + " WHERE request_id=?",
          response.get("protocol"),
          objectKey,
          id);
    } catch (Exception e) {
      repository.jdbc().update(
          "UPDATE documents SET status='FAILED',reason=? WHERE request_id=?",
          "Falha na integração documental: " + e.getClass().getSimpleName(),
          id);
    }
  }

  public byte[] xml(String id) {
    var document = repository.document(id);
    String key = (String) document.get("object_key");
    if (key == null) throw new BusinessException(409, "XML ainda não disponível");
    return s3.getObjectAsBytes(b -> b.bucket(bucket).key(key)).asByteArray();
  }

  public Object mode(String mode) {
    if (!Set.of("sucesso", "rejeicao", "indisponivel", "resposta-perdida").contains(mode))
      throw new BusinessException(400, "Modo desconhecido");
    return fiscal.put().uri("/admin/mode").body(Map.of("mode", mode)).retrieve().body(Map.class);
  }
}
