const Ticket = require("../models/ticket.model");
const QstClient = require("../models/qstClient.model");
const Technician = require("../models/technician.model");
const Employee = require("../models/employee.model");
const MonthlyMargin = require("../models/MonthlyMargin.model");
const Task = require("../models/task.model");
const MainData = require("../models/mainData.model");

// Helper functions
const getDateRanges = () => {
  const now = new Date();

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  // it start from sunday to saturday
  // const startOfWeek = new Date(now);
  // startOfWeek.setDate(now.getDate() - now.getDay());
  // startOfWeek.setHours(0, 0, 0, 0);

  // it start from monday to sunday (accepted)
  const startOfWeek = new Date(now);
  const day = now.getDay(); // 0 (Sun) - 6 (Sat)
  const diff = day === 0 ? -6 : 1 - day; // if Sunday, go back 6 days, else shift to Monday
  startOfWeek.setDate(now.getDate() + diff);
  startOfWeek.setHours(0, 0, 0, 0);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  return { now, startOfToday, startOfWeek, startOfMonth, startOfYear };
};

const formatChartData = (type, data) => {
  if (type === "weekly") {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return days.map((day, i) => ({
      name: day,
      value: data.find((d) => d.day === i + 1)?.count || 0,
    }));
  }

  if (type === "monthly") {
    return Array.from({ length: 5 }).map((_, i) => ({
      name: `Week ${i + 1}`,
      value: data[i]?.count || 0,
    }));
  }

  if (type === "yearly") {
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return months.map((name, i) => ({
      name,
      value: data.find((d) => d.month === i + 1)?.count || 0,
    }));
  }

  return [];
};

// Data fetching functions
const fetchTicketStatusStats = async (startOfToday) => {
  const tickets = await Ticket.aggregate([
    {
      $facet: {
        totalTickets: [{ $count: "count" }],
        // closedTickets: [
        //   { $match: { isTicketClosed: true } },
        //   { $count: "count" }
        // ],
        closedTickets: [
          { $match: { isTicketClosed: true } },
          { $count: "count" },
        ],

        fullyClosedTickets: [
          { $match: { isTicketClosed: true, ticketStatus: "work done" } },
          { $count: "count" },
        ],

        canceledTickets: [
          {
            $match: {
              isTicketClosed: true,
              ticketStatus: { $ne: "work done" },
            },
          },
          { $count: "count" },
        ],
        openTickets: [
          { $match: { isTicketClosed: false } },
          { $count: "count" },
        ],
        delayedTickets: [
          {
            $match: {
              isTicketClosed: false,
              ticketStatus: { $ne: "work done" },
              dueDate: { $lt: startOfToday },
            },
          },
          { $count: "count" },
        ],
      },
    },
  ]);

  const result = tickets[0];
  return {
    total: result.totalTickets[0]?.count || 0,
    open: result.openTickets[0]?.count || 0,
    closed: result.closedTickets[0]?.count || 0,
    delayed: result.delayedTickets[0]?.count || 0,
    fullyClosed: result.fullyClosedTickets[0]?.count || 0,
    canceled: result.canceledTickets[0]?.count || 0,
  };
};

const fetchTimePeriodCounts = async ({
  startOfToday,
  startOfWeek,
  startOfMonth,
  startOfYear,
}) => {
  const [dailyCount, weeklyCount, monthlyCount, yearlyCount] =
    await Promise.all([
      Ticket.countDocuments({ createdAt: { $gte: startOfToday } }),
      Ticket.countDocuments({ createdAt: { $gte: startOfWeek } }),
      Ticket.countDocuments({ createdAt: { $gte: startOfMonth } }),
      Ticket.countDocuments({ createdAt: { $gte: startOfYear } }),
    ]);

  return { dailyCount, weeklyCount, monthlyCount, yearlyCount };
};

const fetchTrendData = async ({ startOfWeek, startOfMonth, startOfYear }) => {
  const [weekly, monthly, yearly] = await Promise.all([
    Ticket.aggregate([
      { $match: { createdAt: { $gte: startOfWeek } } },
      {
        $group: {
          _id: { $dayOfWeek: "$createdAt" },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          day: "$_id",
          count: 1,
        },
      },
    ]),
    Ticket.aggregate([
      { $match: { createdAt: { $gte: startOfMonth } } },
      {
        $group: {
          _id: { $week: "$createdAt" },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          week: "$_id",
          count: 1,
        },
      },
    ]),
    Ticket.aggregate([
      { $match: { createdAt: { $gte: startOfYear } } },
      {
        $group: {
          _id: { $month: "$createdAt" },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          month: "$_id",
          count: 1,
        },
      },
    ]),
  ]);

  return {
    weekly: formatChartData("weekly", weekly),
    monthly: formatChartData("monthly", monthly),
    yearly: formatChartData("yearly", yearly),
  };
};

// Main controller
const getDashboardStats = async (req, res) => {
  try {
    const dateRanges = getDateRanges();

    const [statusStats, timePeriodCounts, trendData] = await Promise.all([
      fetchTicketStatusStats(dateRanges.startOfToday),
      fetchTimePeriodCounts(dateRanges),
      fetchTrendData(dateRanges),
    ]);

    res.status(200).json({
      status: statusStats,
      counts: timePeriodCounts,
      trends: trendData,
    });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error.message);
    res.status(500).json({ message: "Server Error" });
  }
};

