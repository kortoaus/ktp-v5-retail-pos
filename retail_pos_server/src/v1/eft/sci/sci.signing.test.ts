import assert from "node:assert/strict";
import test from "node:test";
import { contentDigest, signRequest, verifyRequest } from "./sci.signing";

// Fixed vectors computed independently with openssl (printf | openssl dgst
// -sha256 -hmac <part A + part B> -binary | base64), so a signing regression is
// caught without a tenant (S-3 §5).
const SECRET = "partA-fixed-vector" + "partB-fixed-vector";
const CREATED = 1761609600;
const KEY_ID = "key_test_01";
const BODY = '{"purchase_details":{"purchase_amount":1000},"print_merchant_receipt":true}';

test("signing vector: POST with body, port kept in @authority, query in @request-target", () => {
  const h = signRequest({
    method: "POST",
    url: "https://sci-api.example.test:8443/v1/transactions?x=1",
    body: BODY,
    keyId: KEY_ID,
    secret: SECRET,
    created: CREATED,
  });
  assert.equal(h["Content-Digest"], "sha-256=:WHFMzbIsGhuj7G6m16BIlgWir0sWWL0W4UfX3GTP/2g=:");
  assert.equal(
    h["Signature-Input"],
    'sig1=("@method" "@authority" "@request-target" "content-digest");created=1761609600;alg="hmac-sha256";keyid="key_test_01"',
  );
  assert.equal(h.Signature, "sig1=:2sZNynNEjo3nfx5G3iFJMiih8PUBz6kNpNdlCrIXs+w=:");
});

test("signing vector: GET omits content-digest; default port is not in @authority", () => {
  const h = signRequest({
    method: "GET",
    url: "https://sci-api.example.test:443/v1/transactions/txn_1?min_version=3",
    body: null,
    keyId: KEY_ID,
    secret: SECRET,
    created: CREATED,
  });
  assert.equal(h["Content-Digest"], undefined);
  assert.equal(h["Signature-Input"], 'sig1=("@method" "@authority" "@request-target");created=1761609600;alg="hmac-sha256";keyid="key_test_01"');
  assert.equal(h.Signature, "sig1=:QFSQrkDwCutmq8P3+/yPVB6Pof4T+w/TWNt/CTgNTug=:");
});

test("verifyRequest accepts our own signature and rejects tampering, wrong secret and skew", () => {
  const url = "http://127.0.0.1:7400/v1/transactions";
  const h = signRequest({ method: "POST", url, body: BODY, keyId: KEY_ID, secret: SECRET, created: CREATED });
  const base = {
    method: "POST",
    authority: "127.0.0.1:7400",
    requestTarget: "/v1/transactions",
    body: BODY,
    signatureInput: h["Signature-Input"],
    signature: h.Signature,
    contentDigestHeader: h["Content-Digest"],
    secretFor: (k: string) => (k === KEY_ID ? SECRET : null),
    nowSeconds: CREATED + 10,
  };
  assert.deepEqual(verifyRequest(base), { ok: true, keyId: KEY_ID });
  assert.equal(verifyRequest({ ...base, body: BODY.replace("1000", "1001") }).ok, false);
  assert.equal(verifyRequest({ ...base, contentDigestHeader: contentDigest(BODY + "\n") }).ok, false);
  assert.equal(verifyRequest({ ...base, secretFor: () => "wrong" }).ok, false);
  assert.equal(verifyRequest({ ...base, authority: "127.0.0.1" }).ok, false);
  assert.equal(verifyRequest({ ...base, nowSeconds: CREATED + 301 }).ok, false);
});
