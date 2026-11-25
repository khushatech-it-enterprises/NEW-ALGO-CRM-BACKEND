const express = require("express");
const {
  isAuthenticated,
  authorizeRoles,
} = require("../middleware/auth.middleware");
const router = express.Router();
const accessoryMasterController = require("../controllers/accessoryMaster.controller");
const rdTestingController = require("../controllers/rdTesting.controller");

router.get(
  "/get-all-accessoryMaster",
  isAuthenticated,
  accessoryMasterController.getAllAccessoryMasters
);
router.post(
  "/create-accessoryMaster",
  isAuthenticated,
  accessoryMasterController.createAccessoryMasters
);
router.post(
  "/bulk-create-accessoryMaster",
  isAuthenticated,
  accessoryMasterController.bulkCreateAccessoryMasters
);
router.put(
  "/update-accessoryMaster/:id",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin", "cse", "store"),
  accessoryMasterController.updateAccessoryMasters
);
router.delete(
  "/delete-accessoryMaster/:id",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin", "cse", "store"),
  accessoryMasterController.deleteAccessoryMasters
);

// R&D Testing — only r&d role
router.put(
  "/rd-testing/:id",
  isAuthenticated,
  authorizeRoles("r&d"),
  rdTestingController.rdTestAccessory
);

// R&D Delete image
router.delete(
  "/rd-image/:id",
  isAuthenticated,
  authorizeRoles("r&d", "superAdmin", "admin"),
  rdTestingController.rdDeleteAccessoryImage
);

// R&D Repairable Testing — only r&d role
router.put(
  "/rd-repairable-testing/:id",
  isAuthenticated,
  authorizeRoles("r&d"),
  rdTestingController.rdTestRepairableAccessory
);

// Bulk assign — get stock counts grouped by accessory model
router.post(
  "/stock-count-by-type/:clientId",
  isAuthenticated,
  accessoryMasterController.getStockCountByType
);

// Bulk assign — preview actual accessory IDs for a given model + limit
router.get(
  "/stock-accessories-by-model",
  isAuthenticated,
  accessoryMasterController.getStockAccessoriesByModel
);

// Bulk multi-status assign — assign N stock accessories to any status + person
router.post(
  "/bulk-assign-status",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin", "store"),
  accessoryMasterController.bulkAssignStatus
);

module.exports = router;


