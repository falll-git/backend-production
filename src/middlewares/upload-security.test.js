const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const express = require("express");

const {
  uploadDomainFile,
} = require("./domain-upload.middleware");
const {
  UPLOAD_TEMP_DIR,
  attachUploadTempCleanup,
} = require("../utils/upload-temp-files");
const {
  createDebtorDocumentSchema,
} = require("../modules/debtors/debtors.validation");
const {
  createMarketingActivitySchema,
} = require("../modules/debtor-marketing/debtorMarketing.validation");
const {
  createWarningLetterSchema,
} = require("../modules/debtor-warning-letters/debtorWarningLetters.validation");
const {
  notaryProgressSchema,
} = require("../modules/legal/legal.validation");

const TEST_UUID = "11111111-1111-4111-8111-111111111111";

async function withUploadServer(run) {
  const app = express();
  app.post("/upload", uploadDomainFile("file"), (req, res) => {
    res.json({
      status: true,
      file: req.body.file,
    });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function uploadFile(baseUrl, { buffer, fileName, mimeType }) {
  const body = new FormData();
  body.append("file", new Blob([buffer], { type: mimeType }), fileName);
  const response = await fetch(`${baseUrl}/upload`, {
    method: "POST",
    body,
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

test("middleware menerima PDF valid dan membersihkan temporary file", async () => {
  await withUploadServer(async (baseUrl) => {
    const response = await uploadFile(baseUrl, {
      buffer: Buffer.from("%PDF-1.7\n%%EOF", "ascii"),
      fileName: "dokumen.pdf",
      mimeType: "application/pdf",
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.file.name, "dokumen.pdf");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(fs.existsSync(response.body.file.temp_path), false);
  });
});

test("middleware menolak executable yang menyamar sebagai PDF", async () => {
  await withUploadServer(async (baseUrl) => {
    const response = await uploadFile(baseUrl, {
      buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]),
      fileName: "dokumen.pdf",
      mimeType: "application/pdf",
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.status, false);
  });
});

test("middleware menolak ekstensi executable walau MIME mengaku PDF", async () => {
  await withUploadServer(async (baseUrl) => {
    const response = await uploadFile(baseUrl, {
      buffer: Buffer.from("%PDF-1.7\n%%EOF", "ascii"),
      fileName: "dokumen.exe",
      mimeType: "application/pdf",
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.status, false);
  });
});

test("cleanup multi-file hanya memasang satu listener per event respons", () => {
  const response = new EventEmitter();
  const paths = Array.from({ length: 20 }, (_, index) =>
    path.join(UPLOAD_TEMP_DIR, `security-test-${index}.tmp`),
  );

  attachUploadTempCleanup(response, paths);

  assert.equal(response.listenerCount("finish"), 1);
  assert.equal(response.listenerCount("close"), 1);
  response.emit("finish");
});

test("schema Debitur dan Legal menerima referensi temporary file dari disk", () => {
  const uploadedFile = {
    temp_path: path.join(UPLOAD_TEMP_DIR, "schema-test.pdf"),
    name: "dokumen.pdf",
    mime_type: "application/pdf",
    size_bytes: 12,
  };
  const payloads = [
    [
      createDebtorDocumentSchema,
      { document_type: "Dokumen Uji", files: [uploadedFile] },
    ],
    [
      createMarketingActivitySchema,
      { debtor_id: TEST_UUID, files: [uploadedFile] },
    ],
    [
      createWarningLetterSchema,
      {
        debtor_id: TEST_UUID,
        letter_type: "SP1",
        issued_at: "2026-07-06",
        files: [uploadedFile],
      },
    ],
    [
      notaryProgressSchema,
      {
        contract_id: TEST_UUID,
        third_party_id: TEST_UUID,
        deed_type: "Akta Uji",
        received_at: "2026-07-06",
        files: [uploadedFile],
      },
    ],
  ];

  for (const [schema, payload] of payloads) {
    assert.equal(schema.validate(payload).error, undefined);
  }
});
