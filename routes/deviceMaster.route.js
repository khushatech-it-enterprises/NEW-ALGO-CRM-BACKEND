const express = require("express");
const {
  isAuthenticated,
  authorizeRoles,
} = require("../middleware/auth.middleware");
const router = express.Router();
const deviceMasterController = require("../controllers/deviceMaster.controller");
const rdTestingController = require("../controllers/rdTesting.controller");

router.get(
  "/get-all-deviceMasters",
  isAuthenticated,
  deviceMasterController.getAllDeviceMasters
);
router.post(
  "/create-deviceMasters",
  isAuthenticated,
  deviceMasterController.createDeviceMasters
);
router.post(
  "/bulk-create-deviceMasters",
  isAuthenticated,
  deviceMasterController.bulkCreateDeviceMasters
);
router.put(
  "/update-deviceMasters/:id",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin", "cse", "store"),
  deviceMasterController.updateDeviceMasters
);
router.delete(
  "/delete-deviceMasters/:id",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin", "cse", "store"),
  deviceMasterController.deleteDeviceMasters
);

// R&D Testing — only r&d role
router.put(
  "/rd-testing/:id",
  isAuthenticated,
  authorizeRoles("r&d"),
  rdTestingController.rdTestDevice
);

// R&D Delete image — r&d + admins can delete stale images
router.delete(
  "/rd-image/:id",
  isAuthenticated,
  authorizeRoles("r&d", "superAdmin", "admin"),
  rdTestingController.rdDeleteDeviceImage
);

// R&D Repairable Testing — only r&d role
router.put(
  "/rd-repairable-testing/:id",
  isAuthenticated,
  authorizeRoles("r&d"),
  rdTestingController.rdTestRepairableDevice
);


// Bulk assign — get stock counts grouped by device model
// :clientId = a QstClient ObjectId (filters via MainData store pairing), or "all" for unfiltered
router.post(
  "/stock-count-by-type/:clientId",
  isAuthenticated,
  deviceMasterController.getStockCountByType
);

// Bulk assign — preview actual device IDs for a given model + limit
router.get(
  "/stock-devices-by-model",
  isAuthenticated,
  deviceMasterController.getStockDevicesByModel
);

// Bulk R&D assign — assign N stock devices to R&D member
router.post(
  "/bulk-assign-rd",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin", "store"),
  deviceMasterController.bulkAssignToRd
);

// Bulk multi-status assign — assign N stock devices to any status + person
router.post(
  "/bulk-assign-status",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin", "store"),
  deviceMasterController.bulkAssignStatus
);


module.exports = router;


