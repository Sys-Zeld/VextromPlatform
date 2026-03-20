const crypto = require("crypto");
const db = require("../db");

function normalizePublicTokenLinkRow(row) {
  return {
    id: Number(row.id),
    slug: row.slug,
    profileId: Number(row.profile_id),
    profileName: row.profile_name || "",
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function createSlug() {
  return crypto.randomBytes(10).toString("hex");
}

async function listPublicTokenLinks() {
  const result = await db.query(
    `
      SELECT l.*, p.name AS profile_name
      FROM public_token_links l
      INNER JOIN field_profiles p
        ON p.id = l.profile_id
      ORDER BY l.created_at DESC, l.id DESC
    `
  );
  return result.rows.map(normalizePublicTokenLinkRow);
}

async function getPublicTokenLinkById(id) {
  const result = await db.query(
    `
      SELECT l.*, p.name AS profile_name
      FROM public_token_links l
      INNER JOIN field_profiles p
        ON p.id = l.profile_id
      WHERE l.id = $1
    `,
    [id]
  );
  return result.rows[0] ? normalizePublicTokenLinkRow(result.rows[0]) : null;
}

async function getPublicTokenLinkBySlug(slug) {
  const result = await db.query(
    `
      SELECT l.*, p.name AS profile_name
      FROM public_token_links l
      INNER JOIN field_profiles p
        ON p.id = l.profile_id
      WHERE l.slug = $1
    `,
    [String(slug || "").trim()]
  );
  return result.rows[0] ? normalizePublicTokenLinkRow(result.rows[0]) : null;
}

async function createPublicTokenLink(profileId) {
  const cleanProfileId = Number(profileId);
  if (!Number.isInteger(cleanProfileId) || cleanProfileId <= 0) {
    const err = new Error("Invalid profile.");
    err.statusCode = 422;
    throw err;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = createSlug();
    try {
      const result = await db.query(
        `
          INSERT INTO public_token_links (slug, profile_id, is_active, created_at, updated_at)
          VALUES ($1, $2, TRUE, NOW(), NOW())
          RETURNING *
        `,
        [slug, cleanProfileId]
      );
      return getPublicTokenLinkById(result.rows[0].id);
    } catch (err) {
      if (err.code === "23505") continue;
      throw err;
    }
  }

  const err = new Error("Could not generate unique link slug.");
  err.statusCode = 500;
  throw err;
}

async function setPublicTokenLinkActive(id, isActive) {
  const result = await db.query(
    `
      UPDATE public_token_links
      SET is_active = $2,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [id, Boolean(isActive)]
  );
  return result.rows[0] ? normalizePublicTokenLinkRow(result.rows[0]) : null;
}

async function deletePublicTokenLinkById(id) {
  const result = await db.query("DELETE FROM public_token_links WHERE id = $1", [id]);
  return result.rowCount > 0;
}

module.exports = {
  listPublicTokenLinks,
  getPublicTokenLinkById,
  getPublicTokenLinkBySlug,
  createPublicTokenLink,
  setPublicTokenLinkActive,
  deletePublicTokenLinkById
};
