// // deleteImage.js
// const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
// const s3 = require("./s3Client");

// const deleteImage = async (bucketName, key) => {
//   const command = new DeleteObjectCommand({
//     Bucket: bucketName,
//     Key: key
//   });

//   try {
//     await s3.send(command);
//     return {
//       success: true,
//       message: "Image deleted successfully"
//     };
//   } catch (error) {
//     console.error("Delete error:", error);
//     return {
//       success: false,
//       message: "Failed to delete image",
//       error
//     };
//   }
// };

// module.exports = deleteImage;

// // uploadImage.js
// const { PutObjectCommand } = require("@aws-sdk/client-s3");
// const s3 = require("./s3Client");
// const path = require("path");

// const uploadImage = async (fileBuffer, fileName, bucketName, folder = "") => {
//   const key = folder ? `${folder}/${fileName}` : fileName;

//   const command = new PutObjectCommand({
//     Bucket: bucketName,
//     Key: key,
//     Body: fileBuffer,
//     ContentType: "image/jpeg" // or detect dynamically
//   });

//   try {
//     await s3.send(command);
//     return {
//       success: true,
//       message: "Image uploaded successfully",
//       key: key,
//       url: `https://${bucketName}.s3.amazonaws.com/${key}`
//     };
//   } catch (error) {
//     console.error("Upload error:", error);
//     return {
//       success: false,
//       message: "Failed to upload image",
//       error
//     };
//   }
// };

// module.exports = uploadImage;
// -----------------------------------------------------------------------------------------------------  

// In your server routes file (e.g., routes/fileUpload.js)
const express = require('express');
const AWS = require('aws-sdk');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// Configure AWS SDK
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});





// Generate presigned URL
router.post('/generate-presigned-url', async (req, res) => {
  try {
    const { fileName, fileType, isPublic = true } = req.body;

    if (!fileName || !fileType) {
      return res.status(400).json({
        success: false,
        message: 'File name and type are required'
      });
    }

    // Generate unique key for the file
    const fileExt = fileName.split('.').pop();
    const key = `ticket-attachments/${uuidv4()}.${fileExt}`;

    const params = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
      ContentType: fileType,
      Expires: 60 * 10, // URL expires in 5 minutes
      // ACL: 'private' // Set appropriate permissions
    };
    //  if (isPublic) {
    //     params.CacheControl = 'public, max-age=5184000'; // 60 days in seconds
    //     params.Metadata = {
    //       'Cache-Control': 'public, max-age=5184000'
    //     };
    //   }

    const presignedUrl = await s3.getSignedUrlPromise('putObject', params);

    // Generate public URL (choose one option below)
    const publicUrl = process.env.FILE_CDN_URL
      ? `${process.env.FILE_CDN_URL}/${key}`
      : `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

    res.json({
      success: true,
      url: presignedUrl,
      key: key,
      publicUrl: publicUrl
    });
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate presigned URL'
    });
  }
});

// exports.deleteFromS3 = async (key) => {
//   if (!key) return true; // Skip if no key provided
//   console.log("images deleted run")
//   const params = {
//     Bucket: process.env.AWS_S3_BUCKET_NAME,
//     Key: key
//   };

//   try {
//     await s3.deleteObject(params).promise();
//     console.log(`Successfully deleted ${key} from S3 ...................`);
//     return true;
//   } catch (error) {
//     console.error(`Error deleting ${key} from S3:`, error);
//     throw error;
//   }
// };



//  const extractS3Key = (url) => {
//   if (!url) return '';
//   // If it's already a key (no http), return as-is
//   if (!url.startsWith('http')) return url;
// // Extract key from URL format: https://bucket.s3.region.amazonaws.com/key
//   try {
//     const urlObj = new URL(url);
//     return urlObj.pathname.substring(1); // Remove leading slash
//   } catch (e) {
//     console.error('Invalid S3 URL:', url);
//     return url; // fallback to returning original
//   }
// };




module.exports = router