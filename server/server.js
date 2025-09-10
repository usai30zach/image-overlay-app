// server.js
// Backend for TIFF -> PNG conversion with Sharp + ImageMagick fallback

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const sharp = require("sharp");
const { spawn } = require("child_process");

const app = express();

// -- CORS: allow local dev & your Netlify site (add your prod domain here)
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://imgoverlay.netlify.app",
    ],
  })
);

// -- Multer: keep file in memory (RAM); cap size to avoid abuse
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
});

// -------- ImageMagick helper (TIFF stdin -> PNG stdout) --------
function convertViaMagick(buffer, { transparent = false, cmd = "magick" } = {}) {
  // For Linux images that use "convert" instead of "magick", set cmd: "convert"
  const args = transparent
    ? [
        "tiff:-",
        "-alpha", "on",          // keep alpha
        "-colorspace", "sRGB",
        "png:-",
      ]
    : [
        "tiff:-",
        "-background", "white",  // fill transparent areas with white
        "-alpha", "remove",      // drop alpha
        "-flatten",              // composite over white
        "-colorspace", "sRGB",
        "png:-",
      ];

  return new Promise((resolve, reject) => {
    const { spawn } = require("child_process");
    const proc = spawn(cmd, args);
    const out = [];
    let err = "";
    proc.stdout.on("data", d => out.push(d));
    proc.stderr.on("data", d => (err += d.toString()));
    proc.on("close", code => {
      if (code === 0) return resolve(Buffer.concat(out));
      reject(new Error(`${cmd} exited ${code}: ${err || "no stderr"}`));
    });
    proc.stdin.end(buffer);
  });
}

// --- route: POST /upload?bg=transparent|white (default white) ---
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const input = req.file.buffer;
    const wantTransparent = (req.query.bg === "transparent");

    // try metadata (ok if it fails)
    let meta = {};
    try {
      meta = await sharp(input, { limitInputPixels: false }).metadata();
    } catch {}

    // Fast path: SHARP
    try {
      const page0 = typeof meta.pages === "number" && meta.pages > 0 ? 0 : undefined;

      let pipe = sharp(input, { limitInputPixels: false, page: page0 })
        .toColorspace("srgb");

      if (!wantTransparent) {
        pipe = pipe.flatten({ background: "#ffffff" }); // white background
      } else {
        // keep alpha
      }

      // Optional: downscale huge frames to avoid OOM
      const W = meta.width || 0, H = meta.height || 0;
      if (W * H > 50_000_000) {
        pipe = pipe.resize({ width: 5000, height: 5000, fit: "inside" });
      }

      const pngBuffer = await pipe.png({ compressionLevel: 9 }).toBuffer();
      return res.json({ ok: true, via: "sharp", base64: pngBuffer.toString("base64") });
    } catch (sharpErr) {
      console.warn("Sharp failed (falling back to ImageMagick):", sharpErr?.message || sharpErr);
    }

    // Fallback: IMAGEMAGICK
    try {
      const pngBuffer = await convertViaMagick(input, { transparent: wantTransparent });
      return res.json({ ok: true, via: "magick", base64: pngBuffer.toString("base64") });
    } catch (magickErr) {
      console.error("ImageMagick fallback failed:", magickErr);
      return res.status(500).json({ error: "Image processing failed", detail: String(magickErr) });
    }
  } catch (e) {
    console.error("Unexpected server error:", e);
    return res.status(500).json({ error: "server_error", detail: String(e) });
  }
});


// -------- Route: POST /upload --------
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const input = req.file.buffer;

    // try to read metadata (ok if it fails)
    let meta = {};
    try {
      meta = await sharp(input, { limitInputPixels: false }).metadata();
    } catch (mErr) {
      console.warn("metadata() failed:", mErr?.message || mErr);
    }

    // --- FAST PATH (Sharp). Will likely refuse this TIFF, but we try.
    try {
      const page0 =
        typeof meta.pages === "number" && meta.pages > 0 ? 0 : undefined;

      let pipe = sharp(input, { limitInputPixels: false, page: page0 })
        .toColorspace("srgb")                 // normalize CMYK
        .flatten({ background: "#ffffff" });  // force white behind transparency

      // Optional: downscale extremely large images to avoid OOM
      const W = meta.width || 0, H = meta.height || 0;
      if (W * H > 50_000_000) {
        pipe = pipe.resize({ width: 5000, height: 5000, fit: "inside" });
      }

      const pngBuffer = await pipe.png({ compressionLevel: 9 }).toBuffer();
      return res.json({
        ok: true,
        via: "sharp",
        base64: pngBuffer.toString("base64"),
      });
    } catch (sharpErr) {
      console.warn(
        "Sharp failed (falling back to ImageMagick):",
        sharpErr?.message || sharpErr
      );
    }

    // --- FALLBACK (ImageMagick)
    try {
      const pngBuffer = await convertViaMagick(input);
      return res.json({
        ok: true,
        via: "magick",
        base64: pngBuffer.toString("base64"),
      });
    } catch (magickErr) {
      console.error("ImageMagick fallback failed:", magickErr);
      return res
        .status(500)
        .json({ error: "Image processing failed", detail: String(magickErr) });
    }
  } catch (e) {
    console.error("Unexpected server error:", e);
    return res.status(500).json({ error: "server_error", detail: String(e) });
  }
});


// -------- Start server --------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`✅ Uploader running on http://localhost:${PORT}`));
