const mongoose = require("mongoose");
const CseGroup = require("../models/cseGroup.model");
const Employee = require("../models/employee.model");
const Ticket = require("../models/ticket.model");

const POPULATE_GROUP_FIELDS = [
  { path: "members", select: "name email role phoneNumber zone" },
  { path: "createdBy", select: "name email" },
];

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getTicketStatusConditions(status) {
  if (!status || status === "All Tickets") return null;
  if (status === "Closed") {
    return [{ ticketStatus: "work done" }, { isTicketClosed: true }];
  }
  if (status === "Open") {
    return [{ isTicketClosed: { $ne: true } }];
  }
  if (status === "work done") {
    return [{ ticketStatus: "work done" }, { isTicketClosed: { $ne: true } }];
  }
  return [{ ticketStatus: status }];
}

/**
 * Deduplicate and validate that every provided ID belongs to an Employee with role "cse".
 */
async function validateCseMembers(memberIds) {
  if (!Array.isArray(memberIds)) {
    return { valid: false, message: "Members must be an array of IDs" };
  }

  const uniqueIds = [];
  const seen = new Set();
  for (const rawId of memberIds) {
    const idStr = String(rawId || "").trim();
    if (!idStr) continue;
    if (!mongoose.Types.ObjectId.isValid(idStr)) {
      return { valid: false, message: "Invalid member ID(s)" };
    }
    if (!seen.has(idStr)) {
      seen.add(idStr);
      uniqueIds.push(idStr);
    }
  }

  if (uniqueIds.length === 0) {
    return { valid: true, memberIds: [] };
  }

  const cseEmployees = await Employee.find({
    _id: { $in: uniqueIds },
    role: "cse",
  }).select("_id");

  if (cseEmployees.length !== uniqueIds.length) {
    return {
      valid: false,
      message: "Some member IDs are invalid or do not belong to CSE employees",
    };
  }

  return { valid: true, memberIds: uniqueIds };
}

async function fetchPopulatedGroup(groupId) {
  return CseGroup.findById(groupId).populate(POPULATE_GROUP_FIELDS);
}

