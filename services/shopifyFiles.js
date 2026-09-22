/**
 * Shopify Files API wrapper.
 * Built against server/data/shopify.js → shopifyGraphQL(query, variables, operationName)
 * which returns the raw axios body: { data: {...}, extensions: {...} }
 */

const path = require("path");
const axios = require("axios");
const { shopifyGraphQL } = require("../data/shopify");

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const SUPPORTED_IMAGE_EXT = new Set(Object.keys(MIME_BY_EXT));

const STAGED_MUTATION = `
  mutation StagedUploads($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

const FILE_CREATE_MUTATION = `
  mutation FileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        fileStatus
        alt
        ... on MediaImage { image { url width height } }
        ... on GenericFile { url }
      }
      userErrors { field message }
    }
  }
`;

function extFromUrl(url) {
  try {
    const clean = String(url).split("?")[0];
    const ext = path.extname(clean).toLowerCase();
    return ext || ".jpg";
  } catch {
    return ".jpg";
  }
}

function mimeFromExt(ext) {
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

function isShopifySupported(ext) {
  return SUPPORTED_IMAGE_EXT.has(ext);
}

/** Download a remote image via axios. Returns { buffer, bytes, contentType } */
async function downloadImage(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 60_000,
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400,
  });
  return {
    buffer: Buffer.from(res.data),
    bytes: res.data.byteLength,
    contentType: res.headers["content-type"] || null,
  };
}

/** Upload one buffer to Shopify Files. */
async function uploadBuffer({ buffer, filename, mimeType, alt }) {
  // 1. stagedUploadsCreate
  const staged = await shopifyGraphQL(
    STAGED_MUTATION,
    {
      input: [
        {
          filename,
          mimeType,
          httpMethod: "POST",
          resourceUrl: "https://shopify.dev/apps/upload",
          fileSize: String(buffer.length),
        },
      ],
    },
    "StagedUploads"
  );

  const sErr = staged?.data?.stagedUploadsCreate?.userErrors;
  if (sErr?.length) {
    throw new Error(`stagedUploadsCreate: ${sErr.map((e) => e.message).join("; ")}`);
  }
  const target = staged?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) throw new Error("stagedUploadsCreate returned no target");

  // 2. POST multipart to the signed url
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([buffer], { type: mimeType }), filename);

  const up = await fetch(target.url, { method: "POST", body: form });
  if (!up.ok) {
    const text = await up.text().catch(() => "");
    throw new Error(`staged POST ${up.status}: ${text.slice(0, 200)}`);
  }

  // 3. fileCreate
  const created = await shopifyGraphQL(
    FILE_CREATE_MUTATION,
    {
      files: [
        { originalSource: target.resourceUrl, contentType: "IMAGE", alt: alt || "" },
      ],
    },
    "FileCreate"
  );

  const cErr = created?.data?.fileCreate?.userErrors;
  if (cErr?.length) {
    throw new Error(`fileCreate: ${cErr.map((e) => e.message).join("; ")}`);
  }
  const file = created?.data?.fileCreate?.files?.[0];
  if (!file) throw new Error("fileCreate returned no file");

  return {
    id: file.id,
    status: file.fileStatus,
    url: file.image?.url || file.url || null,
    width: file.image?.width,
    height: file.image?.height,
  };
}

/** Optional HEIC/HEIF → JPEG conversion. Requires `sharp` to be installed. */
async function convertHeicToJpeg(buffer) {
  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    throw new Error("sharp_not_installed");
  }
  const out = await sharp(buffer).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  return { buffer: out, ext: ".jpg", mimeType: "image/jpeg" };
}

module.exports = {
  downloadImage,
  uploadBuffer,
  convertHeicToJpeg,
  extFromUrl,
  mimeFromExt,
  isShopifySupported,
  SUPPORTED_IMAGE_EXT,
};