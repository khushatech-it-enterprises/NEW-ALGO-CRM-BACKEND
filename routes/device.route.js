const express = require("express");
const deviceController = require("../controllers/device.cntroller");
const bulkPairingController = require("../controllers/bulkPairing.controller");
const { isAuthenticated, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();

// GET all devices for dropdown in forms
router.get("/get-all-devices", deviceController.getAllDevices);

router.get("/export-device", deviceController.exportDevices);

// get all devices for table show
router.get(
  "/get-all-devices-for-tableShow",
  isAuthenticated,
  deviceController.getAllDevicesForTableShow
);

router.delete(
  "/delete/:id",
  isAuthenticated,
  authorizeRoles('superAdmin', 'admin', 'store', 'r&d'),
  deviceController.deleteDevice
);
router.patch(
  "/update/:id",
  isAuthenticated,
  authorizeRoles('superAdmin', 'admin', 'store', 'r&d'),
  deviceController.updateDevice
);
// POST routes
router.post(
  "/create-device",
  isAuthenticated,
  authorizeRoles('superAdmin', 'admin', 'store', 'r&d'),
  deviceController.createDevice
);

router.post(
  "/create-bulk-device",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  deviceController.createDevicesBulk
);

router.get(
  '/get-detailsof-algoClient/:id',
  isAuthenticated,
  deviceController.getDetailsOfAlgoClient
);

router.get(
  '/get-DetailsforStore',
  isAuthenticated,
  deviceController.getDetailsForStore
);

router.post(
  '/create-new-mainData',
  isAuthenticated,
  deviceController.createNewMainData
)

// ── Bulk Pairing ───────────────────────────────────────────────────────────
// GET  – download template Excel with server & client dropdowns
router.get(
  '/bulk-pairing-template',
  isAuthenticated,
  bulkPairingController.downloadTemplate
);

// POST – upload filled Excel and perform pairing
router.post(
  '/bulk-pairing-import',
  isAuthenticated,
  authorizeRoles('superAdmin', 'admin', 'store'),
  bulkPairingController.uploadExcelMiddleware,
  bulkPairingController.importBulkPairing
);

module.exports = router;
