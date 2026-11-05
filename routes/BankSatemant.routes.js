const express = require("express");
const router = express.Router();
const bankStatementController = require("../controllers/bankStatement.controller");
const {
  isAuthenticated,
  authorizeRoles,
} = require("../middleware/auth.middleware");

// Payment processing route
// router.get('/get-sales-register-sample',bankStatementController.getSalesRegisters)
router.post(
  "/payment/process",
  isAuthenticated,
  authorizeRoles("superAdmin"),
  bankStatementController.processPayments
);
// router.post('/payment/process',isAuthenticated,authorizeRoles('superAdmin') ,bankStatementController.processPayments);
// router.post('/payment/process',isAuthenticated,authorizeRoles('superAdmin') ,bankStatementController.processPaymentsCRForCollection);
router.patch(
  "/payment/process-single",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  bankStatementController.processSingleTechnicianPayment
);
router.get(
  "/get-closedTicket-techPayment",
  isAuthenticated,
  authorizeRoles("superAdmin", "cse"),
  bankStatementController.getAllFullyClosedTicketPendingTechPay
);
router.get(
  "/get-closedTicket-techPayment-success",
  isAuthenticated,
  authorizeRoles("cse"),
  bankStatementController.getAllFullyClosedTicketSucessTechPay
);
router.post(
  "/payment/process-cr/collection",
  isAuthenticated,
  authorizeRoles("superAdmin"),
  bankStatementController.processPaymentsCRForCollection
);
router.get(
  "/get-client-paymet-collection",
  isAuthenticated,
  bankStatementController.getClientPaymentsCollectionData
);
router.get(
  "/get-Cr-report-uploaded-file",
  bankStatementController.getReportforUploadedFile
);
router.patch(
  "/client-payment/:id",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  bankStatementController.updateClientPayment
);
router.post(
  "/repair-mappings",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  bankStatementController.repairClientMappings
);

// router.post("/upload-sales-sample-register", bankStatementController.uploadSalesRegisterExcel);

router.post(
  "/upload-sales-sample-register",
  bankStatementController.uploadSalesRegister
);
router.get(
  "/get-sales-register-sample",
  bankStatementController.getSalesRegisters
);
router.get(
  "/get-collection-summary-for-dashboard",
  bankStatementController.getCollectionSummaryForDashboard
);

router.post(
  "/upload-bank-statement",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  bankStatementController.uploadBankStatement
);
router.get(
  "/get-bank-statements",
  isAuthenticated,
  bankStatementController.getBankStatements
);
router.patch(
  "/statement/:id",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  bankStatementController.updateBankStatementDeposit
);

module.exports = router;