const getKeyClientStats = async (req, res) => {
  const now = new Date();
  // const today = new Date(now.setHours(23, 59, 59, 999));
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  );

  // 1st of current month
  const startOfCurrentMonth = new Date(
    today.getFullYear(),
    today.getMonth(),
    1,
  );

  // Last month range
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const sameDayLastMonth = new Date(
    lastMonth.getFullYear(),
    lastMonth.getMonth(),
    today.getDate(),
  );
  sameDayLastMonth.setHours(23, 59, 59, 999);

  // FULL last month end (e.g., if today is 1 Oct -> end = 30 Sep 23:59:59.999)
  const lastMonthFullEnd = new Date(
    today.getFullYear(),
    today.getMonth(),
    0,
    23,
    59,
    59,
    999,
  );

  const lastToLastMonthStart = new Date(
    today.getFullYear(),
    today.getMonth() - 2,
    1,
  );
  const lastToLastMonthEnd = new Date(
    today.getFullYear(),
    today.getMonth() - 1,
    0,
    23,
    59,
    59,
    999,
  );

  // Financial year start: April 1st
  const financialYearStart = new Date(
    today.getMonth() < 3 ? today.getFullYear() - 1 : today.getFullYear(),
    3,
    1,
  );

  // Months completed in FY till last month (not including current month)
  let monthsElapsedInFY;
  if (today.getMonth() >= 3) {
    monthsElapsedInFY = today.getMonth() - 3; // E.g., if July (6), then 6 - 3 = 3 months completed: Apr, May, Jun
  } else {
    monthsElapsedInFY = 12 - 3 + today.getMonth(); // For Jan/Feb/Mar
  }

  // Formula

  // avgVehiclesPerMonthFY
  // =
  // Total Vehicles in FY
  // Number of Months Elapsed in FY
  // avgVehiclesPerMonthFY=
  // Number of Months Elapsed in FY
  // Total Vehicles in FY
  // ​

  // 0. Get "Installation" task ID
  const installationTask = await Task.findOne({
    taskName: { $regex: /^installation$/i },
  });
  const installationTaskId = installationTask ? installationTask._id : null;

  // === Fetch Key Clients Aggregation ===
  const keyClientPipeline = [
    {
      $match: { keyClient: true },
    },

    // 🔥 OPTIMIZED LOOKUP – filter inside lookup
    {
      $lookup: {
        from: "tickets",
        let: { clientId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$qstClientName", "$$clientId"] },
                  { $eq: ["$ticketStatus", "work done"] },
                  { $eq: [{ $type: "$technician" }, "objectId"] },
                  { $ne: ["$taskType", installationTaskId] },
                  { $gte: ["$ticketAvailabilityDate", financialYearStart] },
                  { $lte: ["$ticketAvailabilityDate", today] },
                ],
              },
            },
          },
          {
            $project: {
              ticketAvailabilityDate: 1,
              noOfVehicles: 1,
              vehicleNumbers: 1,
              totalCustomerCharges: 1,
            },
          },
        ],
        as: "tickets",
      },
    },

    // Split tickets into ranges
    {
      $addFields: {
        currentMonthTickets: {
          $filter: {
            input: "$tickets",
            as: "t",
            cond: {
              $and: [
                { $gte: ["$$t.ticketAvailabilityDate", startOfCurrentMonth] },
                { $lte: ["$$t.ticketAvailabilityDate", today] },
              ],
            },
          },
        },
        lastMonthSameRangeTickets: {
          $filter: {
            input: "$tickets",
            as: "t",
            cond: {
              $and: [
                { $gte: ["$$t.ticketAvailabilityDate", lastMonth] },
                { $lte: ["$$t.ticketAvailabilityDate", sameDayLastMonth] },
              ],
            },
          },
        },
        lastMonthFullTickets: {
          $filter: {
            input: "$tickets",
            as: "t",
            cond: {
              $and: [
                { $gte: ["$$t.ticketAvailabilityDate", lastMonth] },
                { $lte: ["$$t.ticketAvailabilityDate", lastMonthFullEnd] },
              ],
            },
          },
        },
        lastToLastMonthTickets: {
          $filter: {
            input: "$tickets",
            as: "t",
            cond: {
              $and: [
                { $gte: ["$$t.ticketAvailabilityDate", lastToLastMonthStart] },
                { $lte: ["$$t.ticketAvailabilityDate", lastToLastMonthEnd] },
              ],
            },
          },
        },
        fyTickets: {
          $filter: {
            input: "$tickets",
            as: "t",
            cond: {
              $and: [
                { $gte: ["$$t.ticketAvailabilityDate", financialYearStart] },
                { $lte: ["$$t.ticketAvailabilityDate", today] },
              ],
            },
          },
        },
      },
    },

    // Calculations
    {
      $addFields: {
        totalVehiclesThisMonth: {
          $sum: {
            $map: {
              input: "$currentMonthTickets",
              as: "t",
              in: {
                $cond: [
                  { $gt: ["$$t.noOfVehicles", 0] },
                  "$$t.noOfVehicles",
                  { $size: { $ifNull: ["$$t.vehicleNumbers", []] } },
                ],
              },
            },
          },
        },
        totalCustomerChargesThisMonth: {
          $sum: "$currentMonthTickets.totalCustomerCharges",
        },
        ticketCountThisMonth: { $size: "$currentMonthTickets" },

        totalVehiclesLastMonth: {
          $sum: {
            $map: {
              input: "$lastMonthSameRangeTickets",
              as: "t",
              in: {
                $cond: [
                  { $gt: ["$$t.noOfVehicles", 0] },
                  "$$t.noOfVehicles",
                  { $size: { $ifNull: ["$$t.vehicleNumbers", []] } },
                ],
              },
            },
          },
        },
        totalCustomerChargesLastMonth: {
          $sum: "$lastMonthSameRangeTickets.totalCustomerCharges",
        },
        ticketCountLastMonth: { $size: "$lastMonthSameRangeTickets" },

        totalVehiclesLastMonthTotal: {
          $sum: {
            $map: {
              input: "$lastMonthFullTickets",
              as: "t",
              in: {
                $cond: [
                  { $gt: ["$$t.noOfVehicles", 0] },
                  "$$t.noOfVehicles",
                  { $size: { $ifNull: ["$$t.vehicleNumbers", []] } },
                ],
              },
            },
          },
        },
        totalCustomerChargesLastMonthTotal: {
          $sum: "$lastMonthFullTickets.totalCustomerCharges",
        },

        lastToLastMonthVehicleTotal: {
          $sum: {
            $map: {
              input: "$lastToLastMonthTickets",
              as: "t",
              in: {
                $cond: [
                  { $gt: ["$$t.noOfVehicles", 0] },
                  "$$t.noOfVehicles",
                  { $size: { $ifNull: ["$$t.vehicleNumbers", []] } },
                ],
              },
            },
          },
        },

        totalVehiclesFY: {
          $sum: {
            $map: {
              input: "$fyTickets",
              as: "t",
              in: {
                $cond: [
                  { $gt: ["$$t.noOfVehicles", 0] },
                  "$$t.noOfVehicles",
                  { $size: { $ifNull: ["$$t.vehicleNumbers", []] } },
                ],
              },
            },
          },
        },
        totalCustomerChargesFY: {
          $sum: "$fyTickets.totalCustomerCharges",
        },
        ticketCountFY: { $size: "$fyTickets" },
      },
    },
    // 🔥 NEW: Fleet Size and Performance Ratio
    {
      $lookup: {
        from: "maindatas",
        localField: "_id",
        foreignField: "company",
        as: "fleet",
      },
    },
    {
      $addFields: {
        totalFleetSize: { $size: "$fleet" },
      },
    },
    {
      $addFields: {
        avgVehiclesPerMonthFY: {
          $cond: [
            { $gt: ["$totalFleetSize", 0] },
            { $divide: ["$totalVehiclesFY", "$totalFleetSize"] },
            0,
          ],
        },
        avgCustomerChargesPerMonthFY: {
          $cond: [
            { $gt: [monthsElapsedInFY, 0] },
            { $divide: ["$totalCustomerChargesFY", monthsElapsedInFY] },
            0,
          ],
        },
      },
    },

    // Cleanup
    {
      $project: {
        tickets: 0,
        currentMonthTickets: 0,
        lastMonthSameRangeTickets: 0,
        lastMonthFullTickets: 0,
        fyTickets: 0,
      },
    },
  ];

  // === Fetch Zone Data for Key Clients from Tickets' Assignees ===
  const keyClientZoneDataPipeLine = [
    { $match: { keyClient: true } },
    {
      $lookup: {
        from: "tickets",
        let: { clientId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$qstClientName", "$$clientId"] },
                  { $ne: ["$ticketStatus", "work done"] },
                ],
              },
            },
          },
          { $project: { assignee: 1 } },
        ],
        as: "tickets",
      },
    },
    { $unwind: "$tickets" },
    {
      $lookup: {
        from: "employees",
        localField: "tickets.assignee",
        foreignField: "_id",
        as: "emp",
      },
    },
    { $unwind: "$emp" },
    {
      $group: {
        _id: "$_id",
        distinctZones: { $addToSet: "$emp.zone" },
      },
    },
  ];

  const allClientSingleStatsPipeline = [
    {
      $lookup: {
        from: "tickets",
        localField: "_id",
        foreignField: "qstClientName",
        as: "tickets",
      },
    },
    { $unwind: "$tickets" },
    {
      $match: {
        // 'tickets.isTicketClosed': true,
        "tickets.ticketStatus": "work done",
        //  'tickets.technician': { $ne: null }  // ← ADD THIS LINE
        "tickets.technician": { $type: "objectId" },
        "tickets.taskType": { $ne: installationTaskId },
      },
    },
    {
      $group: {
        _id: null,
        // Current month
        // totalVehiclesThisMonth: {
        //   $sum: {
        //     $cond: [
        //       {
        //         $and: [
        //           { $gte: ['$tickets.ticketAvailabilityDate', startOfCurrentMonth] },
        //           { $lte: ['$tickets.ticketAvailabilityDate', today] }
        //         ]
        //       },
        //       '$tickets.noOfVehicles',
        //       0
        //     ]
        //   }
        // },

        totalVehiclesThisMonth: {
          $sum: {
            $cond: [
              {
                $and: [
                  {
                    $gte: [
                      "$tickets.ticketAvailabilityDate",
                      startOfCurrentMonth,
                    ],
                  },
                  { $lte: ["$tickets.ticketAvailabilityDate", today] },
                ],
              },
              {
                $cond: [
                  { $gt: ["$tickets.noOfVehicles", 0] },
                  "$tickets.noOfVehicles",
                  { $size: { $ifNull: ["$tickets.vehicleNumbers", []] } },
                ],
              },
              0,
            ],
          },
        },

        totalCustomerChargesThisMonth: {
          $sum: {
            $cond: [
              {
                $and: [
                  {
                    $gte: [
                      "$tickets.ticketAvailabilityDate",
                      startOfCurrentMonth,
                    ],
                  },
                  { $lte: ["$tickets.ticketAvailabilityDate", today] },
                ],
              },
              "$tickets.totalCustomerCharges",
              0,
            ],
          },
        },
        // Last month same date range
        // totalVehiclesLastMonth: {
        //   $sum: {
        //     $cond: [
        //       {
        //         $and: [
        //           { $gte: ['$tickets.ticketAvailabilityDate', lastMonth] },
        //           { $lte: ['$tickets.ticketAvailabilityDate', sameDayLastMonth] }
        //         ]
        //       },
        //       '$tickets.noOfVehicles',
        //       0
        //     ]
        //   }
        // },

        totalVehiclesLastMonth: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gte: ["$tickets.ticketAvailabilityDate", lastMonth] },
                  {
                    $lte: ["$tickets.ticketAvailabilityDate", sameDayLastMonth],
                  },
                ],
              },
              {
                $cond: [
                  { $gt: ["$tickets.noOfVehicles", 0] },
                  "$tickets.noOfVehicles",
                  { $size: { $ifNull: ["$tickets.vehicleNumbers", []] } },
                ],
              },
              0,
            ],
          },
        },

        totalCustomerChargesLastMonth: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gte: ["$tickets.ticketAvailabilityDate", lastMonth] },
                  {
                    $lte: ["$tickets.ticketAvailabilityDate", sameDayLastMonth],
                  },
                ],
              },
              "$tickets.totalCustomerCharges",
              0,
            ],
          },
        },
        // Full last month totals
        // totalVehiclesLastMonthTotal: {
        //   $sum: {
        //     $cond: [
        //       {
        //         $and: [
        //           { $gte: ['$tickets.ticketAvailabilityDate', lastMonth] },
        //           { $lte: ['$tickets.ticketAvailabilityDate', lastMonthFullEnd] }
        //         ]
        //       },
        //       '$tickets.noOfVehicles',
        //       0
        //     ]
        //   }
        // },

        totalVehiclesLastMonthTotal: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gte: ["$tickets.ticketAvailabilityDate", lastMonth] },
                  {
                    $lte: ["$tickets.ticketAvailabilityDate", lastMonthFullEnd],
                  },
                ],
              },
              {
                $cond: [
                  { $gt: ["$tickets.noOfVehicles", 0] },
                  "$tickets.noOfVehicles",
                  { $size: { $ifNull: ["$tickets.vehicleNumbers", []] } },
                ],
              },
              0,
            ],
          },
        },

        totalCustomerChargesLastMonthTotal: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gte: ["$tickets.ticketAvailabilityDate", lastMonth] },
                  {
                    $lte: ["$tickets.ticketAvailabilityDate", lastMonthFullEnd],
                  },
                ],
              },
              "$tickets.totalCustomerCharges",
              0,
            ],
          },
        },

        lastToLastMonthVehicleTotal: {
          $sum: {
            $cond: [
              {
                $and: [
                  {
                    $gte: [
                      "$tickets.ticketAvailabilityDate",
                      lastToLastMonthStart,
                    ],
                  },
                  {
                    $lte: [
                      "$tickets.ticketAvailabilityDate",
                      lastToLastMonthEnd,
                    ],
                  },
                ],
              },
              {
                $cond: [
                  { $gt: ["$tickets.noOfVehicles", 0] },
                  "$tickets.noOfVehicles",
                  { $size: { $ifNull: ["$tickets.vehicleNumbers", []] } },
                ],
              },
              0,
            ],
          },
        },
        lastToLastMonthVehicleTotalCustomerCharges: {
          $sum: {
            $cond: [
              {
                $and: [
                  {
                    $gte: [
                      "$tickets.ticketAvailabilityDate",
                      lastToLastMonthStart,
                    ],
                  },
                  {
                    $lte: [
                      "$tickets.ticketAvailabilityDate",
                      lastToLastMonthEnd,
                    ],
                  },
                ],
              },
              "$tickets.totalCustomerCharges",
              0,
            ],
          },
        },

        // FY totals
        // totalVehiclesFY: {
        //   $sum: {
        //     $cond: [
        //       {
        //         $and: [
        //           { $gte: ['$tickets.ticketAvailabilityDate', financialYearStart] },
        //           { $lte: ['$tickets.ticketAvailabilityDate', today] }
        //         ]
        //       },
        //       '$tickets.noOfVehicles',
        //       0
        //     ]
        //   }
        // },

        totalVehiclesFY: {
          $sum: {
            $cond: [
              {
                $and: [
                  {
                    $gte: [
                      "$tickets.ticketAvailabilityDate",
                      financialYearStart,
                    ],
                  },
                  { $lte: ["$tickets.ticketAvailabilityDate", today] },
                ],
              },
              {
                $cond: [
                  { $gt: ["$tickets.noOfVehicles", 0] },
                  "$tickets.noOfVehicles",
                  { $size: { $ifNull: ["$tickets.vehicleNumbers", []] } },
                ],
              },
              0,
            ],
          },
        },
        totalCustomerChargesFY: {
          $sum: {
            $cond: [
              {
                $and: [
                  {
                    $gte: [
                      "$tickets.ticketAvailabilityDate",
                      financialYearStart,
                    ],
                  },
                  { $lte: ["$tickets.ticketAvailabilityDate", today] },
                ],
              },
              "$tickets.totalCustomerCharges",
              0,
            ],
          },
        },
      },
    },
    {
      $lookup: {
        from: "qstclients",
        pipeline: [{ $match: { keyClient: true } }, { $project: { _id: 1 } }],
        as: "allKeyClients",
      },
    },
    {
      $lookup: {
        from: "maindatas",
        let: { clientIds: "$allKeyClients._id" },
        pipeline: [
          { $match: { $expr: { $in: ["$company", "$$clientIds"] } } },
          { $count: "count" },
        ],
        as: "fleetSize",
      },
    },
    {
      $addFields: {
        totalFleetSizeCombined: {
          $ifNull: [{ $arrayElemAt: ["$fleetSize.count", 0] }, 0],
        },
      },
    },
    {
      $addFields: {
        avgVehiclesPerMonthFY: {
          $cond: [
            { $gt: ["$totalFleetSizeCombined", 0] },
            { $divide: ["$totalVehiclesFY", "$totalFleetSizeCombined"] },
            0,
          ],
        },
        avgCustomerChargesPerMonthFY: {
          $cond: [
            { $gt: [monthsElapsedInFY, 0] },
            { $divide: ["$totalCustomerChargesFY", monthsElapsedInFY] },
            0,
          ],
        },
      },
    },
  ];

  // === Aggregation for All Clients (Financial Year Totals) ===
  const allClientFYTotalsPipeline = [
    {
      $lookup: {
        from: "tickets",
        localField: "_id",
        foreignField: "qstClientName",
        as: "tickets",
      },
    },
    {
      $unwind: "$tickets",
    },
    {
      $match: {
        // 'tickets.isTicketClosed': true,
        "tickets.ticketStatus": "work done",
        // 'tickets.technician': { $ne: null },  // ← ADD THIS LINE
        "tickets.technician": { $type: "objectId" },
        "tickets.ticketAvailabilityDate": {
          $gte: financialYearStart,
          $lte: today,
        },
      },
    },
    {
      $group: {
        _id: null,
        // totalVehiclesFYAllClients: { $sum: '$tickets.noOfVehicles' },
        totalVehiclesFYAllClients: {
          $sum: {
            $cond: [
              { $gt: ["$tickets.noOfVehicles", 0] },
              "$tickets.noOfVehicles",
              { $size: { $ifNull: ["$tickets.vehicleNumbers", []] } },
            ],
          },
        },
        totalCustomerChargesFYAllClients: {
          $sum: "$tickets.totalCustomerCharges",
        },
        ticketCountFYAllClients: { $sum: 1 },
      },
    },
  ];

  // === Fetch Key Client Vehicles Summary (Work Done && Task != Installation) ===
  const keyClientSummaryPipeline = [
    { $match: { keyClient: true } },
    {
      $lookup: {
        from: "tickets",
        let: { clientId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$qstClientName", "$$clientId"] },
                  { $eq: ["$ticketStatus", "work done"] },
                  { $ne: ["$taskType", installationTaskId] },
                  { $eq: [{ $type: "$technician" }, "objectId"] },
                  { $gte: ["$ticketAvailabilityDate", lastToLastMonthStart] },
                  { $lte: ["$ticketAvailabilityDate", today] },
                ],
              },
            },
          },
        ],
        as: "tickets",
      },
    },
    { $unwind: "$tickets" },
    {
      $group: {
        _id: null,
        thisMonth: {
          $sum: {
            $cond: [
              {
                $gte: ["$tickets.ticketAvailabilityDate", startOfCurrentMonth],
              },
              {
                $cond: [
                  { $gt: ["$tickets.noOfVehicles", 0] },
                  "$tickets.noOfVehicles",
                  { $size: { $ifNull: ["$tickets.vehicleNumbers", []] } },
                ],
              },
              0,
            ],
          },
        },
        lastMonth: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gte: ["$tickets.ticketAvailabilityDate", lastMonth] },
                  {
                    $lte: ["$tickets.ticketAvailabilityDate", lastMonthFullEnd],
                  },
                ],
              },
              {
                $cond: [
                  { $gt: ["$tickets.noOfVehicles", 0] },
                  "$tickets.noOfVehicles",
                  { $size: { $ifNull: ["$tickets.vehicleNumbers", []] } },
                ],
              },
              0,
            ],
          },
        },
        lastToLastMonth: {
          $sum: {
            $cond: [
              {
                $and: [
                  {
                    $gte: [
                      "$tickets.ticketAvailabilityDate",
                      lastToLastMonthStart,
                    ],
                  },
                  {
                    $lte: [
                      "$tickets.ticketAvailabilityDate",
                      lastToLastMonthEnd,
                    ],
                  },
                ],
              },
              {
                $cond: [
                  { $gt: ["$tickets.noOfVehicles", 0] },
                  "$tickets.noOfVehicles",
                  { $size: { $ifNull: ["$tickets.vehicleNumbers", []] } },
                ],
              },
              0,
            ],
          },
        },
      },
    },
  ];

  const [
    keyClientData,
    keyClientZoneData,
    allClientSingleStats,
    allClientFYTotals,
    keyClientVehiclesSummaryResult,
  ] = await Promise.all([
    QstClient.aggregate(keyClientPipeline),
    QstClient.aggregate(keyClientZoneDataPipeLine),
    QstClient.aggregate(allClientSingleStatsPipeline),
    QstClient.aggregate(allClientFYTotalsPipeline),
    QstClient.aggregate(keyClientSummaryPipeline),
  ]);

  const keyClientVehiclesSummary = keyClientVehiclesSummaryResult[0] || {
    thisMonth: 0,
    lastMonth: 0,
    lastToLastMonth: 0,
  };

  // Create a map of client ID to zones for easy lookup
  const clientZoneMap = {};
  keyClientZoneData.forEach((item) => {
    if (item.distinctZones && item.distinctZones.length > 0) {
      // Join all distinct zones into a comma-separated string
      clientZoneMap[item._id.toString()] =
        item.distinctZones.filter((z) => z && z !== "").join(", ") || "N/A";
    } else {
      clientZoneMap[item._id.toString()] = "N/A";
    }
  });

  // Add zone data to keyClientData
  const keyClientDataWithZones = keyClientData.map((client) => ({
    ...client,
    zone: clientZoneMap[client._id.toString()] || "N/A",
  }));

  // === Fetch All Clients Aggregation ===
  // const allClientData = await QstClient.aggregate([
  //   {
  //     $lookup: {
  //       from: "tickets",
  //       localField: "_id",
  //       foreignField: "qstClientName",
  //       as: "tickets",
  //     },
  //   },
  //   {
  //     $project: {
  //       companyName: 1,
  //       companyShortName: 1,
  //       tickets: {
  //         $filter: {
  //           input: "$tickets",
  //           as: "ticket",
  //           cond: {
  //             $and: [
  //               // { $eq: ['$$ticket.isTicketClosed', true] },
  //               { $eq: ["$$ticket.ticketStatus", "work done"] },
  //               // { $ne: ['$$ticket.technician', null] }  // ← ADD THIS LINE
  //               { $eq: [{ $type: "$$ticket.technician" }, "objectId"] },
  //             ],
  //           },
  //         },
  //       },
  //     },
  //   },
  //   {
  //     $project: {
  //       companyName: 1,
  //       companyShortName: 1,
  //       currentMonthTickets: {
  //         $filter: {
  //           input: "$tickets",
  //           as: "t",
  //           cond: {
  //             $and: [
  //               { $gte: ["$$t.ticketAvailabilityDate", startOfCurrentMonth] },
  //               { $lte: ["$$t.ticketAvailabilityDate", today] },
  //               // { $gte: ['$$t.createdAt', startOfCurrentMonth] },
  //               // { $lte: ['$$t.createdAt', today] }
  //             ],
  //           },
  //         },
  //       },
  //       lastMonthSameRangeTickets: {
  //         $filter: {
  //           input: "$tickets",
  //           as: "t",
  //           cond: {
  //             $and: [
  //               { $gte: ["$$t.ticketAvailabilityDate", lastMonth] },
  //               { $lte: ["$$t.ticketAvailabilityDate", sameDayLastMonth] },
  //               // { $gte: ['$$t.createdAt', lastMonth] },
  //               // { $lte: ['$$t.createdAt', sameDayLastMonth] }
  //             ],
  //           },
  //         },
  //       },
  //       lastMonthFullTickets: {
  //         $filter: {
  //           input: "$tickets",
  //           as: "t",
  //           cond: {
  //             $and: [
  //               { $gte: ["$$t.ticketAvailabilityDate", lastMonth] },
  //               { $lte: ["$$t.ticketAvailabilityDate", lastMonthFullEnd] },
  //             ],
  //           },
  //         },
  //       },

  //       fyTickets: {
  //         $filter: {
  //           input: "$tickets",
  //           as: "t",
  //           cond: {
  //             $and: [
  //               { $gte: ["$$t.ticketAvailabilityDate", financialYearStart] },
  //               { $lte: ["$$t.ticketAvailabilityDate", today] },
  //             ],
  //           },
  //         },
  //       },
  //     },
  //   },
  //   {
  //     $addFields: {
  //       // totalVehiclesThisMonth: { $sum: '$currentMonthTickets.noOfVehicles' },
  //       totalVehiclesThisMonth: {
  //         $sum: {
  //           $map: {
  //             input: "$currentMonthTickets",
  //             as: "t",
  //             in: {
  //               $cond: [
  //                 { $gt: ["$$t.noOfVehicles", 0] },
  //                 "$$t.noOfVehicles",
  //                 { $size: { $ifNull: ["$$t.vehicleNumbers", []] } },
  //               ],
  //             },
  //           },
  //         },
  //       },
  //       totalCustomerChargesThisMonth: {
  //         $sum: "$currentMonthTickets.totalCustomerCharges",
  //       },
  //       // totalVehiclesLastMonth: { $sum: '$lastMonthSameRangeTickets.noOfVehicles' },

  //       totalVehiclesLastMonth: {
  //         $sum: {
  //           $map: {
  //             input: "$lastMonthSameRangeTickets",
  //             as: "t",
  //             in: {
  //               $cond: [
  //                 { $gt: ["$$t.noOfVehicles", 0] },
  //                 "$$t.noOfVehicles",
  //                 { $size: { $ifNull: ["$$t.vehicleNumbers", []] } },
  //               ],
  //             },
  //           },
  //         },
  //       },
  //       totalCustomerChargesLastMonth: {
  //         $sum: "$lastMonthSameRangeTickets.totalCustomerCharges",
  //       },
  //       // totalVehiclesFY: { $sum: '$fyTickets.noOfVehicles' },
  //       totalVehiclesFY: {
  //         $sum: {
  //           $map: {
  //             input: "$fyTickets",
  //             as: "t",
  //             in: {
  //               $cond: [
  //                 { $gt: ["$$t.noOfVehicles", 0] },
  //                 "$$t.noOfVehicles",
  //                 { $size: { $ifNull: ["$$t.vehicleNumbers", []] } },
  //               ],
  //             },
  //           },
  //         },
  //       },
  //       totalCustomerChargesFY: { $sum: "$fyTickets.totalCustomerCharges" },
  //       // totalVehiclesLastMonthTotal: { $sum: '$lastMonthFullTickets.noOfVehicles' },

  //       totalVehiclesLastMonthTotal: {
  //         $sum: {
  //           $map: {
  //             input: "$lastMonthFullTickets",
  //             as: "t",
  //             in: {
  //               $cond: [
  //                 { $gt: ["$$t.noOfVehicles", 0] },
  //                 "$$t.noOfVehicles",
  //                 { $size: { $ifNull: ["$$t.vehicleNumbers", []] } },
  //               ],
  //             },
  //           },
  //         },
  //       },
  //       totalCustomerChargesLastMonthTotal: {
  //         $sum: "$lastMonthFullTickets.totalCustomerCharges",
  //       },
  //       // avgVehiclesPerMonthFY: monthsElapsedInFY > 0
  //       //   ? { $divide: [{ $sum: '$fyTickets.noOfVehicles' }, monthsElapsedInFY] }
  //       //   : 0,
  //       // avgCustomerChargesPerMonthFY: monthsElapsedInFY > 0
  //       //   ? { $divide: [{ $sum: '$fyTickets.totalCustomerCharges' }, monthsElapsedInFY] }
  //       //   : 0

  //       avgVehiclesPerMonthFY:
  //         monthsElapsedInFY > 0
  //           ? { $divide: ["$totalVehiclesFY", monthsElapsedInFY] }
  //           : 0,

  //       avgCustomerChargesPerMonthFY:
  //         monthsElapsedInFY > 0
  //           ? { $divide: ["$totalCustomerChargesFY", monthsElapsedInFY] }
  //           : 0,
  //     },
  //   },
  //   {
  //     $project: {
  //       currentMonthTickets: 0,
  //       lastMonthSameRangeTickets: 0,
  //       fyTickets: 0,
  //     },
  //   },
  // ]);

  // === Single Row Stats for All Clients ===

  const totalStats = allClientFYTotals[0] || {
    totalVehiclesFYAllClients: 0,
    totalCustomerChargesFYAllClients: 0,
    ticketCountFYAllClients: 0,
  };

  // Add monthly averages for all clients
  totalStats.avgVehiclesPerMonthFYAllClients =
    monthsElapsedInFY > 0
      ? totalStats.totalVehiclesFYAllClients / monthsElapsedInFY
      : 0;

  totalStats.avgCustomerChargesPerMonthFYAllClients =
    monthsElapsedInFY > 0
      ? totalStats.totalCustomerChargesFYAllClients / monthsElapsedInFY
      : 0;

  const debugTechnicianData = async () => {
    const {
      startOfCurrentMonth,
      endOfCurrentMonth,
      startOfLastMonth,
      endOfLastMonthFull,
    } = getTechnicianDateRanges();

    // Debug: Count tickets directly (like Technician API)
    const directTicketCount = await Ticket.aggregate([
      {
        $match: {
          ticketAvailabilityDate: {
            $gte: startOfLastMonth,
            $lte: endOfLastMonthFull,
          },
          ticketStatus: "work done",
          technician: { $type: "objectId" },
        },
      },
      {
        $group: {
          _id: null,
          totalVehicles: {
            $sum: {
              $cond: [
                { $gt: ["$noOfVehicles", 0] },
                "$noOfVehicles",
                { $size: { $ifNull: ["$vehicleNumbers", []] } },
              ],
            },
          },
          ticketCount: { $sum: 1 },
        },
      },
    ]);

    console.log("DIRECT TICKET COUNT:", directTicketCount[0]);
    return directTicketCount[0];
  };

  // Run the debug
  // const debugResult = await debugTechnicianData();
  // console.log("=== DEBUG RESULTS ===");
  // console.log(
  //   "Direct ticket vehicles (Technician API method):",
  //   debugResult?.totalVehicles || 0
  // );
  // console.log(
  //   "Client API vehicles (allClientSingleStats):",
  //   allClientSingleStats[0]?.totalVehiclesLastMonthTotal || 0
  // );
  // console.log(
  //   "Difference:",
  //   (allClientSingleStats[0]?.totalVehiclesLastMonthTotal || 0) -
  //     (debugResult?.totalVehicles || 0)
  // );
  // console.log("=====================");

  return res.json({
    message: "Key and all client stats fetched successfully",
    data: keyClientDataWithZones,
    //  allClientData,
    allClientStatsSingleRow: allClientSingleStats[0] || {},
    totalStatsForAllClients: totalStats,
    keyClientVehiclesSummary,
    financialYearInfo: {
      startDate: financialYearStart,
      monthsElapsed: monthsElapsedInFY,
      currentMonth: today.getMonth() + 1, // 1-12
    },
  });
};

