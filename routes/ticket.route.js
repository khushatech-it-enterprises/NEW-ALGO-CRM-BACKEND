const express = require('express');
const ticketController = require('../controllers/ticket.controller');
const { isAuthenticated, authorizeRoles } = require('../middleware/auth.middleware');

const router = express.Router();

// Controller function (to be implemented in a separate controller file)

// POST route for creating a ticket
router.get('/getTicketById/:ticketId', ticketController.getTicketById);
router.delete('/deleteTicketById/:ticketId', isAuthenticated, authorizeRoles("superAdmin", "admin"), ticketController.deleteTicketById);
router.post('/create-new-ticket', isAuthenticated, authorizeRoles("superAdmin", "admin", "cse"), ticketController.createTicket);
router.post('/create-new-ticket1', ticketController.createNewTicket);
router.get('/get-all-tickets', isAuthenticated, ticketController.getAllTickets);
router.get('/export-ticket-data-by-daterange', isAuthenticated, ticketController.ExportTicketDataByDateRange);
router.get('/export-cancel-ticket-data-by-daterange', isAuthenticated, ticketController.ExportCanceledTicketDataByDateRange);
router.get('/export-all-tickets', isAuthenticated, authorizeRoles("superAdmin", "admin"), ticketController.exportAllTickets);
router.put('/update-ticket/:ticketId', isAuthenticated, authorizeRoles("superAdmin", "admin", "cse"), ticketController.updateTicket)
router.patch('/soft-close/:ticketId', ticketController.softCloseTicket);

router.get("/client/:userId", ticketController.getClientTicketsByUserId);

router.get('/tickets/export-client-ticket-data-by-daterange/:userId', ticketController.exportClientTicketsByDateRange);
router.get('/export-ClientTicketforsuperadminforReport/:clientId', ticketController.exportClientTicketforsuperadminforReportDaterange);
router.get("/closed-summary-ticket-neft-data", isAuthenticated, ticketController.getClosedTicketsSummaryforNeft);
router.get("/export-closed-summary-ticket-neft-data", ticketController.exportClosedTicketsSummaryforNeft);

// For Telecaller Dashboard (be careful when apply authorization)
router.get("/get-all-own-created-tickets-for-telecaller-dashboard/:userId", isAuthenticated, ticketController.getAllOwnCreatedTicketsForTelecallerDashboard);

// For file upload on ticket
router.patch('/save-uploaded-mediaByCse-for-vehicle/:ticketId/:vehicleId', isAuthenticated, authorizeRoles("superAdmin", "admin", "cse"), ticketController.saveImageAndVideoURlToTicketUploadByCSE);

// Apply charges for closing tickets
router.patch('/update-ticket-applyCharges/:ticketId', isAuthenticated, authorizeRoles('superAdmin', 'admin'), ticketController.updateTicketApplyCharges)
router.get('/get-all-open-tickets-for-Applycharge', isAuthenticated, ticketController.getAllOpenTicketsForApplyCharge);

// fordashboard
router.get("/dashboard-stats", isAuthenticated, ticketController.getTicketStatsForDashboard);
router.get("/dashboard-trends", isAuthenticated, ticketController.getTicketTrends);



// to show the logs of duedate chnage
router.get('/due-date-change-logs/:ticketId', isAuthenticated, ticketController.getDueDateChangeLogs);

//⚠️ It is used to check the status of a ticket in technician file upload that's why we not apply authentication role base authorization
router.get('/checkTicket-status/:ticketId/status', ticketController.getTicketStatusClosedOrOpenForTechFileUpload)

router.get('/qstClient', ticketController.getClientTicketforsuperadminforReport);

router.get('/exportciientticketbybillingcategory', isAuthenticated, authorizeRoles('superAdmin', 'admin'), ticketController.getExportTicketsByBillingCategory);
router.get('/export-technician-payment-success-report', ticketController.exportTechnicianPaymentTicketsReport);




router.get("/delete-log", ticketController.getDeletedTicketLogs);
router.get("/delete-log/:logId", ticketController.getDeletedTicketLogById);
router.get("/ticket-delete-log/:ticketId", ticketController.getDeletedLogsByTicketId);

router.post("/closed-workdone", ticketController.ExportNEFTbyIndividualTicketId);



// --------------------------------------------
// Route for creating ticket by QST Client with auto assignment
router.post('/create-new-ticket-by-qstClient', ticketController.createTicketByQSTClientWithAutoAssignment);




router.get('/margins', async (req, res) => {
  try {
    // optional from/to ISO strings in query: ?from=2024-04-01&to=2025-03-31
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;

    const result = await ticketController.getTechnicianMargins({ from, to });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});


router.get('/availability-range', ticketController.getTicketsByAvailabilityRange);

// Forward ticket data to secondary .NET system
router.post('/send-ticket-data-on-second-system', isAuthenticated, ticketController.sendTicketDataOnSecondSystem);

// Resend technician assignment email with new security code
router.post('/resend-technician-mail/:ticketId', isAuthenticated, authorizeRoles("superAdmin", "admin", "cse"), ticketController.resendTechnicianEmail);

module.exports = router;