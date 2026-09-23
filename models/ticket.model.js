const mongoose = require('mongoose');
const generateTicketSKUId = require('../utils/TicketSkuIdGenerator');

const ticketSchema = new mongoose.Schema({
  ticketSKUId: {
    type: String,
    required: true,
    unique: true,
    maxlength: 15,
    // here we generate  nanoId for ticketSKUId with retry menthods in collision (It used in banck neft remark option for unique ticket recognization) this handle from reate ticket controller
  },

  // Customer Information Fields (NEW)
  customerName: {
    type: String,
    default: '',
    required: false
  },
  mobile: {
    type: String,
    default: '',
    required: false
  },
  email: {
    type: String,
    default: '',
    required: false
  },
  pincode: {
    type: String,
    default: '',
    required: false
  },
  detailedAddress: {
    type: String,
    default: '',
    required: false
  },

  // Dashcam Information Fields (NEW)
  dashcamBrand: {
    type: String,
    default: '',
    required: false
  },
  dashcamType: {
    type: String,
    default: '',
    required: false
  },

  vehicleMake: {
    type: String,
    default: '',
    required: false
  },
  vehicleModel: {
    type: String,
    default: '',
    required: false
  },
  registrationNumber: {
    type: String,
  },

  price: {
    type: Number,
    default: 0,
    required: false
  },
  securityCodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SecurityCode',
    required: false, // optional during creation if technician not assigned
  },

  qstClientName: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QstClient',
    required: true,
  },
  taskType: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    required: true,
  },
  deviceType: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Device',
    required: false,
  },
  location: {
    type: String,
    required: true,
    default: '',
  },
  oldVehicleNumber: {
    type: [String],
    default: [],
    required: false,
  },

  vehicleNumbers: [
    {
      vehicleNumber: {
        type: String,
        required: true,
      },
      images: {
        type: [String],
        default: [],
      },
      videoURL: {
        type: String,
        default: ""
      },
      isResinstalationTypeNewVehicalNumber: {
        type: Boolean,
        default: false
      }, // this line ensure that , this ticket combination of old new vehical type

      isDone: {
        type: Boolean,
        default: false
      }, // technician marks this vehicle as done (work completed on-site)

      // Wiring verification results from AlgoTrack APIs
      wiringVerification: {
        ignition: {
          status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
          response: { type: mongoose.Schema.Types.Mixed, default: null },
          verifiedAt: { type: Date, default: null }
        },
        mainPowerSupply: {
          status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
          response: { type: mongoose.Schema.Types.Mixed, default: null },
          verifiedAt: { type: Date, default: null }
        },
        latLong: {
          status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
          response: { type: mongoose.Schema.Types.Mixed, default: null },
          verifiedAt: { type: Date, default: null }
        },
        pcsGps: {
          status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
          response: { type: mongoose.Schema.Types.Mixed, default: null },
          verifiedAt: { type: Date, default: null }
        }
      }

    }
  ],
  noOfVehicles: {
    type: Number,
    required: true,
  },
  description: {
    type: String,
    default: '',
  },
  assignee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true,
  },
  qstClientTicketNumber: {
    type: String,
    required: false,
    default: '',
  },
  qstClientProjectName: {
    type: String,
    default: '',
  },
  technician: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Technician',
    // required: true,
  },

  qstProjectID: {  // Add this new field
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
  },

  // Add new reference fields (issueFoundRef and resolutionRef add because we want to papluate issue and resolution from there collection and in exting issueFound and resolution field we will store as string Id that are not possible to papulate (08/09/025))
  issueFoundRef: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'IssueFound',
    required: false,
  },
  resolutionRef: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Resolution',
    required: false,
  },
  imeiNumbers: {
    type: [String],
    default: [],
  },
  simNumbers: {
    type: [String],
    default: [],
  },
  issueFound: {
    type: String,
    default: '',
  },
  resolution: {
    type: String,
    default: '',
  },
  technicianCharges: {
    type: Number,
    default: 0,
  },
  materialCharges: {
    type: Number,
    default: 0,
  },
  courierCharges: {
    type: Number,
    default: 0,
  },
  customerConveyance: {
    type: Number,
    default: 0,
  },
  techConveyance: {
    type: Number,
    default: 0,
  },

  remark: {
    type: String,
    default: ""
  },


  techAccountNumber: {
    type: String,
    default: '',
  },
  techIFSCCode: {
    type: String,
    default: '',
  },
  accountHolderName: {
    type: String,
    default: '',
  },
  // this is used to show data when qstClient will deleted any how then qstClientName objectId will be null 
  qstClientNameString: {
    type: String,
    default: '',
  },

  technicianNameString: {
    type: String,
    default: ""
  },

  // NEW: Terms & Conditions Agreement
  agreedToTerms: {
    type: Boolean,
    default: false,
  },
  termsAgreedAt: {
    type: Date,
    default: null,
  },

  devicetypeNameString: {
    type: String,
    default: "",
  },
  assigneeNameString: {
    type: String,
    default: "",
  },


  // this is used to show data when taskType will deleted any how then taskType objectId will be null 
  taskTypeString: {
    type: String,
    default: '',
  },

  vehicleRegistrationNumber: {
    type: String,
    default: '',
  },

  state: {
    type: String,
    default: '',
  },
  subjectLine: {
    type: String,
    default: '',
  },
  ticketStatus: {
    type: String,
    default: 'Open',
  },
  totalTechCharges: {
    type: Number,
    default: 0,
  },
  customerCharges: {
    type: Number,
    default: 0,
  },
  totalCustomerCharges: {
    type: Number,
    default: 0,
  },
  reasonForTicketClosure: {
    type: String,
    default: '',
  },
  isTicketClosed: {
    type: Boolean,
    default: false,
  },
  //  attachedFiles: [{
  //     key: String,
  //     name: String,
  //     type: String,
  //     size: Number,
  //     url: String
  //   }],
  attachedFiles: [String],

  dueDate: {
    type: Date,
    required: true
  },

  dueDateEditCount: {
    type: Number,
    default: 0,
    min: 0,
    max: 2
  },


  ticketAvailabilityDate: {  // also known as vehicle avalability date
    type: Date,
    required: false,
    default: null

  },
  annexturepaid: {
    type: Boolean,
    default: false
  },
  isTechnicianPaymentSuccess: {
    type: Boolean,
    default: false
  },
  isTechnicianPaymentSuccessDate: {
    type: Date,
  },
  // this ticket is created by client not org employee....
  autoAssigned: {
    type: Boolean,
    default: false
  },
  chargeApplyComment: {  // ← ADD THIS FIELD
    type: String,
    default: '',
  },

  DueDateChangeLog: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DueDateChangeLog'
  }],
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true,
  },

  paymentDetails: {
    type: {
      razorpay_payment_id: { type: String, default: null },
      razorpay_order_id: { type: String, default: null },
      razorpay_signature: { type: String, default: null },
      amountPaid: { type: Number, default: null }, // Actual amount paid in ₹
      originalAmount: { type: Number, default: null }, // Full ticket price in ₹
      paymentGateway: { type: String, default: null }, // "Razorpay", "Cash", "Paytm", etc.
      isPaymentReceived: { type: Boolean, default: false }
    },
    default: null
  },

  // Spare item swap tracking
  spareSwaps: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DefectiveItemSwap'
  }],

  softCloseByTechnician: {
    type: Boolean,
    default: false
  },

  softCloseByTechnicianDate: {
    type: Date,
    default: null
  },

  softCloseByTechnicianComment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TicketCloser',
  },

}, {
  timestamps: true,
});

module.exports = mongoose.model('Tickets', ticketSchema);
