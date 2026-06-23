require("dotenv").config();
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");

const User = require("../models/User");
const Organization = require("../models/Organization");
const Location = require("../models/Location");
const UserOrganization = require("../models/UserOrganization");
const { getMembershipPermissionsForRole } = require("../utils/effectivePermissions");

const hasFlag = (flag) => process.argv.includes(flag);
const getArgValue = (key) => {
  const raw = process.argv.find((entry) => entry.startsWith(`${key}=`));
  if (!raw) return null;
  return raw.slice(key.length + 1);
};

const apply = hasFlag("--apply");
const dryRun = !apply || hasFlag("--dry-run");
const force = hasFlag("--force");

const targetMemberships = [
  {
    email: "gatamukevin7@gmail.com",
    fullname: "Kevin Gatamu",
    role: "Owner",
    organizationId: "69cd1da793dffbb5c31dc9f0",
    organizationSlug: "house-of-queens",
    setOrgOwner: true,
    source: "next-development.log:6",
  },
  {
    email: "njokimuthonim31@gmail.com",
    fullname: "Mercy Muthoni",
    role: "Manager",
    organizationId: "69cd1da793dffbb5c31dc9f0",
    organizationSlug: "house-of-queens",
    setOrgOwner: false,
    source: "next-development.log:2818-2822",
  },
  {
    email: "kevingatamumuthoni@gmail.com",
    fullname: "Kevin Gatamu",
    role: "Owner",
    organizationId: "6a0ea9ec202ee117d64d28ed",
    organizationSlug: "flexi-commerce-1",
    setOrgOwner: true,
    source: "next-development.log:3376-3380",
  },
];

const validateTargetConfig = () => {
  const seen = new Set();
  for (const entry of targetMemberships) {
    const key = `${entry.email.toLowerCase()}|${entry.organizationId}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate target membership in config: ${key}`);
    }
    seen.add(key);
  }
};

const buildPasswordForEmail = (email) => {
  const envPrefix = getArgValue("--tempPasswordPrefix") || process.env.RESTORE_TEMP_PASSWORD_PREFIX || "FlexiPOS!";
  const hash = crypto.createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 8);
  return `${envPrefix}${hash}`;
};

async function ensureConnected() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not set");
  }

  await mongoose.connect(process.env.MONGO_URI);
}

async function findOrganizationOrThrow(organizationId, expectedSlug) {
  const org = await Organization.findById(organizationId).select("_id slug name ownerId status");
  if (!org) {
    throw new Error(`Organization not found: ${organizationId}`);
  }

  if (expectedSlug && org.slug !== expectedSlug && !force) {
    throw new Error(
      `Organization slug mismatch for ${organizationId}: expected '${expectedSlug}', got '${org.slug}'. Re-run with --force to bypass.`
    );
  }

  return org;
}

async function getDefaultOrgLocationIds(organizationId) {
  const locations = await Location.find({
    organizationId,
    status: "active",
  })
    .select("_id")
    .lean();

  return locations.map((location) => String(location._id));
}

async function upsertUser(entry, summary) {
  const email = entry.email.toLowerCase();
  const existing = await User.findOne({ email }).select("_id email fullname status emailVerified");

  if (existing) {
    summary.usersExisting += 1;

    const userPatch = {};
    if (!existing.emailVerified) userPatch.emailVerified = true;
    if (existing.status !== "active") userPatch.status = "active";

    if (Object.keys(userPatch).length > 0) {
      summary.usersPatched += 1;
      if (!dryRun) {
        await User.updateOne({ _id: existing._id }, { $set: userPatch });
      }
    }

    return {
      userId: existing._id,
      created: false,
      tempPassword: null,
    };
  }

  summary.usersCreated += 1;
  const tempPassword = buildPasswordForEmail(email);
  const passwordHash = await bcrypt.hash(tempPassword, Number(process.env.SALT) || 10);

  let createdUserId = null;
  if (!dryRun) {
    const created = await User.create({
      fullname: entry.fullname,
      email,
      password: passwordHash,
      status: "active",
      emailVerified: true,
      lastPasswordReset: new Date(),
    });
    createdUserId = created._id;
  } else {
    createdUserId = new mongoose.Types.ObjectId();
  }

  return {
    userId: createdUserId,
    created: true,
    tempPassword,
  };
}

