const express = require("express");
const router = express.Router();
const cseGroupController = require("../controllers/cseGroup.controller");
const {
  isAuthenticated,
  authorizeRoles,
} = require("../middleware/auth.middleware");

// All CSE Group Master routes are visible and restricted to admin and superAdmin only
router.get(
  "/get-all-groups",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  cseGroupController.getAllCseGroups
);

router.get(
  "/get-active-groups",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  cseGroupController.getActiveCseGroups
);

router.get(
  "/get-group/:id",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  cseGroupController.getCseGroupById
);

router.post(
  "/create-group",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  cseGroupController.createCseGroup
);

router.patch(
  "/update-group/:id",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  cseGroupController.updateCseGroup
);

router.post(
  "/add-members/:id",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  cseGroupController.addMembersToCseGroup
);

router.delete(
  "/remove-member/:id/:memberId",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  cseGroupController.removeMemberFromCseGroup
);

router.patch(
  "/toggle-active/:id",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  cseGroupController.toggleCseGroupActive
);

router.delete(
  "/delete-group/:id",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  cseGroupController.deleteCseGroup
);

router.get(
  "/group-tickets/:id",
  isAuthenticated,
  authorizeRoles("superAdmin", "admin"),
  cseGroupController.getCseGroupTickets
);

module.exports = router;
