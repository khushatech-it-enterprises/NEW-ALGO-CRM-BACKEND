const express = require("express");
const router = express.Router();
const maindashboardcontroller = require("../controllers/maindashboard.controller");
const {
  isAuthenticated,
  authorizeRoles,
} = require("../middleware/auth.middleware");

router.get(
  "/main-dashboard",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  maindashboardcontroller.getDashboardStats
);
router.get(
  "/cse-dashboard",
  isAuthenticated,
  authorizeRoles("cse"),
  maindashboardcontroller.getCSEDashboardStats
);

router.get(
  "/key-client-stats",
  isAuthenticated,
  maindashboardcontroller.getKeyClientStats
);
router.get("/technician-stats", maindashboardcontroller.getTechnicianStats);
router.get("/zone-stats", maindashboardcontroller.getVehicalsData);
router.get("/get-new-technician", maindashboardcontroller.getTechnicianStats1);

router.get(
  "/payroll-technicians-vehicle-counts",
  isAuthenticated,
  maindashboardcontroller.getPayrollTechniciansVehicleCountsForDashboard
);
router.get(
  "/payroll-technicians-vehicle-done-tickets",
  maindashboardcontroller.getTicketsByTechnicianAndDateRange
);

router.get(
  "/payroll-technicians-open-tickets-counts",
  isAuthenticated,
  maindashboardcontroller.getPayrollTechniciansOpenTicketsCounts
);
router.get(
  "/payroll-technicians-open-tickets",
  isAuthenticated,
  maindashboardcontroller.getPayrollTechniciansOpenTickets
);

router.get("/monthly-margins", maindashboardcontroller.getMonthlyMargins);

router.get(
  "/aggregated-details",
  maindashboardcontroller.getAggregatedTicketDetails
);

// Open tickets with quantity >= 3
router.get(
  "/open-tickets-qty3",
  isAuthenticated,
  maindashboardcontroller.getOpenTicketsQty3Count
);
router.get(
  "/open-tickets-qty3-details",
  isAuthenticated,
  maindashboardcontroller.getOpenTicketsQty3Details
);

// Zone completion percentages
router.get(
  "/zone-completion-today",
  isAuthenticated,
  maindashboardcontroller.getZoneCompletionMonth
);

router.get(
  "/performance-ratio-fy",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  maindashboardcontroller.getPerformanceRatioFY
);

// Warranty stats for Device Master & Accessory Master (store + admin)
router.get(
  "/warranty-stats",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin", "store"),
  maindashboardcontroller.getWarrantyStats
);

// Stock stats: count + total value + warranty breakdown
router.get(
  "/stock-stats",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin", "store"),
  maindashboardcontroller.getStockStats
);

// Inventory type stats: counts by device/accessory type & model
router.get(
  "/inventory-type-stats",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin", "store"),
  maindashboardcontroller.getInventoryTypeStats
);

// Demo units: within / outside demo period
router.get(
  "/demo-stats",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin", "store"),
  maindashboardcontroller.getDemoStats
);

module.exports = router;