const getTechnicianDateRanges = () => {
  const now = new Date();

  // current month MTD
  const startOfCurrentMonth = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
    0,
    0,
    0,
    0,
  );
  const endOfCurrentMonth = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  );

  // last month MTD (handles months with fewer days)
  const daysInLastMonth = new Date(
    now.getFullYear(),
    now.getMonth(),
    0,
  ).getDate();
  const lastMonthDay = Math.min(now.getDate(), daysInLastMonth);
  const startOfLastMonth = new Date(
    now.getFullYear(),
    now.getMonth() - 1,
    1,
    0,
    0,
    0,
    0,
  );
  const endOfLastMonthTillDate = new Date(
    now.getFullYear(),
    now.getMonth() - 1,
    lastMonthDay,
    23,
    59,
    59,
    999,
  );

  // full previous month (e.g. 1 Sep → 30 Sep if today is 1 Oct)
  const endOfLastMonthFull = new Date(
    now.getFullYear(),
    now.getMonth(),
    0,
    23,
    59,
    59,
    999,
  );

  return {
    now,
    startOfCurrentMonth,
    endOfCurrentMonth,
    startOfLastMonth,
    endOfLastMonthTillDate,
    endOfLastMonthFull,
  };
};

// ---- Core aggregation for one window ----
const aggregateTechStats = async (startDate, endDate) => {
  const pipeline = [
    {
      $match: {
        ticketAvailabilityDate: { $gte: startDate, $lte: endDate },
        ticketStatus: "work done",
        technician: { $type: "objectId" },
      },
    },
    {
      $lookup: {
        from: "technicians",
        localField: "technician",
        foreignField: "_id",
        as: "tech",
      },
    },
    {
      $group: {
        _id: {
          $ifNull: [
            { $arrayElemAt: ["$tech.technicianCategoryType", 0] },
            "unknown",
          ],
        },
        vehicles: {
          $sum: {
            $cond: [
              { $gt: ["$noOfVehicles", 0] },
              "$noOfVehicles",
              { $size: { $ifNull: ["$vehicleNumbers", []] } },
            ],
          },
        },
        charges: {
          $sum: { $ifNull: ["$totalTechCharges", 0] },
        },
        ticketIds: { $addToSet: "$_id" },
        technicianIds: { $addToSet: "$technician" },
        ticketDetails: {
          $push: {
            ticketId: "$_id",
            ticketSKUId: "$ticketSKUId",
            noOfVehicles: "$noOfVehicles",
            vehicleNumbers: "$vehicleNumbers",
            technicianId: "$technician",
            technicianName: { $arrayElemAt: ["$tech.name", 0] },
            technicianCategory: {
              $arrayElemAt: ["$tech.technicianCategoryType", 0],
            },
            subjectLine: "$subjectLine",
            ticketAvailabilityDate: "$ticketAvailabilityDate",
          },
        },
      },
    },
  ];

  const rows = await Ticket.aggregate(pipeline);

  const byCat = rows.reduce((acc, r) => {
    acc[r._id] = r;
    return acc;
  }, {});

  return {
    vehiclesByPayrollTechnicians: byCat.payroll?.vehicles || 0,
    vehiclesByFreelanceTechnicians: byCat.freelance?.vehicles || 0,
    vehiclesByUnknownTechnicians: byCat.unknown?.vehicles || 0,
    chargesOfFreelanceTechnicians: byCat.freelance?.charges || 0,

    // NEW: Include detailed ticket information for each category
    ticketDetails: {
      payroll: byCat.payroll?.ticketDetails || [],
      freelance: byCat.freelance?.ticketDetails || [],
      unknown: byCat.unknown?.ticketDetails || [],
    },
  };
};

