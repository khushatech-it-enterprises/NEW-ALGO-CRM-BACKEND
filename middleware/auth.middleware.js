const jwt = require("jsonwebtoken");
const Employee = require("../models/employee.model");
const User = require("../models/user.model");

const isAuthenticated = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    //⚠️ before chnanging 401 status message please ensure that also add chnages in fronted utils/api componet in axios interceptors because we strictaly compare status and message for unauthorization.
    return res.status(401).json({ message: "Unauthorized access" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let user = await Employee.findById(decoded.userId); // from employee data
    if (!user) {
      user = await User.findById(decoded.userId);
    }
    
    if (!user) {
      return res.status(401).json({ message: "User not found in database" });
    }
    
    req.user = user;
    // console.log("Authenticated user:", user);

    next();
  } catch {
    //⚠️ before chnanging 401 status message please ensure that also add chnages in fronted utils/api componet in axios interceptors because we strictaly compare status and message for unauthorization
    return res.status(401).json({ message: "Invalid token" });
  }
};

const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ message: "User not found or unauthorized" });
    }
    if (!roles.includes(req.user.role))
      return res
        .status(403)
        .json({ message: `Access denied for role ${req.user.role}` });
    next();
  };
};

module.exports = {
  isAuthenticated,
  authorizeRoles,
};
