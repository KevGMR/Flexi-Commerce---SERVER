// server/controllers/Backdate.js

const express = require("express");
const router = express.Router();
const { exec } = require("child_process");
const { promisify } = require("util");
const path = require("path");

const execPromise = promisify(exec);

// GET /admin/backdate-sales
router.get("/", async (req, res) => {
  const startTime = Date.now();
  console.log("[Backdate] ========== NEW REQUEST ==========");
  console.log("[Backdate] Request params:", req.query);

  try {
    const {
      organizationId,
      locationId,
      startDateTime,
      endDateTime,
      targetDate,
      modifiedBy,
      sampleSize = 20,
      dryRun = "true",
      apply = "false",
    } = req.query;

    console.log("[Backdate] Organization ID:", organizationId);
    console.log("[Backdate] Location ID:", locationId || "ALL");
    console.log("[Backdate] Source range:", startDateTime, "->", endDateTime);
    console.log("[Backdate] Target date:", targetDate);
    console.log("[Backdate] Sample size:", sampleSize);
    console.log("[Backdate] Dry run:", dryRun);
    console.log("[Backdate] Apply:", apply);

    // Validate required parameters
    if (!organizationId || !startDateTime || !endDateTime || !targetDate) {
      console.error("[Backdate] ERROR: Missing required parameters");
      return res.status(400).json({
        error: "Missing required parameters: organizationId, startDateTime, endDateTime, targetDate",
      });
    }

    const isDryRun = dryRun === "true" || apply !== "true";
    console.log("[Backdate] Mode:", isDryRun ? "DRY RUN" : "APPLY");
    
    if (!isDryRun && !modifiedBy) {
      console.error("[Backdate] ERROR: modifiedBy required when applying");
      return res.status(400).json({
        error: "modifiedBy is required when applying changes",
      });
    }

    // Build the command
    const scriptPath = path.join(__dirname, "..", "scripts", "backfill-sale-created-at.js");
    let command = `node ${scriptPath} --organizationId ${organizationId} --startDateTime "${startDateTime}" --endDateTime "${endDateTime}" --targetDate "${targetDate}" --sampleSize ${sampleSize}`;

    if (locationId) {
      command += ` --locationId ${locationId}`;
    }

    if (!isDryRun && modifiedBy) {
      command += ` --modifiedBy ${modifiedBy} --apply`;
    }

    console.log("[Backdate] Executing command:", command);

    const { stdout, stderr } = await execPromise(command, {
      cwd: path.join(__dirname, ".."),
      maxBuffer: 1024 * 1024 * 10,
      timeout: 300000,
    });

    console.log("[Backdate] Script completed in", Date.now() - startTime, "ms");
    
    if (stderr) {
      console.log("[Backdate] STDERR:", stderr);
    }

    // Parse output
    const lines = stdout.split("\n");
    console.log("[Backdate] Parsing output, lines:", lines.length);
    
    const stats = {};
    const sampleRows = [];
    const rawOutput = [];

    // Capture all lines for debugging
    lines.forEach(line => {
      if (line.trim()) {
        rawOutput.push(line);
      }
    });

    // Find the summary table
    const tableStart = lines.findIndex(line => line.includes("Backfill sale createdAt summary"));
    if (tableStart !== -1) {
      console.log("[Backdate] Found summary table at line", tableStart);
      const tableLines = lines.slice(tableStart, tableStart + 20);
      const tableText = tableLines.join("\n");
      console.log("[Backdate] Table text:", tableText);
      
      const matches = tableText.match(/(\w+)\s+(\d+)/g);
      if (matches) {
        matches.forEach(m => {
          const [key, val] = m.split(/\s+/);
          stats[key] = parseInt(val, 10);
        });
      }
      console.log("[Backdate] Parsed stats:", stats);
    } else {
      console.log("[Backdate] No summary table found in output");
    }

    // Find preview table
    const previewStart = lines.findIndex(line => line.includes("Preview"));
    if (previewStart !== -1) {
      console.log("[Backdate] Found preview table at line", previewStart);
      const previewLines = lines.slice(previewStart + 2);
      let rowCount = 0;
      for (const line of previewLines) {
        if (line.includes("│")) {
          const parts = line.split("│").map(p => p.trim()).filter(p => p);
          if (parts.length >= 4) {
            const row = {
              saleId: parts[0],
              beforeCreatedAtUtc: parts[1],
              afterCreatedAtUtc: parts[2],
              beforeShiftId: parts[3],
              afterShiftId: parts[4] || "unchanged",
              raw: line.trim(),
            };
            sampleRows.push(row);
            console.log("[Backdate] Preview row", rowCount + 1, ":", row);
            rowCount++;
            if (rowCount >= parseInt(sampleSize, 10)) break;
          }
        }
      }
      console.log("[Backdate] Found", sampleRows.length, "sample rows");
    } else {
      console.log("[Backdate] No preview table found in output");
    }

    const shiftsAffected = new Set();
    sampleRows.forEach(row => {
      if (row.afterShiftId && row.afterShiftId !== "unchanged") {
        shiftsAffected.add(row.afterShiftId);
      }
    });

    const response = {
      success: true,
      dryRun: isDryRun,
      stats,
      sampleRows,
      shiftsAffected: shiftsAffected.size,
      rawOutput: rawOutput.slice(0, 100), // First 100 lines for debugging
      stderr: stderr || null,
    };

    console.log("[Backdate] Response stats:", {
      success: true,
      dryRun: isDryRun,
      salesFound: stats.salesScanned || 0,
      salesToUpdate: stats.salesWouldUpdate || 0,
      shiftsAffected: shiftsAffected.size,
      sampleRows: sampleRows.length,
    });
    console.log("[Backdate] ========== REQUEST COMPLETE ==========");

    return res.status(200).json(response);
  } catch (error) {
    console.error("[Backdate] ERROR:", error);
    console.error("[Backdate] Error stack:", error.stack);
    return res.status(500).json({
      error: error.message,
      stderr: error.stderr || null,
    });
  }
});

module.exports = router;