// Get all CSE Groups (with member details and live ticket counts)
exports.getAllCseGroups = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 10);
    const search = (req.query.search || "").trim();

    const query = {};
    if (search) {
      const searchRegex = new RegExp(escapeRegex(search), "i");
      const matchingMemberIds = await Employee.find({
        role: "cse",
        $or: [{ name: searchRegex }, { email: searchRegex }],
      }).distinct("_id");

      query.$or = [
        { name: searchRegex },
        { description: searchRegex },
        ...(matchingMemberIds.length > 0
          ? [{ members: { $in: matchingMemberIds } }]
          : []),
      ];
    }

    const totalGroups = await CseGroup.countDocuments(query);
    const totalPages = Math.ceil(totalGroups / limit);

    const groups = await CseGroup.find(query)
      .populate(POPULATE_GROUP_FIELDS)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Aggregate open/closed/total ticket counts per CSE across visible groups
    const allMemberIdMap = new Map();
    for (const group of groups) {
      for (const member of group.members || []) {
        if (member?._id) {
          allMemberIdMap.set(member._id.toString(), member._id);
        }
      }
    }

    const memberTicketMap = new Map();
    if (allMemberIdMap.size > 0) {
      const memberObjectIds = Array.from(allMemberIdMap.values());
      const counts = await Ticket.aggregate([
        { $match: { assignee: { $in: memberObjectIds } } },
        {
          $group: {
            _id: "$assignee",
            totalTickets: { $sum: 1 },
            openTickets: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ["$ticketStatus", "work done"] },
                      { $ne: ["$isTicketClosed", true] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            closedTickets: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $eq: ["$ticketStatus", "work done"] },
                      { $eq: ["$isTicketClosed", true] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]);

      for (const item of counts) {
        memberTicketMap.set(item._id.toString(), {
          totalTickets: item.totalTickets,
          openTickets: item.openTickets,
          closedTickets: item.closedTickets,
        });
      }
    }

    const groupsWithStats = groups.map((group) => {
      let totalTickets = 0;
      let openTickets = 0;
      let closedTickets = 0;

      for (const member of group.members || []) {
        const stats = memberTicketMap.get(member?._id?.toString());
        if (stats) {
          totalTickets += stats.totalTickets;
          openTickets += stats.openTickets;
          closedTickets += stats.closedTickets;
        }
      }

      return {
        ...group,
        ticketStats: {
          totalTickets,
          openTickets,
          closedTickets,
        },
      };
    });

    res.status(200).json({
      success: true,
      data: groupsWithStats,
      pagination: {
        page,
        limit,
        total: totalGroups,
        totalPages,
      },
    });
  } catch (error) {
    console.error("Error fetching CSE groups:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

// Get lightweight list of active CSE Groups for dropdowns / ticket filtering
exports.getActiveCseGroups = async (req, res) => {
  try {
    const groups = await CseGroup.find({ isActive: true })
      .select("_id name description members")
      .populate("members", "name email")
      .sort({ name: 1 })
      .lean();

    res.status(200).json({
      success: true,
      data: groups,
    });
  } catch (error) {
    console.error("Error fetching active CSE groups:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

// Get a single CSE Group by ID
exports.getCseGroupById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid group ID",
      });
    }

    const group = await fetchPopulatedGroup(id);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: "CSE Group not found",
      });
    }

    res.status(200).json({
      success: true,
      data: group,
    });
  } catch (error) {
    console.error("Error fetching CSE group:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

// Create a new CSE Group
exports.createCseGroup = async (req, res) => {
  try {
    const { name, description, members } = req.body;

    if (!name || typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Group name is required",
      });
    }

    const trimmedName = name.trim();
    const existing = await CseGroup.findOne({
      name: { $regex: `^${escapeRegex(trimmedName)}$`, $options: "i" },
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "A CSE Group with this name already exists",
      });
    }

    let memberIds = [];
    if (members !== undefined) {
      const validation = await validateCseMembers(members);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          message: validation.message,
        });
      }
      memberIds = validation.memberIds;
    }

    const newGroup = new CseGroup({
      name: trimmedName,
      description: typeof description === "string" ? description.trim() : "",
      members: memberIds,
      createdBy: req.user._id,
    });

    await newGroup.save();
    const populatedGroup = await fetchPopulatedGroup(newGroup._id);

    res.status(201).json({
      success: true,
      message: "CSE Group created successfully",
      data: populatedGroup,
    });
  } catch (error) {
    console.error("Error creating CSE group:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

// Update a CSE Group
exports.updateCseGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, members, isActive } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid group ID",
      });
    }

    const group = await CseGroup.findById(id);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: "CSE Group not found",
      });
    }

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim() === "") {
        return res.status(400).json({
          success: false,
          message: "Group name cannot be empty",
        });
      }
      const trimmedName = name.trim();
      if (trimmedName.toLowerCase() !== group.name.toLowerCase()) {
        const existing = await CseGroup.findOne({
          _id: { $ne: id },
          name: { $regex: `^${escapeRegex(trimmedName)}$`, $options: "i" },
        });
        if (existing) {
          return res.status(409).json({
            success: false,
            message: "Another CSE Group with this name already exists",
          });
        }
      }
      group.name = trimmedName;
    }

    if (description !== undefined) {
      group.description = typeof description === "string" ? description.trim() : "";
    }

    if (isActive !== undefined) {
      group.isActive = Boolean(isActive);
    }

    if (members !== undefined) {
      const validation = await validateCseMembers(members);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          message: validation.message,
        });
      }
      group.members = validation.memberIds;
    }

    await group.save();
    const updatedGroup = await fetchPopulatedGroup(id);

    res.status(200).json({
      success: true,
      message: "CSE Group updated successfully",
      data: updatedGroup,
    });
  } catch (error) {
    console.error("Error updating CSE group:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

// Add one or more CSE members to an existing CSE Group
exports.addMembersToCseGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { memberIds } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid group ID",
      });
    }

    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "memberIds array is required",
      });
    }

    const validation = await validateCseMembers(memberIds);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.message,
      });
    }

    const group = await CseGroup.findById(id);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: "CSE Group not found",
      });
    }

    const existingMemberStrings = new Set(group.members.map((m) => m.toString()));
    const newMembers = validation.memberIds.filter(
      (mid) => !existingMemberStrings.has(mid)
    );

    if (newMembers.length === 0) {
      return res.status(400).json({
        success: false,
        message: "All selected CSEs are already in this group",
      });
    }

    group.members.push(...newMembers);
    await group.save();

    const updatedGroup = await fetchPopulatedGroup(id);

    res.status(200).json({
      success: true,
      message: `${newMembers.length} CSE member(s) added successfully`,
      data: updatedGroup,
    });
  } catch (error) {
    console.error("Error adding members to CSE group:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

// Remove a CSE member from an existing CSE Group
exports.removeMemberFromCseGroup = async (req, res) => {
  try {
    const { id, memberId } = req.params;

    if (
      !mongoose.Types.ObjectId.isValid(id) ||
      !mongoose.Types.ObjectId.isValid(memberId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid group or member ID",
      });
    }

    const group = await CseGroup.findById(id);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: "CSE Group not found",
      });
    }

    const memberIndex = group.members.findIndex(
      (m) => m.toString() === memberId
    );
    if (memberIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Member not found in this group",
      });
    }

    group.members.splice(memberIndex, 1);
    await group.save();

    const updatedGroup = await fetchPopulatedGroup(id);

    res.status(200).json({
      success: true,
      message: "Member removed successfully",
      data: updatedGroup,
    });
  } catch (error) {
    console.error("Error removing member from CSE group:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

// Delete a CSE Group
exports.deleteCseGroup = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid group ID",
      });
    }

    const group = await CseGroup.findByIdAndDelete(id);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: "CSE Group not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "CSE Group deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting CSE group:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