// ---- Controller ----
const getTechnicianStats = async (req, res) => {
  try {
    const {
      startOfCurrentMonth,
      endOfCurrentMonth,
      startOfLastMonth,
      endOfLastMonthTillDate,
      endOfLastMonthFull,
    } = getTechnicianDateRanges();

    // Get current date for "till date" calculations
    const currentDate = new Date();

    // Calculate start of current month till date
    const startOfCurrentMonthTillDate = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      1,
    );

    // Calculate start of last month till same date last month
    const lastMonthSameDate = new Date(currentDate);
    lastMonthSameDate.setMonth(lastMonthSameDate.getMonth() - 1);
    const startOfLastMonthTillDate = new Date(
      lastMonthSameDate.getFullYear(),
      lastMonthSameDate.getMonth(),
      1,
    );
    const endOfLastMonthTillSameDate = new Date(
      lastMonthSameDate.getFullYear(),
      lastMonthSameDate.getMonth(),
      currentDate.getDate(),
      23,
      59,
      59,
      999,
    );

    const [
      currentMonth,
      lastMonth,
      lastMonthTotal,
      currentMonthTillDateTechs,
      lastMonthTillDateTechs,
    ] = await Promise.all([
      aggregateTechStats(startOfCurrentMonth, endOfCurrentMonth),
      aggregateTechStats(startOfLastMonth, endOfLastMonthTillDate),
      aggregateTechStats(startOfLastMonth, endOfLastMonthFull),
      // Count new technicians for current month till date
      Technician.countDocuments({
        createdAt: {
          $gte: startOfCurrentMonthTillDate,
          $lte: currentDate,
        },
      }),
      // Count new technicians for last month till same date
      Technician.countDocuments({
        createdAt: {
          $gte: startOfLastMonthTillDate,
          $lte: endOfLastMonthTillSameDate,
        },
      }),
    ]);

    // === ADD DEBUG HERE ===
    const debugDirectCount = await Ticket.aggregate([
      {
        $match: {
          ticketAvailabilityDate: {
            $gte: startOfLastMonth,
            $lte: endOfLastMonthFull,
          },
          ticketStatus: "work done",
          technician: { $type: "objectId" },
        },
      },
      {
        $group: {
          _id: null,
          totalVehicles: {
            $sum: {
              $cond: [
                { $gt: ["$noOfVehicles", 0] },
                "$noOfVehicles",
                { $size: { $ifNull: ["$vehicleNumbers", []] } },
              ],
            },
          },
        },
      },
    ]);

    console.log(
      "TECHNICIAN DEBUG - Direct count:",
      debugDirectCount[0]?.totalVehicles || 0,
    );
    console.log(
      "TECHNICIAN DEBUG - Through aggregation:",
      lastMonthTotal.vehiclesByPayrollTechnicians +
      lastMonthTotal.vehiclesByFreelanceTechnicians,
    );
    console.log(
      "TECHNICIAN DEBUG - Through aggregation:",
      lastMonthTotal.vehiclesByPayrollTechnicians +
      lastMonthTotal.vehiclesByFreelanceTechnicians +
      (lastMonthTotal.vehiclesByUnknownTechnicians || 0),
    );

    const debugDates = () => {
      const techRanges = getTechnicianDateRanges();
      console.log("=== DATE COMPARISON ===");
      console.log(
        "Technician API - Last Month Full:",
        techRanges.startOfLastMonth,
        "to",
        techRanges.endOfLastMonthFull,
      );
      console.log(
        "Client API - Last Month Full:",
        lastMonth,
        "to",
        lastMonthFullEnd,
      );
      console.log("========================");
    };
    // (optional) also return the technician lists so you "see proper IDs"
    const techs = await Technician.find(
      {},
      { _id: 1, name: 1, technicianCategoryType: 1 },
    ).lean();

    res.status(200).json({
      currentMonth,
      lastMonth,
      lastMonthTotal,
      newTechnicians: {
        currentMonthTillDate: currentMonthTillDateTechs,
        lastMonthTillDate: lastMonthTillDateTechs,
      },
      // technicians: {
      //   payroll: techs.filter(t => t.technicianCategoryType === 'payroll'),
      //   freelance: techs.filter(t => t.technicianCategoryType === 'freelance'),
      // },
      meta: {
        windows: {
          currentMonth: { start: startOfCurrentMonth, end: endOfCurrentMonth },
          lastMonth: { start: startOfLastMonth, end: endOfLastMonthTillDate },
        },
      },
    });
  } catch (err) {
    console.error("Error fetching technician stats:", err);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

// /----------------------------------------------------------------------------------

function startOfDay(d) {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function endOfDay(d) {
  const dt = new Date(d);
  dt.setHours(23, 59, 59, 999);
  return dt;
}

function addDays(d, n) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt;
}

function startOfWeek(d) {
  const dt = startOfDay(d);
  const day = dt.getDay(); // 0 = Sun .. 6 = Sat
  const diff = (day + 6) % 7; // shift so Monday = 0
  dt.setDate(dt.getDate() - diff);
  return startOfDay(dt);
}

function endOfMonth(d) {
  const dt = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return endOfDay(dt);
}

function startOfMonth(d) {
  const dt = new Date(d.getFullYear(), d.getMonth(), 1);
  return startOfDay(dt);
}

const getVehicalsData = async (req, res) => {
  try {
    const now = new Date();
    const todayStart = startOfDay(new Date());
    const todayEnd = endOfDay(new Date());

    // ✅ Date ranges
    const yesterdayStart = startOfDay(addDays(todayStart, -1));
    const yesterdayEnd = endOfDay(addDays(todayStart, -1));

    //     const thisWeekStart = startOfDay(addDays(todayStart, -todayStart.getDay()));
    //     const thisWeekEnd = todayEnd;

    //     // Wednesday: getDay() returns 3 (0=Sunday, 1=Monday, etc.)
    // // thisWeekStart = Sunday, weak start from sunday to saturdays

    //     const lastWeekStart = startOfDay(addDays(thisWeekStart, -7));
    //     const lastWeekEnd = endOfDay(addDays(thisWeekStart, -1));

    // Week starts on Monday and ends on Sunday
    const dayOfWeek = todayStart.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

    const thisWeekStart = startOfDay(addDays(todayStart, diffToMonday));
    const thisWeekEnd = endOfDay(addDays(thisWeekStart, 6));

    const lastWeekStart = startOfDay(addDays(thisWeekStart, -7));
    const lastWeekEnd = endOfDay(addDays(thisWeekStart, -1));

    const thisMonthStart = new Date(
      todayStart.getFullYear(),
      todayStart.getMonth(),
      1,
    );
    const thisMonthEnd = todayEnd;

    const lastMonthStart = new Date(
      todayStart.getFullYear(),
      todayStart.getMonth() - 1,
      1,
    );
    const lastMonthEnd = new Date(
      todayStart.getFullYear(),
      todayStart.getMonth(),
      0,
      23,
      59,
      59,
      999,
    );

    // ✅ Planned ranges
    const plannedtodayStart = todayStart;
    const plannedtodayEnd = todayEnd;
    const plannedTomorrowStart = startOfDay(addDays(todayStart, 1));
    const plannedTomorrowEnd = endOfDay(addDays(todayStart, 1));
    const plannedDayAfterStart = startOfDay(addDays(todayStart, 2));
    const plannedDayAfterEnd = endOfDay(addDays(todayStart, 2));

    // Zones that you show in UI
    const zones = ["north", "east", "west1", "west2", "south"];

    const last7DaysStart = startOfDay(addDays(todayStart, -6)); // includes today
    const last7DaysEnd = todayEnd;

    // ✅ Vehicles Done aggregation
    const vehiclesDoneAgg = await Ticket.aggregate([
      {
        $match: {
          ticketAvailabilityDate: { $ne: null },
          ticketStatus: "work done",
          // isTicketClosed: true
        },
      },
      {
        $lookup: {
          from: "employees",
          localField: "assignee",
          foreignField: "_id",
          as: "assigneeDoc",
        },
      },
      { $unwind: { path: "$assigneeDoc", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          zone: { $ifNull: ["$assigneeDoc.zone", "Unknown"] },
          tad: "$ticketAvailabilityDate",
        },
      },
      {
        $group: {
          _id: "$zone",
          // today: {
          //   $sum: {
          //     $cond: [{ $and: [{ $gte: ["$tad", todayStart] }, { $lt: ["$tad", todayEnd] }] }, 1, 0],
          //   },
          // },
          // yesterday: {
          //   $sum: {
          //     $cond: [{ $and: [{ $gte: ["$tad", yesterdayStart] }, { $lt: ["$tad", yesterdayEnd] }] }, 1, 0],
          //   },
          // },
          // thisWeek: {
          //   $sum: {
          //     $cond: [{ $and: [{ $gte: ["$tad", thisWeekStart] }, { $lt: ["$tad", thisWeekEnd] }] }, 1, 0],
          //   },
          // },
          // lastWeek: {
          //   $sum: {
          //     $cond: [{ $and: [{ $gte: ["$tad", lastWeekStart] }, { $lt: ["$tad", lastWeekEnd] }] }, 1, 0],
          //   },
          // },
          // thisMonth: {
          //   $sum: {
          //     $cond: [{ $and: [{ $gte: ["$tad", thisMonthStart] }, { $lte: ["$tad", thisMonthEnd] }] }, 1, 0],
          //   },
          // },
          // lastMonth: {
          //   $sum: {
          //     $cond: [{ $and: [{ $gte: ["$tad", lastMonthStart] }, { $lte: ["$tad", lastMonthEnd] }] }, 1, 0],
          //   },
          // },
          today: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$tad", todayStart] },
                    { $lt: ["$tad", todayEnd] },
                  ],
                },
                "$noOfVehicles",
                0,
              ],
            },
          },
          yesterday: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$tad", yesterdayStart] },
                    { $lt: ["$tad", yesterdayEnd] },
                  ],
                },
                "$noOfVehicles",
                0,
              ],
            },
          },

          last7Days: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$tad", last7DaysStart] },
                    { $lte: ["$tad", last7DaysEnd] },
                  ],
                },
                "$noOfVehicles",
                0,
              ],
            },
          },

          thisWeek: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$tad", thisWeekStart] },
                    { $lt: ["$tad", thisWeekEnd] },
                  ],
                },
                "$noOfVehicles",
                0,
              ],
            },
          },
          lastWeek: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$tad", lastWeekStart] },
                    { $lt: ["$tad", lastWeekEnd] },
                  ],
                },
                "$noOfVehicles",
                0,
              ],
            },
          },
          thisMonth: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$tad", thisMonthStart] },
                    { $lte: ["$tad", thisMonthEnd] },
                  ],
                },
                "$noOfVehicles",
                0,
              ],
            },
          },
          lastMonth: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$tad", lastMonthStart] },
                    { $lte: ["$tad", lastMonthEnd] },
                  ],
                },
                "$noOfVehicles",
                0,
              ],
            },
          },
        },
      },
    ]);

    // it is ticket count ------------

    const vehiclesPlannedAgg = await Ticket.aggregate([
      {
        $match: {
          dueDate: { $ne: null, $gte: todayStart },
          ticketStatus: { $ne: "work done" },
          isTicketClosed: false,
        },
      },
      {
        $lookup: {
          from: "employees",
          localField: "assignee",
          foreignField: "_id",
          as: "assigneeDoc",
        },
      },
      { $unwind: { path: "$assigneeDoc", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          zone: { $ifNull: ["$assigneeDoc.zone", "Unknown"] },
          dd: "$dueDate",
        },
      },
      {
        $group: {
          _id: "$zone",
          today: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$dd", plannedtodayStart] },
                    { $lt: ["$dd", plannedtodayEnd] },
                  ],
                },
                1, // ✅ count ticket instead of summing vehicles
                0,
              ],
            },
          },
          tomorrow: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$dd", plannedTomorrowStart] },
                    { $lt: ["$dd", plannedTomorrowEnd] },
                  ],
                },
                1, // ✅
                0,
              ],
            },
          },
          dayAfterTomorrow: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$dd", plannedDayAfterStart] },
                    { $lt: ["$dd", plannedDayAfterEnd] },
                  ],
                },
                1, // ✅
                0,
              ],
            },
          },
        },
      },
    ]);

    // ✅ Delayed tickets aggregation

    const delayedAgg = await Ticket.aggregate([
      {
        $match: {
          dueDate: { $lt: todayStart }, // overdue
          isTicketClosed: false, // not closed
          ticketStatus: { $ne: "work done" }, // not completed
        },
      },
      {
        $lookup: {
          from: "employees",
          localField: "assignee",
          foreignField: "_id",
          as: "assigneeDoc",
        },
      },
      { $unwind: { path: "$assigneeDoc", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          zone: { $ifNull: ["$assigneeDoc.zone", "Unknown"] },
          daysLate: {
            $floor: {
              $divide: [{ $subtract: [now, "$dueDate"] }, 1000 * 60 * 60 * 24],
            },
          },
        },
      },
      {
        $group: {
          _id: "$zone",
          by1Day: { $sum: { $cond: [{ $eq: ["$daysLate", 1] }, 1, 0] } },
          by2Days: { $sum: { $cond: [{ $eq: ["$daysLate", 2] }, 1, 0] } },
          moreThan2Days: { $sum: { $cond: [{ $gt: ["$daysLate", 2] }, 1, 0] } },
        },
      },
    ]);

    // Normalize results
    const mapByZone = (aggArray, keys) => {
      const map = {};
      zones.forEach((z) => {
        map[z] = {};
        keys.forEach((k) => (map[z][k] = 0));
      });
      aggArray.forEach((row) => {
        const zone = row._id || "Unknown";
        if (!map[zone]) {
          map[zone] = {};
          keys.forEach((k) => (map[zone][k] = 0));
        }
        keys.forEach((k) => {
          map[zone][k] = row[k] || 0;
        });
      });
      return map;
    };

    const vehiclesDone = mapByZone(vehiclesDoneAgg, [
      "today",
      "yesterday",
      "thisWeek",
      "lastWeek",
      "thisMonth",
      "lastMonth",
      "last7Days",
    ]);
    const vehiclesPlanned = mapByZone(vehiclesPlannedAgg, [
      "today",
      "tomorrow",
      "dayAfterTomorrow",
    ]);
    const delayedTickets = mapByZone(delayedAgg, [
      "by1Day",
      "by2Days",
      "moreThan2Days",
    ]);

    res.json({
      success: true,
      zones,
      vehiclesDone,
      vehiclesPlanned,
      delayedTickets,
    });
  } catch (err) {
    console.error("zone stats error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// --------------------------------------------------------------------  only testing purpose

const getTechnicianStats1 = async (req, res) => {
  try {
    const {
      startOfCurrentMonth,
      endOfCurrentMonth,
      startOfLastMonth,
      endOfLastMonthTillDate,
    } = getTechnicianDateRanges();

    // Get current date for "till date" calculations
    const currentDate = new Date();

    // Calculate start of current month till date
    const startOfCurrentMonthTillDate = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      1,
    );

    // Calculate start of last month till same date last month
    const lastMonthSameDate = new Date(currentDate);
    lastMonthSameDate.setMonth(lastMonthSameDate.getMonth() - 1);
    const startOfLastMonthTillDate = new Date(
      lastMonthSameDate.getFullYear(),
      lastMonthSameDate.getMonth(),
      1,
    );
    const endOfLastMonthTillSameDate = new Date(
      lastMonthSameDate.getFullYear(),
      lastMonthSameDate.getMonth(),
      currentDate.getDate(),
      23,
      59,
      59,
      999,
    );

    const [
      currentMonth,
      lastMonth,
      currentMonthTillDateTechs,
      lastMonthTillDateTechs,
    ] = await Promise.all([
      aggregateTechStats(startOfCurrentMonth, endOfCurrentMonth),
      aggregateTechStats(startOfLastMonth, endOfLastMonthTillDate),
      // Count new technicians for current month till date
      Technician.countDocuments({
        createdAt: {
          $gte: startOfCurrentMonthTillDate,
          $lte: currentDate,
        },
      }),
      // Count new technicians for last month till same date
      Technician.countDocuments({
        createdAt: {
          $gte: startOfLastMonthTillDate,
          $lte: endOfLastMonthTillSameDate,
        },
      }),
    ]);

    // (optional) also return the technician lists so you "see proper IDs"
    const techs = await Technician.find(
      {},
      { _id: 1, name: 1, technicianCategoryType: 1 },
    ).lean();

    res.status(200).json({
      currentMonth,
      lastMonth,
      newTechnicians: {
        currentMonthTillDate: currentMonthTillDateTechs,
        lastMonthTillDate: lastMonthTillDateTechs,
      },
      // technicians: {
      //   payroll: techs.filter(t => t.technicianCategoryType === 'payroll'),
      //   freelance: techs.filter(t => t.technicianCategoryType === 'freelance'),
      // },
      meta: {
        windows: {
          currentMonth: { start: startOfCurrentMonth, end: endOfCurrentMonth },
          lastMonth: { start: startOfLastMonth, end: endOfLastMonthTillDate },
          currentMonthTillDate: {
            start: startOfCurrentMonthTillDate,
            end: currentDate,
          },
          lastMonthTillDate: {
            start: startOfLastMonthTillDate,
            end: endOfLastMonthTillSameDate,
          },
        },
      },
    });
  } catch (err) {
    console.error("Error fetching technician stats:", err);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

// @route   GET /api/tickets/aggregated-details
// @access  Private
// @params  { type, zone, dateFilter } from query string

const getAggregatedTicketDetails = async (req, res) => {
  try {
    const { type, zone, dateFilter } = req.query;
    const now = new Date();
    const todayStart = startOfDay(new Date());
    const todayEnd = endOfDay(new Date());

    // Validate input
    if (!type || !zone || !dateFilter) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters: type, zone, dateFilter",
      });
    }

    // 1. Define the date ranges based on the dateFilter parameter
    let startDate, endDate;

    switch (dateFilter) {
      // Planned Cases
      case "today":
        startDate = todayStart;
        endDate = todayEnd;
        break;
      case "tomorrow":
        startDate = startOfDay(addDays(todayStart, 1));
        endDate = endOfDay(addDays(todayStart, 1));
        break;
      case "dayAfterTomorrow":
        startDate = startOfDay(addDays(todayStart, 2));
        endDate = endOfDay(addDays(todayStart, 2));
        break;

      // Done Cases
      case "yesterday":
        startDate = startOfDay(addDays(todayStart, -1));
        endDate = endOfDay(addDays(todayStart, -1));
        break;

      case "thisWeek":
        // Monday of this week
        startDate = startOfDay(
          addDays(
            todayStart,
            -todayStart.getDay() + (todayStart.getDay() === 0 ? -6 : 1),
          ),
        );
        endDate = todayEnd;
        break;
      case "lastWeek":
        // Monday of last week
        startDate = startOfDay(
          addDays(
            todayStart,
            -todayStart.getDay() - 6 + (todayStart.getDay() === 0 ? -7 : 1),
          ),
        );
        // Sunday of last week
        endDate = endOfDay(addDays(startDate, 6));
        break;
      case "thisMonth":
        startDate = new Date(
          todayStart.getFullYear(),
          todayStart.getMonth(),
          1,
        );
        endDate = todayEnd;
        break;
      case "lastMonth":
        startDate = new Date(
          todayStart.getFullYear(),
          todayStart.getMonth() - 1,
          1,
        );
        endDate = new Date(
          todayStart.getFullYear(),
          todayStart.getMonth(),
          0,
          23,
          59,
          59,
          999,
        ); // Last day of last month
        break;

      // Delayed Cases - These don't use date ranges, they use day counts
      case "by1Day":
      case "by2Days":
      case "moreThan2Days":
        // For delayed tickets, we don't use date ranges but day counts
        // We'll handle this in the delayed section below
        break;

      default:
        return res
          .status(400)
          .json({ success: false, error: "Invalid dateFilter parameter" });
    }

    // 2. Build the base query criteria
    let baseCriteria = {};

    if (type === "planned") {
      baseCriteria = {
        dueDate: { $gte: startDate, $lt: endDate },
        ticketStatus: { $ne: "work done" },
        isTicketClosed: false,
      };
    } else if (type === "done") {
      baseCriteria = {
        ticketAvailabilityDate: { $gte: startDate, $lt: endDate },
        ticketStatus: "work done",
        // isTicketClosed: true
      };
    } else if (type === "delayed") {
      baseCriteria = {
        dueDate: { $lt: todayStart }, // Overdue
        isTicketClosed: false,
        ticketStatus: { $ne: "work done" },
      };

      // For delayed tickets, we don't use date ranges in the initial query
      // We'll filter by day count later
    }

    // 3. Use Mongoose to find the tickets with populate
    let query = Ticket.find(baseCriteria)
      .populate({
        path: "assignee",
        select: "name zone", // Only get name and zone from employee
        match: { zone: zone.toLowerCase() }, // Filter by zone at the population level
      })
      .populate("qstClientName", "companyShortName companyName")
      .populate("taskType", "taskName")
      .populate("deviceType", "deviceName")
      .populate("technician", "name nickName")
      .select("-__v");

    // 4. Execute the query
    let tickets = await query;

    // 5. Filter out tickets where assignee is null (zone didn't match)
    tickets = tickets.filter((ticket) => ticket.assignee !== null);

    // 6. SPECIAL CASE: For delayed tickets with specific day filters
    if (type === "delayed") {
      const daysLateValue =
        dateFilter === "by1Day" ? 1 : dateFilter === "by2Days" ? 2 : null;

      if (dateFilter === "moreThan2Days") {
        tickets = tickets.filter((ticket) => {
          const daysLate = Math.floor(
            (now - ticket.dueDate) / (1000 * 60 * 60 * 24),
          );
          return daysLate > 2;
        });
      } else if (daysLateValue !== null) {
        tickets = tickets.filter((ticket) => {
          const daysLate = Math.floor(
            (now - ticket.dueDate) / (1000 * 60 * 60 * 24),
          );
          return daysLate === daysLateValue;
        });
      }

      // ✅ Sort delayed tickets by oldest dueDate first
      tickets.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    }

    res.json({
      success: true,
      count: tickets.length,
      tickets: tickets,
      filters: { type, zone, dateFilter, startDate, endDate },
    });
  } catch (err) {
    console.error("Error fetching aggregated ticket details:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ================================== Get All no. of vehicles for payroll technicians (20/09/2025, deepak) ====================================================

// Helper function to get date ranges
const getDateRangesForPayrollTechniciansData = () => {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // This week (Monday to Sunday)
  const thisWeekStart = new Date(today);
  thisWeekStart.setDate(
    today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1),
  );
  thisWeekStart.setHours(0, 0, 0, 0);

  const thisWeekEnd = new Date(thisWeekStart);
  thisWeekEnd.setDate(thisWeekStart.getDate() + 6);
  thisWeekEnd.setHours(23, 59, 59, 999);

  // Last week
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(thisWeekStart.getDate() - 7);

  const lastWeekEnd = new Date(thisWeekEnd);
  lastWeekEnd.setDate(thisWeekEnd.getDate() - 7);

  // This month
  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  thisMonthStart.setHours(0, 0, 0, 0);

  const thisMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  thisMonthEnd.setHours(23, 59, 59, 999);

  // Last month
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  lastMonthStart.setHours(0, 0, 0, 0);

  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  lastMonthEnd.setHours(23, 59, 59, 999);

  return {
    today,
    yesterday,
    thisWeekStart,
    thisWeekEnd,
    lastWeekStart,
    lastWeekEnd,
    thisMonthStart,
    thisMonthEnd,
    lastMonthStart,
    lastMonthEnd,
    lastToLastMonthStart: new Date(
      today.getFullYear(),
      today.getMonth() - 2,
      1,
    ),
    lastToLastMonthEnd: new Date(today.getFullYear(), today.getMonth() - 1, 0),
  };
};

// API to get payroll technicians with vehicle counts
const getPayrollTechniciansVehicleCountsForDashboard = async (req, res) => {
  try {
    const payrollTechnicians = await Technician.find({
      technicianCategoryType: "payroll",
    }).select("_id name nickName salary");

    if (!payrollTechnicians.length) {
      return res.status(404).json({
        success: false,
        message: "No payroll technicians found",
      });
    }

    const techIds = payrollTechnicians.map((t) => t._id);
    const dateRanges = getDateRangesForPayrollTechniciansData();

    // ===============================
    // SINGLE AGGREGATION (FAST)
    // ===============================
    const ticketData = await Ticket.aggregate([
      {
        $match: {
          technician: { $in: techIds },
          ticketStatus: "work done",
          ticketAvailabilityDate: {
            $gte: dateRanges.lastToLastMonthStart,
            $lte: dateRanges.thisMonthEnd,
          },
        },
      },
      {
        $project: {
          technician: 1,
          noOfVehicles: 1,
          ticketAvailabilityDate: 1,
        },
      },
    ]);

    // ===============================
    // PREPARE RESULT MAP
    // ===============================
    const resultMap = {};
    payrollTechnicians.forEach((tech) => {
      resultMap[tech._id.toString()] = {
        _id: tech._id,
        technicianName: tech.name,
        techniciannickName: tech.nickName,
        today: 0,
        yesterday: 0,
        thisWeek: 0,
        lastWeek: 0,
        thisMonth: 0,
        lastMonth: 0,
      };
    });

    let totalThisMonthCalls = 0;
    let totalLastMonthCalls = 0;
    let totalLastToLastMonthCalls = 0;

    // ===============================
    // PROCESS DATA
    // ===============================
    ticketData.forEach((ticket) => {
      const techId = ticket.technician.toString();
      const date = new Date(ticket.ticketAvailabilityDate);
      const vehicles = ticket.noOfVehicles || 0;

      const techObj = resultMap[techId];
      if (!techObj) return;

      // ---- TODAY
      if (date >= dateRanges.today) {
        techObj.today += vehicles;
      }

      // ---- YESTERDAY
      if (date >= dateRanges.yesterday && date < dateRanges.today) {
        techObj.yesterday += vehicles;
      }

      // ---- THIS WEEK
      if (date >= dateRanges.thisWeekStart && date <= dateRanges.thisWeekEnd) {
        techObj.thisWeek += vehicles;
      }

      // ---- LAST WEEK
      if (date >= dateRanges.lastWeekStart && date <= dateRanges.lastWeekEnd) {
        techObj.lastWeek += vehicles;
      }

      // ---- THIS MONTH
      if (
        date >= dateRanges.thisMonthStart &&
        date <= dateRanges.thisMonthEnd
      ) {
        techObj.thisMonth += vehicles;
        totalThisMonthCalls += vehicles;
      }

      // ---- LAST MONTH
      if (
        date >= dateRanges.lastMonthStart &&
        date <= dateRanges.lastMonthEnd
      ) {
        techObj.lastMonth += vehicles;
        totalLastMonthCalls += vehicles;
      }

      // ---- LAST TO LAST MONTH
      if (
        date >= dateRanges.lastToLastMonthStart &&
        date <= dateRanges.lastToLastMonthEnd
      ) {
        totalLastToLastMonthCalls += vehicles;
      }
    });

    const result = Object.values(resultMap);

    // ===============================
    // PRODUCTIVITY CALCULATION
    // ===============================
    const noOfPayrollTechs = payrollTechnicians.length;

    const today = new Date();

    // days till today in current month
    const daysTillToday = today.getDate();

    // total days in last month
    const lastMonthDate = new Date(today.getFullYear(), today.getMonth(), 0);
    const totalDaysInLastMonth = lastMonthDate.getDate();

    const thisMonthProductivity =
      noOfPayrollTechs && daysTillToday
        ? +(totalThisMonthCalls / noOfPayrollTechs / daysTillToday).toFixed(2)
        : 0;

    const lastMonthProductivity =
      noOfPayrollTechs && totalDaysInLastMonth
        ? +(
          totalLastMonthCalls /
          noOfPayrollTechs /
          totalDaysInLastMonth
        ).toFixed(2)
        : 0;

    // total days in last to last month
    const lastToLastMonthDate = new Date(
      today.getFullYear(),
      today.getMonth() - 1,
      0,
    );
    const totalDaysInLastToLastMonth = lastToLastMonthDate.getDate();

    const lastToLastMonthProductivity =
      noOfPayrollTechs && totalDaysInLastToLastMonth
        ? + (
          totalLastToLastMonthCalls /
          noOfPayrollTechs /
          totalDaysInLastToLastMonth
        ).toFixed(2)
        : 0;

    // ===============================
    // AVERAGE COST PER VISIT CALCULATION
    // ===============================
    // total days in current month (for MTD proration)
    const currentMonthEndDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const totalDaysInCurrentMonth = currentMonthEndDate.getDate();

    const totalMonthlySalary = payrollTechnicians.reduce((sum, tech) => sum + (tech.salary || 0), 0);

    // MTD Payroll Cost for current month
    const mtdPayrollCost = totalMonthlySalary * (daysTillToday / totalDaysInCurrentMonth);

    const averageCost = {
      thisMonth: totalThisMonthCalls > 0 ? +(mtdPayrollCost / totalThisMonthCalls).toFixed(2) : 0,
      lastMonth: totalLastMonthCalls > 0 ? +(totalMonthlySalary / totalLastMonthCalls).toFixed(2) : 0,
      lastToLastMonth: totalLastToLastMonthCalls > 0 ? +(totalMonthlySalary / totalLastToLastMonthCalls).toFixed(2) : 0,
      meta: {
        totalMonthlySalary,
        mtdPayrollCost,
        daysTillToday,
        totalDaysInCurrentMonth,
        totalDaysInLastMonth,
        totalDaysInLastToLastMonth
      }
    };

    // ===============================
    // FINAL RESPONSE
    // ===============================
    res.json({
      success: true,
      data: result,
      productivity: {
        thisMonth: thisMonthProductivity,
        lastMonth: lastMonthProductivity,
        lastToLastMonth: lastToLastMonthProductivity,
        meta: {
          totalThisMonthCalls,
          totalLastMonthCalls,
          totalLastToLastMonthCalls,

          noOfPayrollTechs,
          daysTillToday,
          totalDaysInLastMonth,
        },
      },
      averageCost,
    });
  } catch (error) {
    console.error("Error fetching payroll technicians vehicle counts:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

async function getMonthlyMargins(req, res) {
  try {
    const {
      financialMonthKey,
      financialYearLabel,
      month,
      from,
      to,
      sort,
      latest,
    } = req.query;

    const q = {};

    // Exact key takes precedence
    if (financialMonthKey) {
      q.financialMonthKey = String(financialMonthKey);
    } else {
      if (financialYearLabel) q.financialYearLabel = String(financialYearLabel);
      if (month) q.month = Number(month);
    }

    if (from || to) {
      q.createdAt = {};
      if (from) q.createdAt.$gte = new Date(from);
      if (to) q.createdAt.$lte = new Date(to);
    }

    // default sort: newest financial year on top, and newest month within that year
    let sortObj = { year: -1, month: -1 };

    // optional custom sort (overrides default)
    if (sort) {
      sortObj = {};
      const parts = String(sort).split(",");
      for (const p of parts) {
        const [field, dir] = p.split(":").map((s) => s.trim());
        if (!field) continue;
        sortObj[field] = !dir || dir.toLowerCase() === "desc" ? -1 : 1;
      }
    }

    if (latest === "true" || latest === true) {
      const doc = await MonthlyMargin.findOne(q).sort(sortObj).lean();
      return res.json({
        success: true,
        count: doc ? 1 : 0,
        monthly: doc ? [doc] : [],
      });
    }

    // return all matches (no pagination)
    const items = await MonthlyMargin.find(q).sort(sortObj).lean();
    return res.json({
      success: true,
      count: items.length,
      monthly: items,
    });
  } catch (err) {
    console.error("getMonthlyMargins error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch monthly margins",
      error: err.message,
    });
  }
}

//  ===========================================================================================

// Add this to your backend controller
const getTicketsByTechnicianAndDateRange = async (req, res) => {
  try {
    const { technicianId, period, startDate, endDate } = req.query;

    if (!technicianId || !period) {
      return res.status(400).json({
        success: false,
        message: "Technician ID and period are required",
      });
    }

    let dateFilter = {};
    const dateRanges = getDateRangesForPayrollTechniciansData();

    // Set date range based on period
    switch (period) {
      case "today":
        dateFilter.ticketAvailabilityDate = { $gte: dateRanges.today };
        break;
      case "yesterday":
        dateFilter.ticketAvailabilityDate = {
          $gte: dateRanges.yesterday,
          $lt: dateRanges.today,
        };
        break;
      case "thisWeek":
        dateFilter.ticketAvailabilityDate = {
          $gte: dateRanges.thisWeekStart,
          $lte: dateRanges.thisWeekEnd,
        };
        break;
      case "lastWeek":
        dateFilter.ticketAvailabilityDate = {
          $gte: dateRanges.lastWeekStart,
          $lte: dateRanges.lastWeekEnd,
        };
        break;
      case "thisMonth":
        dateFilter.ticketAvailabilityDate = {
          $gte: dateRanges.thisMonthStart,
          $lte: dateRanges.thisMonthEnd,
        };
        break;
      case "lastMonth":
        dateFilter.ticketAvailabilityDate = {
          $gte: dateRanges.lastMonthStart,
          $lte: dateRanges.lastMonthEnd,
        };
        break;
      default:
        if (startDate && endDate) {
          dateFilter.ticketAvailabilityDate = {
            $gte: new Date(startDate),
            $lte: new Date(endDate),
          };
        }
    }

    const tickets = await Ticket.find({
      technician: technicianId,
      ...dateFilter,
      ticketStatus: "work done",
    })
      .populate("qstClientName", "companyShortName companyName")
      .populate("technician", "name nickName")
      .populate("taskType", "taskName")
      .select(
        "ticketSKUId vehicleNumbers noOfVehicles subjectLine description ticketAvailabilityDate technician taskType",
      )
      .sort({ ticketAvailabilityDate: -1 });

    res.json({
      success: true,
      data: tickets,
      count: tickets.length,
      totalVehicles: tickets.reduce(
        (sum, ticket) => sum + ticket.noOfVehicles,
        0,
      ),
    });
  } catch (error) {
    console.error("Error fetching tickets by technician:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// ==========================================
// PAYROLL TECHNICIANS OPEN TICKETS / VEHICLES
// ==========================================
const getPayrollTechniciansOpenTicketsCounts = async (req, res) => {
  try {
    const payrollTechnicians = await Technician.find({
      technicianCategoryType: "payroll",
    }).select("_id name nickName salary");

    if (!payrollTechnicians.length) {
      return res.status(404).json({
        success: false,
        message: "No payroll technicians found",
      });
    }

    const techIds = payrollTechnicians.map((t) => t._id);
    const dateRanges = getDateRangesForPayrollTechniciansData();

    // Tickets that are not marked as work done or closed
    const openStatusMatch = {
      ticketStatus: {
        $nin: [
          "work done",
          "closed",
          "Work Done",
          "Closed",
          "WORK DONE",
          "CLOSED",
          "Cancelled",
          "Cancelled Ticket"
        ],
      },
    };

    const ticketData = await Ticket.aggregate([
      {
        $match: {
          technician: { $in: techIds },
          ...openStatusMatch,
        },
      },
      {
        $project: {
          technician: 1,
          noOfVehicles: 1,
          dueDate: 1,
          ticketAvailabilityDate: 1,
          createdAt: 1,
          ticketStatus: 1,
        },
      },
    ]);

    const resultMap = {};
    payrollTechnicians.forEach((tech) => {
      resultMap[tech._id.toString()] = {
        _id: tech._id,
        technicianName: tech.name,
        techniciannickName: tech.nickName,
        today: 0,
        yesterday: 0,
        thisWeek: 0,
        lastWeek: 0,
        thisMonth: 0,
        lastMonth: 0,
      };
    });

    ticketData.forEach((ticket) => {
      if (!ticket.technician) return;
      const techId = ticket.technician.toString();
      const techObj = resultMap[techId];
      if (!techObj) return;

      const rawDate =
        ticket.dueDate || ticket.ticketAvailabilityDate || ticket.createdAt;
      if (!rawDate) return;
      const date = new Date(rawDate);
      const countValue = 1; // 1 per ticket for "No. of open tickets"

      // ---- TODAY
      if (date >= dateRanges.today) {
        techObj.today += countValue;
      }

      // ---- YESTERDAY
      if (date >= dateRanges.yesterday && date < dateRanges.today) {
        techObj.yesterday += countValue;
      }

      // ---- THIS WEEK
      if (date >= dateRanges.thisWeekStart && date <= dateRanges.thisWeekEnd) {
        techObj.thisWeek += countValue;
      }

      // ---- LAST WEEK
      if (date >= dateRanges.lastWeekStart && date <= dateRanges.lastWeekEnd) {
        techObj.lastWeek += countValue;
      }

      // ---- THIS MONTH
      if (
        date >= dateRanges.thisMonthStart &&
        date <= dateRanges.thisMonthEnd
      ) {
        techObj.thisMonth += countValue;
      }

      // ---- LAST MONTH
      if (
        date >= dateRanges.lastMonthStart &&
        date <= dateRanges.lastMonthEnd
      ) {
        techObj.lastMonth += countValue;
      }
    });

    const result = Object.values(resultMap);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error fetching payroll technicians open tickets counts:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const getPayrollTechniciansOpenTickets = async (req, res) => {
  try {
    const { technicianId, period, startDate, endDate } = req.query;

    if (!technicianId || !period) {
      return res.status(400).json({
        success: false,
        message: "Technician ID and period are required",
      });
    }

    let dateCond = null;
    const dateRanges = getDateRangesForPayrollTechniciansData();

    switch (period) {
      case "today":
        dateCond = { $gte: dateRanges.today };
        break;
      case "yesterday":
        dateCond = {
          $gte: dateRanges.yesterday,
          $lt: dateRanges.today,
        };
        break;
      case "thisWeek":
        dateCond = {
          $gte: dateRanges.thisWeekStart,
          $lte: dateRanges.thisWeekEnd,
        };
        break;
      case "lastWeek":
        dateCond = {
          $gte: dateRanges.lastWeekStart,
          $lte: dateRanges.lastWeekEnd,
        };
        break;
      case "thisMonth":
        dateCond = {
          $gte: dateRanges.thisMonthStart,
          $lte: dateRanges.thisMonthEnd,
        };
        break;
      case "lastMonth":
        dateCond = {
          $gte: dateRanges.lastMonthStart,
          $lte: dateRanges.lastMonthEnd,
        };
        break;
      default:
        if (startDate && endDate) {
          dateCond = {
            $gte: new Date(startDate),
            $lte: new Date(endDate),
          };
        }
    }

    const dateQuery = dateCond
      ? {
        $or: [
          { dueDate: dateCond },
          { ticketAvailabilityDate: dateCond },
          { createdAt: dateCond },
        ],
      }
      : {};

    const openStatusMatch = {
      ticketStatus: {
        $nin: [
          "work done",
          "closed",
          "Work Done",
          "Closed",
          "WORK DONE",
          "CLOSED",
        ],
      },
    };

    const tickets = await Ticket.find({
      technician: technicianId,
      ...dateQuery,
      ...openStatusMatch,
    })
      .populate("qstClientName", "companyShortName companyName")
      .populate("technician", "name nickName")
      .populate("taskType", "taskName")
      .select(
        "ticketSKUId vehicleNumbers noOfVehicles subjectLine description dueDate ticketAvailabilityDate technician taskType ticketStatus createdAt"
      )
      .sort({ dueDate: -1, ticketAvailabilityDate: -1, createdAt: -1 });

    res.json({
      success: true,
      data: tickets,
      count: tickets.length,
      totalVehicles: tickets.reduce(
        (sum, ticket) => sum + (ticket.noOfVehicles || 0),
        0
      ),
    });
  } catch (error) {
    console.error("Error fetching open tickets by technician:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const getCSEDashboardStats = async (req, res) => {
  try {
    // Get the CSE user ID from authenticated user
    const cseUserId = req.user._id;

    // Verify user is CSE role
    if (req.user.role !== "cse") {
      return res.status(403).json({
        success: false,
        message: "Access denied. This endpoint is only for CSE users.",
      });
    }

    // Get overall tickets count - all tickets assigned to this CSE user
    const overallTickets = await Ticket.countDocuments({
      assignee: cseUserId,
    });

    // Get work done tickets - tickets with status "work done" assigned to this CSE
    const workDoneTickets = await Ticket.countDocuments({
      assignee: cseUserId,
      ticketStatus: "work done",
      isTicketClosed: true,
    });

    // Get actual tickets - work done tickets with ticketAvailabilityDate
    // This represents tickets that have actually been completed (work done with availability date)
    const actualTickets = await Ticket.countDocuments({
      assignee: cseUserId,
      ticketStatus: "work done",
      ticketAvailabilityDate: { $ne: null },
      isTicketClosed: true,
    });

    // Get planned tickets - all tickets with dueDate assigned to this CSE
    // These are tickets that are planned/scheduled (what was originally planned)
    const plannedTickets = await Ticket.countDocuments({
      assignee: cseUserId,
      dueDate: { $ne: null },
    });

    // Calculate completion percentage
    const percentage =
      overallTickets > 0
        ? Math.round((workDoneTickets / overallTickets) * 100)
        : 0;

    // Return the dashboard data
    res.status(200).json({
      success: true,
      percentage,
      overallTickets,
      workDoneTickets,
      actualTickets,
      plannedTickets,
    });
  } catch (error) {
    console.error("Error fetching CSE dashboard stats:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// @desc    Get count of open tickets with quantity >= 3
// @route   GET /api/dashboard/open-tickets-qty3
// @access  Private
const getOpenTicketsQty3Count = async (req, res) => {
  try {
    const count = await Ticket.countDocuments({
      isTicketClosed: false,
      ticketStatus: { $ne: "work done" },
      $expr: {
        $gte: [
          {
            $cond: [
              { $gt: ["$noOfVehicles", 0] },
              "$noOfVehicles",
              { $size: { $ifNull: ["$vehicleNumbers", []] } },
            ],
          },
          3,
        ],
      },
    });

    res.status(200).json({
      success: true,
      count,
    });
  } catch (error) {
    console.error("Error fetching open tickets with qty >= 3 count:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

// @desc    Get details of open tickets with quantity >= 3
// @route   GET /api/dashboard/open-tickets-qty3-details
// @access  Private
const getOpenTicketsQty3Details = async (req, res) => {
  try {
    const tickets = await Ticket.find({
      isTicketClosed: false,
      ticketStatus: { $ne: "work done" },
    })
      .populate("qstClientName", "companyShortName companyName")
      .lean();

    // Filter tickets where quantity >= 3
    const filteredTickets = tickets.filter((ticket) => {
      const qty =
        ticket.noOfVehicles > 0
          ? ticket.noOfVehicles
          : ticket.vehicleNumbers?.length || 0;
      return qty >= 3;
    });

    // Format the tickets with the required information
    const formattedTickets = filteredTickets.map((ticket) => {
      const qty =
        ticket.noOfVehicles > 0
          ? ticket.noOfVehicles
          : ticket.vehicleNumbers?.length || 0;

      return {
        ...ticket,
        quantity: qty,
        clientShortName:
          ticket.qstClientName?.companyShortName ||
          ticket.qstClientName?.companyName ||
          "N/A",
      };
    });

    res.status(200).json({
      success: true,
      tickets: formattedTickets,
      count: formattedTickets.length,
    });
  } catch (error) {
    console.error("Error fetching open tickets with qty >= 3 details:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

// @desc    Get today's completion percentage by zone
// @route   GET /api/dashboard/zone-completion-today
// @access  Private
const getZoneCompletionMonth = async (req, res) => {
  try {
    const zones = ["west1", "west2", "east", "south", "north"];

    // ---- MONTH RANGE ----
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0);

    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    monthEnd.setHours(23, 59, 59, 999);

    const zoneStats = await Promise.all(
      zones.map(async (zone) => {
        // ---- TOTAL TICKETS ----
        const total = await Ticket.aggregate([
          {
            $match: {
              dueDate: { $gte: monthStart, $lte: monthEnd },
              assignee: { $exists: true, $ne: null },
            },
          },
          {
            $lookup: {
              from: "employees",
              localField: "assignee",
              foreignField: "_id",
              as: "assigneeData",
            },
          },
          { $unwind: "$assigneeData" },
          {
            $match: {
              "assigneeData.zone": zone,
            },
          },
          { $count: "total" },
        ]);

        // ---- WORK DONE TICKETS ----
        const workDone = await Ticket.aggregate([
          {
            $match: {
              dueDate: { $gte: monthStart, $lte: monthEnd },
              ticketStatus: "work done",
              assignee: { $exists: true, $ne: null },
            },
          },
          {
            $lookup: {
              from: "employees",
              localField: "assignee",
              foreignField: "_id",
              as: "assigneeData",
            },
          },
          { $unwind: "$assigneeData" },
          {
            $match: {
              "assigneeData.zone": zone,
            },
          },
          { $count: "total" },
        ]);

        const totalTickets = total[0]?.total || 0;
        const workDoneTickets = workDone[0]?.total || 0;
        const percentage =
          totalTickets > 0
            ? Math.round((workDoneTickets / totalTickets) * 100)
            : 0;

        return {
          zone,
          totalTickets,
          workDoneTickets,
          percentage: Math.round(percentage * 100) / 100,
        };
      }),
    );

    res.status(200).json({
      success: true,
      period: "month",
      dateRange: {
        start: monthStart,
        end: monthEnd,
      },
      data: zoneStats,
    });
  } catch (error) {
    console.error(
      "Error fetching zone completion percentages (monthly):",
      error,
    );
    res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

const getPerformanceRatioFY = async (req, res) => {
  try {
    const now = new Date();
    const currentMonth = now.getMonth(); // 0-11
    const currentYear = now.getFullYear();

    // Financial year starts in April (3)
    let startYear = currentMonth < 3 ? currentYear - 1 : currentYear;
    const fyStart = new Date(startYear, 3, 1); // April 1st

    // 1. Get Key Clients
    const keyClients = await QstClient.find({ keyClient: true }).select("_id");
    const keyClientIds = keyClients.map((c) => c._id);

    if (keyClientIds.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    // 2. Get "Installation" task ID
    const installationTask = await Task.findOne({
      taskName: { $regex: /^installation$/i },
    });
    const installationTaskId = installationTask ? installationTask._id : null;

    // 3. Get Total Vehicles for Key Clients (Fleet size)
    const totalVehiclesCount = await MainData.countDocuments({
      company: { $in: keyClientIds },
    });

    // 4. Aggregate monthly ticket performance
    const performanceData = await Ticket.aggregate([
      {
        $match: {
          qstClientName: { $in: keyClientIds },
          ticketStatus: "work done",
          isTicketClosed: true,
          taskType: { $ne: installationTaskId },
          ticketAvailabilityDate: { $gte: fyStart, $lte: now },
        },
      },
      {
        $group: {
          _id: { $month: "$ticketAvailabilityDate" },
          workDoneVehicles: {
            $sum: {
              $cond: [
                { $gt: ["$noOfVehicles", 0] },
                "$noOfVehicles",
                { $size: { $ifNull: ["$vehicleNumbers", []] } },
              ],
            },
          },
        },
      },
      {
        $project: {
          month: "$_id",
          workDoneVehicles: 1,
          totalVehicles: { $literal: totalVehiclesCount },
          ratio: {
            $cond: [
              { $gt: [totalVehiclesCount, 0] },
              { $divide: ["$workDoneVehicles", totalVehiclesCount] },
              0,
            ],
          },
        },
      },
      { $sort: { month: 1 } },
    ]);

    // Format the response to include all months in the FY up to current
    const monthsName = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    // Financial year months order (April to March)
    const fyMonthsOrder = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];

    // We only want months up to 'now'
    const nowMonth = now.getMonth() + 1;
    const currentFYMonths = [];
    for (const m of fyMonthsOrder) {
      currentFYMonths.push(m);
      if (m === nowMonth) break;
    }

    const result = currentFYMonths.map((m) => {
      const data = performanceData.find((d) => d.month === m);
      return {
        month: monthsName[m - 1],
        monthIndex: m,
        workDoneVehicles: data ? data.workDoneVehicles : 0,
        totalVehicles: totalVehiclesCount,
        ratio: data ? data.ratio : 0,
      };
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error in getPerformanceRatioFY:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

// ── Warranty Stats for Device Master, Accessory Master & SIM Master ──────────
const DeviceMasterModel = require("../models/deviceMaster");
const AccessoryMasterModel = require("../models/accessoryMaster");
const SimMasterModel = require("../models/simMaster");

const getWarrantyStats = async (req, res) => {
  try {
    const [
      deviceActive,
      deviceOut,
      accessoryActive,
      accessoryOut,
      simActive,
      simInactive,
    ] = await Promise.all([
      DeviceMasterModel.countDocuments({ warrantyStatus: "active" }),
      DeviceMasterModel.countDocuments({ warrantyStatus: "out of warranty" }),
      AccessoryMasterModel.countDocuments({ warnatyStatus: "active" }),
      AccessoryMasterModel.countDocuments({ warnatyStatus: "out of warranty" }),
      // active = has a non-empty activationDate
      SimMasterModel.countDocuments({
        activationDate: { $exists: true, $nin: ["", null] },
      }),
      // inactive = activationDate missing, empty, or null
      SimMasterModel.countDocuments({
        $or: [
          { activationDate: { $exists: false } },
          { activationDate: "" },
          { activationDate: null },
        ],
      }),
    ]);

    res.status(200).json({
      success: true,
      device: { active: deviceActive, outOfWarranty: deviceOut },
      accessory: { active: accessoryActive, outOfWarranty: accessoryOut },
      sim: { active: simActive, inactive: simInactive },
    });
  } catch (error) {
    console.error("Error fetching warranty stats:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

// ── Inventory Type Stats: counts by device/accessory type & model ─────────────
const getInventoryTypeStats = async (req, res) => {
  try {
    // Run all aggregations in parallel
    const [
      deviceTypeAgg,
      deviceModelAgg,
      temp_device,
      temp_accessory,
      fuel_device,
      fuel_accessory,
      accessoryTypeAgg,
    ] = await Promise.all([
      // All distinct deviceType values with counts (exclude null/empty)
      DeviceMasterModel.aggregate([
        { $match: { deviceType: { $exists: true, $nin: [null, ""] } } },
        { $group: { _id: "$deviceType", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      // All distinct deviceModel values with counts (exclude null/empty)
      DeviceMasterModel.aggregate([
        { $match: { deviceModel: { $exists: true, $nin: [null, ""] } } },
        { $group: { _id: "$deviceModel", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      // Temp — device
      DeviceMasterModel.countDocuments({
        $or: [
          { deviceType: { $regex: /temp/i } },
          { deviceModel: { $regex: /temp/i } },
        ],
      }),
      // Temp — accessory
      AccessoryMasterModel.countDocuments({
        $or: [
          { accessoryType: { $regex: /temp/i } },
          { accessoryModel: { $regex: /temp/i } },
        ],
      }),
      // Fuel — device
      DeviceMasterModel.countDocuments({
        $or: [
          { deviceType: { $regex: /fuel/i } },
          { deviceModel: { $regex: /fuel/i } },
        ],
      }),
      // Fuel — accessory
      AccessoryMasterModel.countDocuments({
        $or: [
          { accessoryType: { $regex: /fuel/i } },
          { accessoryModel: { $regex: /fuel/i } },
        ],
      }),
      // All distinct accessoryType values with counts
      AccessoryMasterModel.aggregate([
        { $match: { accessoryType: { $exists: true, $nin: [null, ""] } } },
        { $group: { _id: "$accessoryType", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    res.status(200).json({
      success: true,
      // Arrays of { name, count } sorted by count desc
      deviceTypes: deviceTypeAgg.map((d) => ({ name: d._id, count: d.count })),
      deviceModels: deviceModelAgg.map((d) => ({ name: d._id, count: d.count })),
      accessoryTypes: accessoryTypeAgg.map((d) => ({ name: d._id, count: d.count })),
      // Combined temp/fuel totals
      tempTotal: temp_device + temp_accessory,
      fuelTotal: fuel_device + fuel_accessory,
    });
  } catch (error) {
    console.error("Error fetching inventory type stats:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

// ── Demo Units Stats: within / outside demo period ───────────────────────────
const getDemoStats = async (req, res) => {
  try {
    const now = new Date();

    // today at 00:00:00 — used as lower bound for "within"
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    // today at 23:59:59 — used as upper bound for "outside" check
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    // IN DEMO  : demoFromDate <= today  AND  demoToDate >= todayStart
    // OUT DEMO : demoToDate < todayStart  (to-date has fully passed, i.e. before today 00:00)

    const [
      deviceWithin, deviceOutside,
      accessoryWithin, accessoryOutside,
      simWithin, simOutside,
    ] = await Promise.all([
      DeviceMasterModel.countDocuments({
        status: "customer demo",
        demoFromDate: { $lte: todayEnd },
        demoToDate: { $gte: todayStart },
      }),
      DeviceMasterModel.countDocuments({
        status: "customer demo",
        demoToDate: { $lt: todayStart },
      }),

      AccessoryMasterModel.countDocuments({
        status: "customer demo",
        demoFromDate: { $lte: todayEnd },
        demoToDate: { $gte: todayStart },
      }),
      AccessoryMasterModel.countDocuments({
        status: "customer demo",
        demoToDate: { $lt: todayStart },
      }),

      SimMasterModel.countDocuments({
        status: "customer demo",
        demoFromDate: { $lte: todayEnd },
        demoToDate: { $gte: todayStart },
      }),
      SimMasterModel.countDocuments({
        status: "customer demo",
        demoToDate: { $lt: todayStart },
      }),
    ]);

    res.status(200).json({
      success: true,
      total: {
        within: deviceWithin + accessoryWithin + simWithin,
        outside: deviceOutside + accessoryOutside + simOutside,
      },
      device: { within: deviceWithin, outside: deviceOutside },
      accessory: { within: accessoryWithin, outside: accessoryOutside },
      sim: { within: simWithin, outside: simOutside },
    });
  } catch (error) {
    console.error("Error fetching demo stats:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};
const getStockStats = async (req, res) => {
  try {
    // Fetch ALL items with just the fields we need for counting + value calc
    const [deviceAll, accessoryAll, simAll] = await Promise.all([
      DeviceMasterModel.find({}, { devicePerRate: 1, warrantyStatus: 1, status: 1 }).lean(),
      AccessoryMasterModel.find({}, { accessoryPerRate: 1, warnatyStatus: 1, status: 1 }).lean(),
      SimMasterModel.find({}, { simPerRate: 1, isSimActivated: 1, activationDate: 1, status: 1 }).lean(),
    ]);

    const rate = (item, field) => {
      const v = parseFloat(item[field]);
      return isNaN(v) ? 0 : v;
    };

    // ── Device ──────────────────────────────────────────────
    const deviceStock = deviceAll.filter((d) => d.status === "stock");
    const deviceActive = deviceAll.filter((d) => d.warrantyStatus === "active");
    const deviceInactive = deviceAll.filter((d) => d.warrantyStatus === "out of warranty");

    // ── Accessory ───────────────────────────────────────────
    const accessoryStock = accessoryAll.filter((a) => a.status === "stock");
    const accessoryActive = accessoryAll.filter((a) => a.warnatyStatus === "active");
    const accessoryInactive = accessoryAll.filter((a) => a.warnatyStatus === "out of warranty");

    // ── SIM ─────────────────────────────────────────────────
    const simStock = simAll.filter((s) => s.status === "stock");
    const simActive = simAll.filter((s) => s.isSimActivated === true || (s.activationDate && String(s.activationDate).trim() !== ""));
    const simInactive = simAll.filter((s) => !s.isSimActivated && (!s.activationDate || String(s.activationDate).trim() === ""));

    const sum = (items, field) => items.reduce((acc, i) => acc + rate(i, field), 0);

    res.status(200).json({
      success: true,
      device: {
        stockCount: deviceStock.length,
        stockValue: sum(deviceStock, "devicePerRate"),
        activeCount: deviceActive.length,
        activeValue: sum(deviceActive, "devicePerRate"),
        inactiveCount: deviceInactive.length,
        inactiveValue: sum(deviceInactive, "devicePerRate"),
      },
      accessory: {
        stockCount: accessoryStock.length,
        stockValue: sum(accessoryStock, "accessoryPerRate"),
        activeCount: accessoryActive.length,
        activeValue: sum(accessoryActive, "accessoryPerRate"),
        inactiveCount: accessoryInactive.length,
        inactiveValue: sum(accessoryInactive, "accessoryPerRate"),
      },
      sim: {
        stockCount: simStock.length,
        stockValue: sum(simStock, "simPerRate"),
        activeCount: simActive.length,
        activeValue: sum(simActive, "simPerRate"),
        inactiveCount: simInactive.length,
        inactiveValue: sum(simInactive, "simPerRate"),
      },
    });
  } catch (error) {
    console.error("Error fetching stock stats:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

module.exports = {
  getDashboardStats,
  getKeyClientStats,
  getTechnicianStats,
  getVehicalsData,
  getTechnicianStats1,
  getMonthlyMargins,

  getTicketsByTechnicianAndDateRange,

  getAggregatedTicketDetails,

  getPayrollTechniciansVehicleCountsForDashboard,
  getPayrollTechniciansOpenTicketsCounts,
  getPayrollTechniciansOpenTickets,
  getCSEDashboardStats,
  getOpenTicketsQty3Count,
  getOpenTicketsQty3Details,
  getZoneCompletionMonth,
  getPerformanceRatioFY,
  getWarrantyStats,
  getStockStats,
  getInventoryTypeStats,
  getDemoStats,
};
