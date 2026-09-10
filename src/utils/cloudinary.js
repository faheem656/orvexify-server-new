/** DROP-IN: src/utils/cloudinary.js
 * Same env as blog images:
 *   CLOUDINARY_URL
 *   or CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET
 */

const cloudinary = require('cloudinary').v2;

let ready = false;

function configure() {
  if (ready) return cloudinary;
  if (process.env.CLOUDINARY_URL) {
    cloudinary.config({ secure: true });
  } else if (
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  ) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  } else {
    const err = new Error(
      'Cloudinary is not configured. Set CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET.'
    );
    err.code = 'CLOUDINARY_MISSING';
    err.status = 500;
    throw err;
  }
  ready = true;
  return cloudinary;
}

function clinicLogoPublicId(userId) {
  return `orvexify/clinic-logos/${String(userId)}`;
}

function uploadImageBuffer(buffer, publicId) {
  const client = configure();
  return new Promise((resolve, reject) => {
    const stream = client.uploader.upload_stream(
      {
        public_id: publicId,
        overwrite: true,
        invalidate: true,
        resource_type: 'image',
        transformation: [
          { width: 800, height: 800, crop: 'limit', quality: 'auto' },
        ],
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    stream.end(buffer);
  });
}

async function destroyImage(publicId) {
  try {
    const client = configure();
    await client.uploader.destroy(publicId, { invalidate: true });
  } catch (err) {
    console.error('cloudinary destroy', err.message);
  }
}

module.exports = {
  configure,
  clinicLogoPublicId,
  uploadImageBuffer,
  destroyImage,
};