// Toggle active status
exports.toggleCseGroupActive = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid group ID",
      });
    }

    const group = await CseGroup.findById(id);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: "CSE Group not found",
      });
    }

    group.isActive = !group.isActive;
    await group.save();

    const updatedGroup = await fetchPopulatedGroup(id);

    res.status(200).json({
      success: true,
      message: `CSE Group ${group.isActive ? "activated" : "deactivated"} successfully`,
      data: updatedGroup,
    });
  } catch (error) {
    console.error("Error toggling CSE group status:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

// Watch all tickets for all CSE members in a group in one go
exports.getCseGroupTickets = async (req, res) => {
  try {
    const { id } = req.params;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 10);
    const search = (req.query.search || "").trim();
    const status = req.query.status || "";
    const memberId = req.query.memberId || "";

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid group ID",
      });
    }

    const group = await CseGroup.findById(id)
      .populate("members", "name email phoneNumber zone")
      .lean();

    if (!group) {
      return res.status(404).json({
        success: false,
        message: "CSE Group not found",
      });
    }

    if (!group.members || group.members.length === 0) {
      return res.status(200).json({
        success: true,
        groupName: group.name,
        members: [],
        stats: { total: 0, open: 0, closed: 0 },
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      });
    }

    const memberIds = group.members.map((m) => m._id);

    // Optional single-CSE focus filter inside the group
    let assigneeFilter = { $in: memberIds };
    if (memberId) {
      if (!mongoose.Types.ObjectId.isValid(memberId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid memberId filter",
        });
      }
      const isInGroup = memberIds.some((m) => m.toString() === memberId);
      if (!isInGroup) {
        return res.status(400).json({
          success: false,
          message: "Selected CSE is not a member of this group",
        });
      }
      assigneeFilter = new mongoose.Types.ObjectId(memberId);
    }

    const baseGroupQuery = { assignee: assigneeFilter };
    const andConditions = [baseGroupQuery];

    const statusConditions = getTicketStatusConditions(status);
    if (statusConditions) {
      andConditions.push(...statusConditions);
    }

    if (search) {
      const searchRegex = new RegExp(escapeRegex(search), "i");
      const matchingAssignees = await Employee.find({
        _id: { $in: memberIds },
        name: searchRegex,
      }).distinct("_id");

      const orConditions = [
        { ticketSKUId: searchRegex },
        { qstClientTicketNumber: searchRegex },
        { customerName: searchRegex },
        { mobile: searchRegex },
        { location: searchRegex },
        { subjectLine: searchRegex },
        { description: searchRegex },
        { "vehicleNumbers.vehicleNumber": searchRegex },
      ];

      if (matchingAssignees.length > 0) {
        orConditions.push({ assignee: { $in: matchingAssignees } });
      }
      if (mongoose.Types.ObjectId.isValid(search)) {
        orConditions.push({ _id: new mongoose.Types.ObjectId(search) });
      }

      andConditions.push({ $or: orConditions });
    }

    const ticketQuery =
      andConditions.length === 1 ? andConditions[0] : { $and: andConditions };

    const [totalTickets, openCount, closedCount, tickets] = await Promise.all([
      Ticket.countDocuments(ticketQuery),
      Ticket.countDocuments({
        assignee: assigneeFilter,
        $and: [
          { ticketStatus: { $ne: "work done" } },
          { isTicketClosed: { $ne: true } },
        ],
      }),
      Ticket.countDocuments({
        assignee: assigneeFilter,
        $or: [{ ticketStatus: "work done" }, { isTicketClosed: true }],
      }),
      Ticket.find(ticketQuery)
        .select("+isTechnicianPaymentSuccessDate +annexturepaid")
        .populate("qstClientName", "companyShortName companyName")
        .populate("assignee", "name email _id")
        .populate("taskType", "taskName")
        .populate("deviceType", "deviceName")
        .populate("technician", "name nickName beneficiaryId")
        .populate("creator", "name")
        .populate("qstProjectID", "projectName _id")
        .populate("softCloseByTechnicianComment")
        .sort({ dueDate: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    const totalPages = Math.ceil(totalTickets / limit);

    res.status(200).json({
      success: true,
      groupName: group.name,
      members: group.members,
      stats: {
        total: openCount + closedCount,
        open: openCount,
        closed: closedCount,
      },
      data: tickets,
      pagination: {
        page,
        limit,
        total: totalTickets,
        totalPages,
      },
    });
  } catch (error) {
    console.error("Error fetching CSE group tickets:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};
