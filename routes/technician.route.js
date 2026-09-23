const express = require("express");
const technicianController = require("../controllers/technicianController");

const Technician = require("../models/technician.model");
const {
  isAuthenticated,
  authorizeRoles,
} = require("../middleware/auth.middleware");

const router = express.Router();

// // Get all technicians 👈 this is use IN DRODOWN OPTION in forms
router.get(
  "/get-all-technicians",
  isAuthenticated,
  technicianController.getAllTechnicians
);

router.get(
  "/get-technician/:id",
  isAuthenticated,
  technicianController.getTechnicianById
);
router.get(
  "/check-account-number-atomicity/:accountNumber",
  technicianController.checkTechnicianAccountNuberAtomicity
);
router.delete(
  "/delete-technician/:id",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  technicianController.deleteTechnician
);

// THIS DATA RENDER TECHNICIAN MIAN PAGE TO SHOW IN TABLE
router.get(
  "/get-all-technicians-withSearhFilter",
  isAuthenticated,
  technicianController.getAllTechniciansWithSearchAndFilter
);
router.get(
  "/get-all-new-view-technicians-withSearhFilter",
  isAuthenticated,
  technicianController.getAllNewViewTechniciansWithSearchAndFilter
);

router.get("/export-newTechnician-data", technicianController.ExportgetAllNewViewTechnicians)
// router.get('/get-all-active-assigned-ticket/:technicianId',technicianController.getAllActiveAssignedTicket)

// ⚠️Don't apply authentication because it is used by technician person which is not actual user(employee) of this application
router.get(
  "/get-one-active-assigned-ticket/:technicianId/:ticketId",
  technicianController.getParticularActiveAssignedTicket
);

router.patch(
  "/edit-technician/:technicianId",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  technicianController.updateTechnician
);

router.patch(
  "/update-vehicle-number/:ticketId/:vehicleId",
  technicianController.updateVehicleNumber
);


router.post(
  "/add-technician",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  technicianController.addSingleTechnician
);
router.post(
  "/add-technician-inTicketCreation",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin", "cse"),
  technicianController.addTechnicianDuringTicketCreation
);

router.patch(
  "/update-technician-accDetails/:technicianId",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin", "cse"),
  technicianController.updateTechnicianAccountDetails
);

// this use for save image and video url by techcina, which link get on email (don't apply authentication middleware of employee or user)
router.post(
  "/media-uploaded-to-particular-vehical",
  technicianController.savedImageToParticularVehicalByTechnician
);

// Update vehicle registration number
router.patch(
  "/update-vehicle-number/:ticketId/:vehicleId",
  technicianController.updateVehicleNumber
);

router.get("/exportTechnicians", technicianController.exportsFiltTechnicians);

// Create new technician
router.post(
  "/bulk-createTechnician",
  technicianController.bulkCreateTechnicians
);

// it is used to verfy of security code of technician
router.post(
  "/securityCode/verify",
  technicianController.VerifySecurityCodeOfTechnicianInFileUpload
);

router.post('/bulk-update-categories', technicianController.bulkUpdateTechnicianCategories)

router.get("/get-tech-device-sim-accessories/:technicianId", technicianController.getTechDeviceSimAccessories);

// Add accessories to a vehicle's MainData
router.patch("/add-accessories-to-vehicle", technicianController.addAccessoriesToVehicle);


// Get technician's spare inventory (items with status "with technician")
router.get("/:id/spare-inventory", technicianController.getTechnicianSpareInventory);

// Mark / unmark a single vehicle as done by the technician
router.patch("/mark-vehicle-done", technicianController.markVehicleAsDone);

// Wiring verification: proxy AlgoTrack API call (avoids CORS from technician page)
router.post("/wiring-check", technicianController.proxyWiringCheck);

// Wiring verification: save result to ticket's vehicleNumbers
router.patch("/save-wiring-verification", technicianController.saveWiringVerification);



module.exports = router;
