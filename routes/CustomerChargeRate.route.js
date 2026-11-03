const express = require("express");
const customerChargeRateController = require("../controllers/CustomerChargeRate.controller");
const chargeRateImport = require("../controllers/chargeRateImport.controller");
const {
  isAuthenticated,
  authorizeRoles,
} = require("../middleware/auth.middleware");

const router = express.Router();

// ── Charge Rate Import via Excel ──────────────────────────────────────────────
router.get(
  "/import-charge-rates/template",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  chargeRateImport.downloadTemplate
);
router.post(
  "/import-charge-rates/preview",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  chargeRateImport.upload.single("file"),
  chargeRateImport.previewChargeRateImport
);
router.post(
  "/import-charge-rates/confirm",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  chargeRateImport.upload.single("file"),
  chargeRateImport.confirmChargeRateImport
);

// GET routes
router.get(
  "/customer-charge-rateList",
  isAuthenticated,
  customerChargeRateController.getAllCustomerChargeRateListOfClient
);
router.patch(
  "/update-customer-charge-rate/:id",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  customerChargeRateController.updateCustomerChargeRate
);
router.get(
  "/get-customerCharge-byId/:id",
  isAuthenticated,
  customerChargeRateController.getCustomerChargeById
);
router.get(
  "/get-cutomerRates-for-ticket-creation",
  isAuthenticated,
  customerChargeRateController.getCustomerRatePerVehicleForTicketCreatePage
);
router.delete(
  "/delete-customerCharge/:id",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  customerChargeRateController.deleteCustomerChargeRate
);
router.delete(
  "/delete-customerCharge-group",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  customerChargeRateController.deleteCustomerChargeRateGroup
);
router.post(
  "/customer-charge-rateList",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  customerChargeRateController.createCustomerChargeRateListOfClient
);

// router.post('/update/:id', deviceController.updateDevice);

module.exports = router;
