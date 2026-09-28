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


// Bulk R&D assign — get stock counts by device type
router.get(
  "/stock-count-by-type",
  isAuthenticated,
  deviceMasterController.getStockCountByType
);

// Bulk R&D assign — assign N stock devices to R&D member
router.post(
  "/bulk-assign-rd",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin", "store"),
  deviceMasterController.bulkAssignToRd
);

module.exports = router;


