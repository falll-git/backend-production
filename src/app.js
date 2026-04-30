const { loadEnv } = require("./config/env");
loadEnv();

const express = require("express");
const cors = require("cors");
const authRoutes = require("./modules/auth/auth.route");
const roleRoutes = require("./modules/role/role.route");
const divisionRoutes = require("./modules/division/division.route");
const letterPriorityRoutes = require("./modules/letter-priority/letterPriority.route");
const documentTypeRoutes = require("./modules/document-type/documentType.route");
const storageRoutes = require("./modules/storage/storage.route");
const userRoutes = require("./modules/user/user.route");
const incomingMails = require("./modules/incoming-mail/incomingMail.route");
const dispositionRoutes = require("./modules/disposition/disposition.route");
const menuRoutes = require("./modules/menus/menus.route");
const roleMenuRoutes = require("./modules/role-menus/roleMenus.route");
const digitalDocumentRoutes = require("./modules/digital-documents/digitalDocuments.route");
const digitalDocumentAccessRequestRoutes = require("./modules/digital-document-access-requests/digitalDocumentAccessRequests.route");
const digitalDocumentLoanRoutes = require("./modules/digital-document-loans/digitalDocumentLoans.route");
const digitalArchiveRoutes = require("./modules/digital-archives/digitalArchives.route");
const outgoingMailRoutes = require("./modules/outgoing-mails/outgoingMails.route");
const memorandumRoutes = require("./modules/memorandum/memorandum.route");
const correspondenceRoutes = require("./modules/correspondence/correspondence.route");
const { PUBLIC_PREFIX, STORAGE_ROOT } = require("./utils/persuratan-files");
const {
  PUBLIC_PREFIX: DIGITAL_ARCHIVE_PUBLIC_PREFIX,
  STORAGE_ROOT: DIGITAL_ARCHIVE_STORAGE_ROOT,
} = require("./utils/digital-archive-files");

function parseCorsOrigins() {
  const raw = process.env.CORS_ORIGIN || process.env.FRONTEND_URL || "";
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const app = express();
app.set("trust proxy", 1);

const allowedCorsOrigins = parseCorsOrigins();
app.use(
  cors(
    allowedCorsOrigins.length > 0
      ? {
          origin(origin, callback) {
            if (!origin || allowedCorsOrigins.includes(origin)) {
              return callback(null, true);
            }

            const error = new Error("CORS origin not allowed");
            error.statusCode = 403;
            return callback(error);
          },
          credentials: true,
        }
      : undefined,
  ),
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(PUBLIC_PREFIX, express.static(STORAGE_ROOT));
app.use(
  DIGITAL_ARCHIVE_PUBLIC_PREFIX,
  express.static(DIGITAL_ARCHIVE_STORAGE_ROOT),
);

app.get("/api/", function (req, res) {
  res.json({
    message: "Welcome sir, this is great start for you!",
    data: "Ruang Arsip Apps",
    version: 1,
  });
});
function healthCheck(req, res) {
  res.json({
    status: true,
    message: "OK",
    uptime: process.uptime(),
  });
}

app.get("/health", healthCheck);
app.get("/api/health", healthCheck);
app.use("/api/auth", authRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/divisions", divisionRoutes);
app.use("/api/letter-priorities", letterPriorityRoutes);
app.use("/api/document-types", documentTypeRoutes);
app.use("/api/storages", storageRoutes);
app.use("/api/users", userRoutes);
app.use("/api/incoming-mails", incomingMails);
app.use("/api/dispositions", dispositionRoutes);
app.use("/api/menus", menuRoutes);
app.use("/api/role-menus", roleMenuRoutes);
app.use("/api/digital-documents", digitalDocumentRoutes);
app.use(
  "/api/digital-document-access-requests",
  digitalDocumentAccessRequestRoutes,
);
app.use("/api/digital-document-loans", digitalDocumentLoanRoutes);
app.use("/api/digital-archives", digitalArchiveRoutes);
app.use("/api/outgoing-mails", outgoingMailRoutes);
app.use("/api/memorandums", memorandumRoutes);
app.use("/api/correspondence", correspondenceRoutes);

app.use((req, res) => {
  res.status(404).json({
    status: false,
    message: "Route not found",
  });
});

app.use((err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500;
  res.status(statusCode).json({
    status: false,
    message:
      process.env.NODE_ENV === "production" && statusCode === 500
        ? "Internal server error"
        : err.message || "Internal server error",
  });
});

module.exports = app;
