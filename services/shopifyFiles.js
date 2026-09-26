/**
 * Shopify Files API wrapper — env-store only.
 *
 * All image uploads go to the store configured in .env (DOMAIN,
 * SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET). This is intentional: Flexi
 * products are hosted by us, and their media lives on our Shopify store.
 * Per-org Shopify connections are used elsewhere (ShopifyController,
 * shopifySync) and are not touched by this service.
 */

const path = require("path");
const axios = require("axios");
const { getEnvAccessToken } = require("../data/shopifyAuth");

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const SUPPORTED_IMAGE_EXT = new Set(Object.keys(MIME_BY_EXT));
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB — Shopify's hard cap

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

const FILE_QUERY = `
  query FileStatus($id: ID!) {
    node(id: $id) {
      ... on MediaImage {
        id
        fileStatus
        alt
        image { url width height }
      }
      ... on GenericFile {
        id
        fileStatus
        url
      }
    }
  }
`;

const FILE_DELETE_MUTATION = `
  mutation FileDelete($fileIds: [ID!]!) {
    fileDelete(fileIds: $fileIds) {
      deletedFileIds
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

/**
 * Post a GraphQL mutation against the env store.
 * Throws with code SHOPIFY_FROZEN if Shopify returns "Unavailable Shop".
 */
async function envGraphQL(query, variables, operationName) {
  const storeUrl = process.env.DOMAIN;
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2024-10";

  if (!storeUrl) {
    const err = new Error("DOMAIN is not set in .env");
    err.code = "ENV_SHOPIFY_CREDENTIALS_MISSING";
    throw err;
  }

  const { accessToken } = await getEnvAccessToken();
  const url = `https://${storeUrl}/admin/api/${apiVersion}/graphql.json`;

  let response;
  try {
    response = await axios.post(
      url,
      { query, variables, operationName },
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        timeout: 30_000,
        validateStatus: () => true,
      },
    );
  } catch (networkError) {
    const err = new Error(`Shopify request failed: ${networkError.message}`);
    err.code = "SHOPIFY_NETWORK_ERROR";
    throw err;
  }

  // Detect 402 (frozen / payment required)
  if (response.status === 402) {
    const err = new Error(
      "Shopify store is frozen (payment required). Check billing in the Shopify admin.",
    );
    err.code = "SHOPIFY_FROZEN";
    err.statusCode = 402;
    throw err;
  }

  if (response.status === 401 || response.status === 403) {
    const err = new Error(
      "Shopify rejected the env credentials (401/403). Check SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET.",
    );
    err.code = "SHOPIFY_AUTH_FAILED";
    err.statusCode = response.status;
    throw err;
  }

  if (response.status >= 400) {
    const err = new Error(
      `Shopify HTTP ${response.status}: ${JSON.stringify(response.data).slice(0, 200)}`,
    );
    err.code = "SHOPIFY_HTTP_ERROR";
    err.statusCode = response.status;
    throw err;
  }

  const data = response.data;

  if (data?.errors) {
    const serialized = JSON.stringify(data.errors);
    if (serialized.includes("Unavailable Shop") || serialized.includes("frozen")) {
      const err = new Error(
        "Shopify store is frozen — check billing in the Shopify admin.",
      );
      err.code = "SHOPIFY_FROZEN";
      throw err;
    }
    const err = new Error(`Shopify GraphQL: ${serialized}`);
    err.code = "SHOPIFY_GRAPHQL_ERROR";
    throw err;
  }

  return data;
}

/**
 * Step 1: ask Shopify for a signed upload target.
 * Returns { url, resourceUrl, parameters }.
 */
async function createStagedUpload({ filename, mimeType, fileSize }) {
  if (!filename || !mimeType || !fileSize) {
    throw new Error("filename, mimeType, and fileSize are required");
  }

  if (fileSize > MAX_IMAGE_BYTES) {
    const err = new Error(
      `File exceeds Shopify's ${MAX_IMAGE_BYTES / 1024 / 1024}MB limit`,
    );
    err.code = "FILE_TOO_LARGE";
    throw err;
  }

  const response = await envGraphQL(
    STAGED_MUTATION,
    {
      input: [
        {
          filename,
          mimeType,
          httpMethod: "POST",
          resource: "IMAGE",
          fileSize: String(fileSize),
        },
      ],
    },
    "StagedUploads",
  );

  const userErrors = response?.data?.stagedUploadsCreate?.userErrors;
  if (userErrors?.length) {
    throw new Error(
      `stagedUploadsCreate: ${userErrors.map((e) => e.message).join("; ")}`,
    );
  }

  const target = response?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) throw new Error("stagedUploadsCreate returned no target");

  return {
    url: target.url,
    resourceUrl: target.resourceUrl,
    parameters: target.parameters || [],
  };
}

