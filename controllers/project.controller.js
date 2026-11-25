const customerChargeRateListModel = require('../models/customerChargeRateList.model');
const Project = require('../models/project.model');
const Ticket = require('../models/ticket.model');
const mongoose = require("mongoose")
// Get all projects by QST client ID
exports.getAllProjectsByQstClientId = async (req, res) => {
  try {
    const clientId = req.params.clientId;
    const projects = await Project.find({ qstClient: clientId })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      message: 'Get all projects of qstClient successfully',
      data: projects
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error retrieving projects',
      error: error.message
    });
  }
};


exports.getAllProjects = async (req, res) => {
  try {
    const projects = await Project.find()
      .sort({ createdAt: -1 });

    // console.log(projects);
    res.status(200).json({
      success: true,
      message: 'Get all projects successfully',
      data: projects
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error retrieving projects',
      error: error.message
    });
  }
};


exports.bulkAddProjects = async (req, res) => {
  try {
    const projects = req.body;

    if (!Array.isArray(projects) || projects.length === 0) {
      return res.status(400).json({ message: 'No project data provided' });
    }

    // Optional: Validate each entry
    for (const project of projects) {
      if (!project.projectName || !project.qstClient) {
        return res.status(400).json({ message: 'Each project must have projectName and qstClient' });
      }
    }

    const result = await Project.insertMany(projects);

    res.status(201).json({
      message: 'Projects inserted successfully',
      data: result,
    });
  } catch (error) {
    console.error('Bulk insert error:', error);
    res.status(500).json({ message: 'Server error', error });
  }
};
// -------------------------------------------------------------




exports.createProject = async (req, res) => {
  try {
    const { qstClient, projectName, description, startDate, endDate } = req.body;

    // Validate required fields
    if (!qstClient || !projectName
      // || !startDate || !endDate
    ) {
      return res.status(400).json({ success: false, message: 'All required fields must be provided.' });
    }
    if (!mongoose.Types.ObjectId.isValid(qstClient)) {
      return res.status(400).json({ success: false, message: 'Invalid qstClient ID.' });
    }
    // Validate dates
    if (new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({ success: false, message: 'End date cannot be before start date.' });
    }

    // Optional: Check if project already exists under the same qstClient
    // const existingProject = await Project.findOne({ qstClient, projectName: projectName.trim() });
    // if (existingProject) {
    //   return res.status(409).json({ success: false, message: 'A project with this name already exists for the client.' });
    // }

    const existingProject = await Project.findOne({
      qstClient,
      projectName: { $regex: new RegExp(`^${projectName.trim()}$`, "i") }
    });

    if (existingProject) {
      return res
        .status(409)
        .json({ success: false, message: "A project with this name already exists for the client." });
    }

    const newProject = new Project({
      qstClient,
      projectName: projectName.trim(),
      description: description?.trim() || '',
      startDate,
      endDate,
    });

    await newProject.save();

    res.status(201).json({
      success: true,
      message: 'Project created successfully.',
      data: newProject,
    });
  } catch (error) {
    console.error('Create Project Error:', error);
    res.status(500).json({ success: false, message: 'Server error while creating project.' });
  }
};


exports.updateProject = async (req, res) => {
  try {
    const { id } = req.params;
    const { projectName, description, startDate, endDate } = req.body;

    if (!projectName
      //  || !startDate || !endDate
    ) {
      return res.status(400).json({ success: false, message: 'Project name, start date, and end date are required.' });
    }

    if (new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({ success: false, message: 'End date cannot be before start date.' });
    }

    const existingProject = await Project.findById(id);
    if (!existingProject) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    // ✅ Case-insensitive duplicate check for same client, excluding current project
    const duplicate = await Project.findOne({
      _id: { $ne: id }, // exclude current project
      qstClient: existingProject.qstClient,
      projectName: { $regex: new RegExp(`^${projectName.trim()}$`, "i") }
    });

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "A project with this name already exists for the client."
      });
    }

    existingProject.projectName = projectName.trim();
    existingProject.description = description?.trim() || '';
    existingProject.startDate = startDate;
    existingProject.endDate = endDate;

    await existingProject.save();

    res.status(200).json({
      success: true,
      message: 'Project updated successfully.',
      data: existingProject,
    });
  } catch (error) {
    console.error('Update Project Error:', error);
    res.status(500).json({ success: false, message: 'Server error while updating project.' });
  }
};


