const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const sendEmail = require("../utils/SendEmail");
const passwordResetTemplate = require("../emailTemplates/PasswordReset");
const { passwordValidator } = require("../utils/PasswordValidator");
const Employee = require("../models/employee.model");

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required." });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found." });

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    user.resetPasswordToken = { token, expires };
    await user.save();

    const resetUrl = `${(process.env.FRONTEND_URL || process.env.CLIENT_BASE_URL || "").replace(/\/api\/?$/, "")}/reset-password/${token}`;
    const html = passwordResetTemplate(user.email, resetUrl);

    await sendEmail({
      to: user.email,
      subject: "Reset Your Password",
      html,
    });

    res.status(200).json({ message: "Password reset link sent on email ." });
  } catch (error) {
    console.error("Forgot password error:", error);
    res
      .status(500)
      .json({ message: "Server error during password reset request." });
  }
};

// check token validation of reset password
const validateResetToken = async (req, res) => {
  try {
    const { token } = req.params;

    const user = await User.findOne({
      "resetPasswordToken.token": token,
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid reset token." });
    }

    if (user.resetPasswordToken.expires < new Date()) {
      return res.status(400).json({ message: "Reset token has expired." });
    }

    res.status(200).json({ message: "Reset token is valid." });
  } catch (error) {
    console.error("Validate reset token error:", error);
    res.status(500).json({ message: "Server error during token validation." });
  }
};

// Reset password and add new

const resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    // Validate password
    const validation = passwordValidator(password);
    if (!validation.isValid) {
      return res.status(400).json({
        message: validation.message,
        success: false,
      });
    }

    // Find user with valid token
    const user = await User.findOne({
      "resetPasswordToken.token": token,
      "resetPasswordToken.expires": { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({
        message: "Invalid or expired reset token.",
        success: false,
      });
    }

    // Update password
    user.password = await bcrypt.hash(validation.trimmedPassword, 10);
    user.resetPasswordToken = { token: null, expires: null };
    await user.save();

    res.status(200).json({
      message: "Password reset successful.",
      success: true,
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({
      message: "Server error during password reset.",
      success: false,
    });
  }
};

// const createUser = async (req, res) => {
//   try {
//     const { name, email, password, role } = req.body;

//     // 1. Input Validation
//     if (!name || !email || !password || !role) {
//       return res.status(400).json({
//         success: false,
//         message: "Name, email, password, and role are required.",
//       });
//     }

//     // 2. Role Restriction
//     const allowedRoles = ["admin", "cse"];
//     if (!allowedRoles.includes(role)) {
//       return res.status(403).json({
//         success: false,
//         message: `Role '${role}' is not allowed in employee creation.`,
//       });
//     }

//     // You must used trim password
//     // 3. Password Validation
//     const passwordValidation = passwordValidator(password);
//     if (!passwordValidation.isValid) {
//       return res.status(400).json({
//         success: false,
//         message: passwordValidation.message,
//       });
//     }

//     // 4. Email Uniqueness Check (case-insensitive)
//     const existingUser = await User.findOne({ email: email.trim().toLowerCase() });
//     if (existingUser) {
//       return res.status(409).json({
//         success: false,
//         message: "Email already registered.",
//       });
//     }

//     // 5. User Creation - Let the model's pre-save hook handle password hashing
//     const user = new User({
//       name: name.trim(),
//       email: email.trim().toLowerCase(),
//       password: passwordValidation.trimmedPassword, // Plain password - will be hashed by pre-save hook
//       role,
//     });

//     await user.save();

//     // 7. Response (exclude sensitive data)
//     res.status(201).json({
//       success: true,
//       message: `${role} created successfully`,
//       user: {
//         _id: user._id,
//         name: user.name,
//         email: user.email,
//         role: user.role,
//         createdAt: user.createdAt,
//       },
//     });
//   } catch (error) {
//     console.error("User creation error:", error);
//     res.status(500).json({
//       success: false,
//       message: "Server error during user creation",
//       error: process.env.NODE_ENV === "development" ? error.message : undefined,
//     });
//   }
// };


const createUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    console.log("Create user controller called with:", req.body);

    // 1. Input Validation
    if (!name || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: "Name, email, password, and role are required.",
      });
    }

    // 2. Role Restriction
    const allowedRoles = ["admin", "cse", "superAdmin"];
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        success: false,
        message: `Role '${role}' is not allowed in employee creation.`,
      });
    }

    // You must used trim password
    // 3. Password Validation
    const passwordValidation = passwordValidator(password);
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: passwordValidation.message,
      });
    }

    // 4. Email Uniqueness Check
    const existingUser = await Employee.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Email already registered.",
      });
    }

    // 5. Secure Password Hashing
    const hashedPassword = await bcrypt.hash(
      passwordValidation.trimmedPassword,
      10
    );

    // 6. User Creation
    const user = new Employee({
      name,
      email,
      password: hashedPassword,
      role,
    });

    await user.save();

    // 7. Response (exclude sensitive data)
    res.status(201).json({
      success: true,
      message: `${role} created successfully`,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("User creation error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during user creation",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};


// const login = async (req, res) => {
//   try {
//     // Log the raw request body for debugging
//     console.log("Raw request body:", JSON.stringify(req.body));

//     const { email, password } = req.body;

//     console.log("Login request received:", { 
//       email: email ? email.trim().toLowerCase() : "missing", 
//       passwordProvided: password ? "yes" : "no",
//       passwordLength: password ? password.length : 0
//     });

//     if (!email || !password) {
//       console.log("Login failed - Missing email or password");
//       const errorResponse = { message: "Email and password are required." };
//       console.log("Sending error response:", errorResponse);
//       return res
//         .status(400)
//         .json(errorResponse);
//     }

//     // Find user by email (case-insensitive search)
//     const normalizedEmail = email.trim().toLowerCase();

//     try {
//       const user = await User.findOne({ email: normalizedEmail });

//       if (!user) {
//         console.log("Login attempt - User not found for email:", normalizedEmail);
//         const errorResponse = { message: "Invalid email or password." };
//         console.log("Sending error response:", errorResponse);
//         return res.status(400).json(errorResponse);
//       }

//       console.log("Login attempt - User found:", user.email, "Role:", user.role);

//       // Use the model's matchPassword method
//       // Don't trim password - it might have been stored with spaces
//       const isMatch = await user.matchPassword(password.trim());

//       console.log("Password comparison result:", isMatch);

//       if (!isMatch) {
//         console.log("Login attempt - Password mismatch for user:", user.email);
//         const errorResponse = { message: "Invalid email or password." };
//         console.log("Sending error response:", errorResponse);
//         return res.status(400).json(errorResponse);
//       }

//       console.log("Login successful for user:", user.email);

//       // Check if JWT_SECRET is set
//       if (!process.env.JWT_SECRET) {
//         console.error("JWT_SECRET is not set in environment variables");
//         return res.status(500).json({ message: "Server configuration error." });
//       }

//       const token = jwt.sign(
//         {
//           userId: user._id,
//           role: user.role,
//         },
//         process.env.JWT_SECRET,
//         { expiresIn: "7d" }
//       );

//       res.status(200).json({
//         message: "Login successful.",
//         user: {
//           _id: user._id,
//           name: user.name,
//           email: user.email,
//           role: user.role,
//           isEmailVerify: user.isEmailVerify,
//         },
//         token: token,
//       });
//     } catch (dbError) {
//       console.error("Database error during login:", dbError);
//       throw dbError; // Re-throw to be caught by outer catch
//     }

//     console.log("Login attempt - User found:", normalizedEmail);

//     // Use the model's matchPassword method
//     // Don't trim password - it might have been stored with spaces
//     const isMatch = await user.matchPassword(password.trim());

//     console.log("Password comparison result:", isMatch);

//     if (!isMatch) {
//       console.log("Login attempt - Password mismatch for user:", user.email);
//       const errorResponse = { message: "Invalid email or password." };
//       console.log("Sending error response:", errorResponse);
//       return res.status(400).json(errorResponse);
//     }

//     console.log("Login successful for user:", user.email);

//     const token = jwt.sign(
//       {
//         userId: user._id,
//         role: user.role,
//       },
//       process.env.JWT_SECRET,
//       { expiresIn: "7d" }
//     );

//     res.status(200).json({
//       message: "Login successful.",
//       user: {
//         _id: user._id,
//         name: user.name,
//         email: user.email,
//         role: user.role,
//         isEmailVerify: user.isEmailVerify,
//       },
//       token: token,
//     });
//   } catch (error) {
//     console.error("Login error:", error);
//     console.error("Error stack:", error.stack);
//     res.status(500).json({ 
//       message: "Server error during login.",
//       error: process.env.NODE_ENV === "development" ? error.message : undefined
//     });
//   }
// };

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log("Login request received:", { email, passwordProvided: !!password });

    // console.log(req.body);

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required." });
    }

    const employee = await Employee.findOne({ email: email?.trim() });
    console.log("Employee found : ", employee);

    if (!employee) {
      return res.status(400).json({ message: "Invalid email  " });
    }

    const isMatch = await bcrypt.compare(password, employee.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password." });
    }

    const token = jwt.sign(
      {
        userId: employee._id,
        role: employee.role,
        isTelecaller: employee.isTelecaller,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).json({
      message: "Login successful.",
      user: {
        _id: employee._id,
        name: employee.name,
        email: employee.email,
        role: employee.role,
        isTelecaller: employee.isTelecaller,
        isEmailVerify: employee.isEmailVerify,
      },
      token: token,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error during login." });
  }
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required.",
      });
    }

    if (confirmPassword !== undefined && newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "New password and confirmation password do not match.",
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: "New password cannot be the same as current password.",
      });
    }

    const validation = passwordValidator(newPassword);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: validation.message,
      });
    }

    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated.",
      });
    }

    let targetUser = await Employee.findById(userId);
    let isEmployee = true;

    if (!targetUser) {
      targetUser = await User.findById(userId);
      isEmployee = false;
    }

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User account not found.",
      });
    }

    const isMatch = await bcrypt.compare(currentPassword, targetUser.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect.",
      });
    }

    const hashedPassword = await bcrypt.hash(validation.trimmedPassword, 10);
    if (isEmployee) {
      targetUser.password = hashedPassword;
      await targetUser.save();
    } else {
      targetUser.password = validation.trimmedPassword;
      await targetUser.save();
    }

    res.status(200).json({
      success: true,
      message: "Password changed successfully.",
    });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during password change.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

module.exports = {
  login,
  forgotPassword,
  resetPassword,
  validateResetToken,
  createUser,
  changePassword,
};

