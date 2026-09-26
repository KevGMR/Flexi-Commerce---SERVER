const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const { logTokenEvent } = require("../services/auditLogger");
const {
  createStagedUpload,
  finalizeUpload,
  deleteFile,
  MAX_IMAGE_BYTES,
  SUPPORTED_IMAGE_EXT,
} = require("../services/shopifyFiles");

/**
 * Map a service-layer error to an HTTP response.
 * Returns null if the error is not one we special-case.
 */
function mapShopifyError(error, res) {
  switch (error.code) {
    case "SHOPIFY_FROZEN":
      return res.status(503).json({
        error:
          "Shopify store is frozen — check billing in the Shopify admin.",
        code: "SHOPIFY_FROZEN",
      });
    case "ENV_SHOPIFY_CREDENTIALS_MISSING":
      return res.status(500).json({
        error:
          "Image uploads are not configured. Ask an admin to set DOMAIN, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET in the server .env.",
        code: "ENV_SHOPIFY_CREDENTIALS_MISSING",
      });
    case "SHOPIFY_AUTH_FAILED":
      return res.status(500).json({
        error:
          "Shopify rejected the image-hosting credentials. Check SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET.",
        code: "SHOPIFY_AUTH_FAILED",
      });
    case "FILE_TOO_LARGE":
      return res.status(413).json({ error: error.message, code: "FILE_TOO_LARGE" });
    case "SHOPIFY_NETWORK_ERROR":
      return res.status(504).json({
        error: "Could not reach Shopify. Try again in a moment.",
        code: "SHOPIFY_NETWORK_ERROR",
      });
    default:
      return null;
  }
}

/**
 * POST /products/images/staged-upload
 * Body: { filename, mimeType, fileSize }
 * Returns: { url, resourceUrl, parameters }
 */
router.post("/staged-upload", verifyToken, async (req, res) => {
  try {
    const { filename, mimeType, fileSize } = req.body;

    if (!filename || !mimeType || !fileSize) {
      return res.status(400).json({
        error: "filename, mimeType, and fileSize are required",
      });
    }

    if (fileSize > MAX_IMAGE_BYTES) {
      return res.status(413).json({
        error: `File exceeds ${MAX_IMAGE_BYTES / 1024 / 1024}MB limit`,
        code: "FILE_TOO_LARGE",
      });
    }

    const ext = "." + String(filename).split(".").pop().toLowerCase();
    if (!SUPPORTED_IMAGE_EXT.has(ext)) {
      return res.status(415).json({
        error: `Unsupported file type: ${ext}. Allowed: ${[...SUPPORTED_IMAGE_EXT].join(", ")}`,
        code: "UNSUPPORTED_FILE_TYPE",
      });
    }

    const staged = await createStagedUpload({ filename, mimeType, fileSize });
    return res.status(200).json(staged);
  } catch (error) {
    console.error("Staged upload error:", error.message);
    const mapped = mapShopifyError(error, res);
    if (mapped) return mapped;
    return res.status(500).json({
      error: error.message || "Failed to create staged upload",
    });
  }
});

/**
 * POST /products/images/finalize
 * Body: { resourceUrl, alt }
 * Returns: { shopifyFileId, url, width, height }
 */
router.post("/finalize", verifyToken, async (req, res) => {
  try {
    const { resourceUrl, alt } = req.body;

    if (!resourceUrl) {
      return res.status(400).json({ error: "resourceUrl is required" });
    }

    const result = await finalizeUpload({ resourceUrl, alt });

    await logTokenEvent(
      req.user.userId,
      req.user.organizationId,
      "image_uploaded",
      req.ip,
      req.get("user-agent"),
      { details: `Image uploaded: ${result.shopifyFileId}` },
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error("Finalize upload error:", error.message);
    const mapped = mapShopifyError(error, res);
    if (mapped) return mapped;
    return res.status(500).json({
      error: error.message || "Failed to finalize upload",
    });
  }
});

/**
 * DELETE /products/images/:shopifyFileId
 * Best-effort cleanup — called on form unmount for orphaned uploads.
 */
router.delete("/:shopifyFileId", verifyToken, async (req, res) => {
  try {
    const shopifyFileId = decodeURIComponent(req.params.shopifyFileId);

    if (!shopifyFileId.startsWith("gid://shopify/")) {
      return res.status(400).json({ error: "Invalid file ID" });
    }

    const result = await deleteFile({ shopifyFileId });
    return res.status(200).json(result);
  } catch (error) {
    console.error("Delete file error:", error.message);
    // Cleanup is best-effort — always 200 so the client's fire-and-forget
    // doesn't spam errors on unmount.
    return res.status(200).json({ deleted: false, error: error.message });
  }
});

module.exports = router;