async function upsertMembership(entry, userId, summary) {
  const permissions = await getMembershipPermissionsForRole(entry.role);
  const existingMembership = await UserOrganization.findOne({
    userId,
    organizationId: entry.organizationId,
  }).select("_id role status permissions locations");

  const desiredLocations = Array.isArray(entry.locations)
    ? entry.locations
    : await getDefaultOrgLocationIds(entry.organizationId);
  const updateDoc = {
    role: entry.role,
    status: "active",
    permissions,
    joinedAt: new Date(),
    locations: desiredLocations,
  };

  if (!existingMembership) {
    summary.membershipsCreated += 1;
    if (!dryRun) {
      await UserOrganization.create({
        userId,
        organizationId: entry.organizationId,
        ...updateDoc,
      });
    }
    return;
  }

  const needsUpdate =
    existingMembership.role !== entry.role ||
    existingMembership.status !== "active" ||
    JSON.stringify(existingMembership.permissions || []) !== JSON.stringify(permissions) ||
    JSON.stringify(existingMembership.locations || []) !== JSON.stringify(desiredLocations);

  if (!needsUpdate) {
    summary.membershipsUnchanged += 1;
    return;
  }

  summary.membershipsUpdated += 1;
  if (!dryRun) {
    await UserOrganization.updateOne(
      { _id: existingMembership._id },
      {
        $set: {
          role: updateDoc.role,
          status: updateDoc.status,
          permissions: updateDoc.permissions,
          locations: updateDoc.locations,
        },
      }
    );
  }
}

async function ensureOwnerLink(entry, userId, summary) {
  if (!entry.setOrgOwner) {
    return;
  }

  const org = await Organization.findById(entry.organizationId).select("_id ownerId");
  if (!org) {
    throw new Error(`Organization missing during owner update: ${entry.organizationId}`);
  }

  if (String(org.ownerId) === String(userId)) {
    summary.ownerLinksUnchanged += 1;
    return;
  }

  summary.ownerLinksUpdated += 1;
  if (!dryRun) {
    await Organization.updateOne({ _id: org._id }, { $set: { ownerId: userId } });
  }
}

async function verifyResult(summary) {
  for (const entry of targetMemberships) {
    const user = await User.findOne({ email: entry.email.toLowerCase() }).select("_id email").lean();
    if (!user) {
      summary.verifyFailures.push(`Missing user after restore: ${entry.email}`);
      continue;
    }

    const membership = await UserOrganization.findOne({
      userId: user._id,
      organizationId: entry.organizationId,
      status: "active",
    })
      .select("role")
      .lean();

    if (!membership) {
      summary.verifyFailures.push(
        `Missing active membership after restore: ${entry.email} -> ${entry.organizationId}`
      );
      continue;
    }

    if (membership.role !== entry.role) {
      summary.verifyFailures.push(
        `Role mismatch for ${entry.email}: expected ${entry.role}, got ${membership.role}`
      );
    }
  }
}

async function main() {
  validateTargetConfig();

  if (apply && !hasFlag("--yes")) {
    throw new Error("Apply mode requires explicit confirmation flag --yes");
  }

  const summary = {
    mode: dryRun ? "DRY RUN" : "APPLY",
    organizationsValidated: 0,
    usersExisting: 0,
    usersCreated: 0,
    usersPatched: 0,
    membershipsCreated: 0,
    membershipsUpdated: 0,
    membershipsUnchanged: 0,
    ownerLinksUpdated: 0,
    ownerLinksUnchanged: 0,
    verifyFailures: [],
    createdCredentials: [],
  };

  await ensureConnected();

  try {
    for (const entry of targetMemberships) {
      await findOrganizationOrThrow(entry.organizationId, entry.organizationSlug);
      summary.organizationsValidated += 1;
    }

    for (const entry of targetMemberships) {
      const userResult = await upsertUser(entry, summary);

      const userId = userResult.userId || (await User.findOne({ email: entry.email.toLowerCase() }).select("_id"))._id;
      await upsertMembership(entry, userId, summary);
      await ensureOwnerLink(entry, userId, summary);

      if (userResult.created) {
        summary.createdCredentials.push({
          email: entry.email.toLowerCase(),
          tempPassword: userResult.tempPassword,
        });
      }
    }

    if (!dryRun) {
      await verifyResult(summary);
    }

    console.log("\nRestore critical users summary");
    console.table({
      mode: summary.mode,
      organizationsValidated: summary.organizationsValidated,
      usersExisting: summary.usersExisting,
      usersCreated: summary.usersCreated,
      usersPatched: summary.usersPatched,
      membershipsCreated: summary.membershipsCreated,
      membershipsUpdated: summary.membershipsUpdated,
      membershipsUnchanged: summary.membershipsUnchanged,
      ownerLinksUpdated: summary.ownerLinksUpdated,
      ownerLinksUnchanged: summary.ownerLinksUnchanged,
      verifyFailures: summary.verifyFailures.length,
    });

    if (summary.createdCredentials.length > 0) {
      console.log("\nCreated user temporary credentials:");
      for (const cred of summary.createdCredentials) {
        console.log(`- ${cred.email} => ${cred.tempPassword}`);
      }
      console.log("\nRotate these temporary passwords immediately after first login.");
    }

    if (summary.verifyFailures.length > 0) {
      console.log("\nVerification failures:");
      for (const failure of summary.verifyFailures) {
        console.log(`- ${failure}`);
      }
      process.exitCode = 2;
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async (error) => {
  console.error("Restore failed:", error.message);
  try {
    await mongoose.disconnect();
  } catch (disconnectError) {
    console.error("Failed to disconnect cleanly:", disconnectError.message);
  }
  process.exit(1);
});