/**
 * Poll a Shopify file until its status is READY and CDN URL is populated.
 * Files are processed asynchronously — fileCreate returns before the URL exists.
 */
async function waitForFileReady(
  shopifyFileId,
  { maxAttempts = 15, intervalMs = 1000 } = {},
) {
  let lastStatus = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await envGraphQL(
      FILE_QUERY,
      { id: shopifyFileId },
      "FileStatus",
    );

    const node = response?.data?.node;
    const url = node?.image?.url || node?.url || null;
    const status = node?.fileStatus;
    lastStatus = status;

    if (status === "READY" && url) {
      return {
        url,
        width: node?.image?.width ?? null,
        height: node?.image?.height ?? null,
        status,
      };
    }

    if (status === "FAILED") {
      const err = new Error(
        `Shopify file processing failed: ${shopifyFileId} (status=${status})`,
      );
      err.code = "SHOPIFY_FILE_FAILED";
      throw err;
    }

    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  const err = new Error(
    `Shopify file did not become READY within ${maxAttempts}s: ${shopifyFileId} (last status: ${lastStatus})`,
  );
  err.code = "SHOPIFY_FILE_TIMEOUT";
  throw err;
}

/**
 * Step 3: register the uploaded file with Shopify Files, then wait for
 * the CDN URL to be populated.
 * Returns { shopifyFileId, url, width, height }.
 */
async function finalizeUpload({ resourceUrl, alt }) {
  if (!resourceUrl) throw new Error("resourceUrl is required");

  const response = await envGraphQL(
    FILE_CREATE_MUTATION,
    {
      files: [
        {
          originalSource: resourceUrl,
          contentType: "IMAGE",
          alt: alt || "",
        },
      ],
    },
    "FileCreate",
  );

  const userErrors = response?.data?.fileCreate?.userErrors;
  if (userErrors?.length) {
    throw new Error(`fileCreate: ${userErrors.map((e) => e.message).join("; ")}`);
  }

  const file = response?.data?.fileCreate?.files?.[0];
  if (!file) throw new Error("fileCreate returned no file");

  // If Shopify already returned a URL, use it. Otherwise poll until ready.
  let url = file.image?.url || file.url || null;
  let width = file.image?.width ?? null;
  let height = file.image?.height ?? null;
  let status = file.fileStatus;

  if (!url) {
    const ready = await waitForFileReady(file.id);
    url = ready.url;
    width = ready.width;
    height = ready.height;
    status = ready.status;
  }

  if (!url) {
    const err = new Error(
      `Shopify returned a file with no URL after polling: ${file.id}`,
    );
    err.code = "SHOPIFY_FILE_NO_URL";
    throw err;
  }

  return {
    shopifyFileId: file.id,
    status,
    url,
    width,
    height,
  };
}

/**
 * Delete a file from Shopify Files by GID.
 * Best-effort — used by the form-unmount cleanup path.
 */
async function deleteFile({ shopifyFileId }) {
  if (!shopifyFileId) return { deleted: false };

  const response = await envGraphQL(
    FILE_DELETE_MUTATION,
    { fileIds: [shopifyFileId] },
    "FileDelete",
  );

  const userErrors = response?.data?.fileDelete?.userErrors;
  if (userErrors?.length) {
    throw new Error(`fileDelete: ${userErrors.map((e) => e.message).join("; ")}`);
  }

  return {
    deleted: (response?.data?.fileDelete?.deletedFileIds || []).length > 0,
  };
}

/**
 * Download a remote image via axios. Returns { buffer, bytes, contentType }.
 * Used by import scripts.
 */
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

/**
 * Buffer-based upload for import scripts: staged → POST bytes → fileCreate → poll.
 */
async function uploadBuffer({ buffer, filename, mimeType, alt }) {
  const staged = await createStagedUpload({
    filename,
    mimeType,
    fileSize: buffer.length,
  });

  const form = new FormData();
  for (const p of staged.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([buffer], { type: mimeType }), filename);

  const up = await fetch(staged.url, { method: "POST", body: form });
  if (!up.ok) {
    const text = await up.text().catch(() => "");
    throw new Error(`staged POST ${up.status}: ${text.slice(0, 200)}`);
  }

  return finalizeUpload({ resourceUrl: staged.resourceUrl, alt });
}

/** Optional HEIC/HEIF → JPEG conversion. Requires `sharp`. */
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
  createStagedUpload,
  finalizeUpload,
  waitForFileReady,
  deleteFile,
  downloadImage,
  uploadBuffer,
  convertHeicToJpeg,
  extFromUrl,
  mimeFromExt,
  isShopifySupported,
  SUPPORTED_IMAGE_EXT,
  MAX_IMAGE_BYTES,
  envGraphQL, // exported for tests / debugging
};