// exports.deleteProject = async (req, res) => {
//   try {
//     const { id } = req.params;

//     // Check if project exists
//       const project = await Project.findById(id);
//     if (!project) {
//       return res.status(404).json({ success: false, message: 'Project not found.' });
//     }


//     // Check if there are any non-closed tickets associated with this project ID
//     const openTickets = await Ticket.findOne({ 
//       qstClientProjectName: project.projectName,  // Assuming you add project reference to Ticket schema
//       isTicketClosed: false
//     });

//     if (openTickets) {
//       return res.status(400).json({ 
//         success: false, 
//         message: 'Project cannot be deleted as it has associated open tickets.' 
//       });
//     }

//     // If no open tickets, proceed with deletion
//     await Project.findByIdAndDelete(id);

//     res.status(200).json({ success: true, message: 'Project deleted successfully.' });
//   } catch (error) {
//     console.error('Delete Project Error:', error);
//     res.status(500).json({ success: false, message: 'Server error while deleting project.' });
//   }
// };

exports.deleteProject = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if project exists
    const project = await Project.findById(id);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found.'
      });
    }

    // Check for open tickets using BOTH project name and ID reference
    const openTickets = await Ticket.findOne({
      $or: [
        {
          qstClientProjectName: project.projectName,
          isTicketClosed: false
        },
        {
          qstProjectID: id,
          isTicketClosed: false
        }
      ]
    });

    if (openTickets) {
      return res.status(400).json({
        success: false,
        message: 'Project cannot be deleted as it has associated open tickets.'
      });
    }

    // Check for charge rates associated with this project 
    const existingChargeRates = await customerChargeRateListModel.findOne({
      project: id
    });

    if (existingChargeRates) {
      return res.status(400).json({
        success: false,
        message: 'Project cannot be deleted it has been associated with one or more charge rates.'
      });
    }

    // If no open tickets, proceed with deletion
    await Project.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Project deleted successfully.'
    });
  } catch (error) {
    console.error('Delete Project Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting project.',
      error: error.message
    });
  }
};

// why to controle uesd (👇👈:- try to differnciate to use all projects in table in drop downs)

// exports.getProjects = async (req, res) => {
//   try {


//     const projects = await Project.find()
//       .populate({
//       path: 'qstClient',
//       select: 'companyName companyShortName _id', // _id is always included by default
//       })
//       .sort({ createdAt: -1 });

//     res.status(200).json({
//       success: true,
//       message: 'Projects fetched successfully',
//       data: projects,
//     });
//   } catch (error) {
//     console.error('Get Projects Error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Server error while fetching projects',
//     });
//   }
// };


exports.getProjects = async (req, res) => {
  try {
    // 1️⃣ Extract query parameters
    const {
      search = "",
      page = 1,
      limit = 10,
      sort = "createdAt",
      order = "desc"
    } = req.query;

    const skip = (page - 1) * limit;

    // 2️⃣ Build search condition
    // For both projectName and qstClient fields
    const searchCondition = search
      ? {
        $or: [
          { projectName: { $regex: search, $options: "i" } },
          { "qstClient.companyName": { $regex: search, $options: "i" } },
          { "qstClient.companyShortName": { $regex: search, $options: "i" } }
        ]
      }
      : {};

    // 3️⃣ Use aggregation to search + paginate + populate
    const pipeline = [
      {
        $lookup: {
          from: "qstclients", // MongoDB collection name (lowercase + plural)
          localField: "qstClient",
          foreignField: "_id",
          as: "qstClient"
        }
      },
      { $unwind: { path: "$qstClient", preserveNullAndEmptyArrays: true } },
      { $match: searchCondition },
      {
        $sort: { [sort]: order === "desc" ? -1 : 1 }
      },
      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: Number(limit) }
          ],
          totalCount: [
            { $count: "count" }
          ]
        }
      }
    ];

    const result = await Project.aggregate(pipeline);

    const projects = result[0]?.data || [];
    const total = result[0]?.totalCount[0]?.count || 0;

    // 4️⃣ Response
    res.status(200).json({
      success: true,
      message: "Projects fetched successfully",
      data: projects,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("Get Projects Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching projects"
    });
  }
};











