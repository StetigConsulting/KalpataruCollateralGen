const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const fetch = require("node-fetch");
const fontkit = require("@pdf-lib/fontkit");
const opentype = require("opentype.js");

const {
  PDFDocument,
  rgb,
} = require("pdf-lib");

const app = express();

// ==========================================
// MULTER CONFIG
// ==========================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024,
  },
});

// ==========================================
// FONT LOADING (Poppins)
// ==========================================
// Poppins TTFs are pulled once from the Google Fonts repo mirror on
// raw.githubusercontent.com and cached in memory for the life of the
// process so we don't re-download them on every request. Poppins ships
// as real separate static-weight .ttf files directly under ofl/poppins/
// in the google/fonts repo (no variable-font wrapper), so each weight
// embeds cleanly into both the PNG footer (via SVG @font-face) and the
// PDF footer (via pdf-lib + fontkit).

const POPPINS_BOLD_URL =
  "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Bold.ttf";
const POPPINS_SEMIBOLD_URL =
  "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-SemiBold.ttf";
const POPPINS_REGULAR_URL =
  "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Regular.ttf";

let _fontCache = null;

// A valid TTF/OTF file starts with one of these 4-byte signatures.
// We check this after download so a bad URL (e.g. a 404 HTML page)
// fails with a clear error instead of the opaque pdf-lib
// "Unknown font format" error.
function assertValidFont(buf, label) {
  const sig = buf.slice(0, 4).toString("hex");
  const validSigs = ["00010000", "4f54544f", "74727565"]; // ttf / otf / 'true'
  if (!validSigs.includes(sig)) {
    throw new Error(
      `Failed to download a valid font for "${label}". ` +
      `Got ${buf.length} bytes starting with hex ${sig} (likely a 404/HTML response, not a font file).`
    );
  }
}

async function loadPoppinsFonts() {
  if (_fontCache) return _fontCache;

  const [boldRes, semiBoldRes, regularRes] = await Promise.all([
    fetch(POPPINS_BOLD_URL),
    fetch(POPPINS_SEMIBOLD_URL),
    fetch(POPPINS_REGULAR_URL),
  ]);

  if (!boldRes.ok || !semiBoldRes.ok || !regularRes.ok) {
    throw new Error(
      `Failed to download Poppins fonts (status codes: ` +
      `bold=${boldRes.status}, semiBold=${semiBoldRes.status}, regular=${regularRes.status})`
    );
  }

  const [boldBuf, semiBoldBuf, regularBuf] = await Promise.all([
    boldRes.buffer(),
    semiBoldRes.buffer(),
    regularRes.buffer(),
  ]);

  assertValidFont(boldBuf, "Poppins-Bold");
  assertValidFont(semiBoldBuf, "Poppins-SemiBold");
  assertValidFont(regularBuf, "Poppins-Regular");

  _fontCache = {
    bold: boldBuf,
    semiBold: semiBoldBuf,
    regular: regularBuf,
    // Parsed opentype.js Font objects — used to trace text directly into
    // SVG <path> outlines for the PNG footer. This sidesteps sharp/
    // librsvg's unreliable embedded @font-face support, which can
    // silently fall back to a system font instead of the real Poppins
    // glyphs. Since the paths are traced from the exact same TTF bytes
    // that pdf-lib embeds into the PDF, the rendered letterforms match
    // 1:1 between the PNG and PDF outputs.
    boldFont: opentype.parse(toArrayBuffer(boldBuf)),
    semiBoldFont: opentype.parse(toArrayBuffer(semiBoldBuf)),
    regularFont: opentype.parse(toArrayBuffer(regularBuf)),
  };

  return _fontCache;
}

// Buffer -> ArrayBuffer helper (opentype.js requires a plain ArrayBuffer,
// not a Node Buffer view).
function toArrayBuffer(buf) {
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength
  );
}

// Traces a line of text into an SVG <path> d-string using a parsed
// opentype.js font, so the PNG footer renders the exact same Poppins
// glyph outlines that get embedded into the PDF — no dependency on
// whatever fonts the SVG rasterizer (librsvg, via sharp) has installed.
function textToSvgPath(font, text, x, y, fontSize, fillColor) {
  if (!text) return "";
  const path = font.getPath(text, x, y, fontSize);
  const d = path.toPathData(2);
  return `<path d="${d}" fill="${fillColor}" />`;
}

// ==========================================
// IMAGE FOOTER FUNCTION
// ==========================================

async function generateImageWithFooter({
  imageBuffer,
  logoBuffer,
  companyName,
  email,
  phone,
  reraNumber,
}) {

  const FOOTER_HEIGHT = 170;

  const imageMeta =
    await sharp(imageBuffer).metadata();

  const width = imageMeta.width;

  const fonts = await loadPoppinsFonts();

  // ========================================
  // FOOTER BACKGROUND
  // ========================================

  const footer =
    await sharp({
      create: {
        width,
        height: FOOTER_HEIGHT,
        channels: 4,
        background: {
          r: 248,
          g: 248,
          b: 248,
          alpha: 1,
        },
      },
    })
      .png()
      .toBuffer();

  // ========================================
  // BUILD CONTACT LINE (email | phone, both bold + big)
  // ========================================

  const emailText = email?.trim() || "";
  const phoneText = phone?.trim() || "";
  const reraText = reraNumber?.trim() || "";

  const contactLine = [emailText, phoneText]
    .filter(Boolean)
    .join("   |   ");

  const line2 = reraText ? `RERA: ${reraText}` : "";

  // ========================================
  // SVG TEXT — rendered as traced vector paths from the actual
  // Poppins TTF (via opentype.js), not as <text>+@font-face. This
  // guarantees the PNG footer uses the real Poppins glyph outlines
  // regardless of what fonts the SVG rasterizer has available, and
  // keeps it visually identical to the PDF footer (same font bytes).
  // ========================================

  const textX = logoBuffer ? 170 : 18;

  const forMoreDetailsPath = textToSvgPath(
    fonts.semiBoldFont, "For More Details:", textX, 26, 17, "#333333"
  );

  const titlePath = textToSvgPath(
    fonts.boldFont, companyName, textX, 62, 36, "#000000"
  );

  const contactPath = contactLine
    ? textToSvgPath(fonts.boldFont, contactLine, textX, 96, 26, "#111111")
    : "";

  const reraPath = line2
    ? textToSvgPath(fonts.semiBoldFont, line2, textX, 124, 22, "#222222")
    : "";

  const partnerText = "PREFERRED CHANNEL PARTNER OF KALPATARU";
  const partnerPath = textToSvgPath(
    fonts.semiBoldFont, partnerText, textX, 150, 15, "#444444"
  );

  // const notePath = textToSvgPath(
  //   fonts.regularFont,
  //   "To know more details, kindly contact us at the above contact details.",
  //   textX, 178, 14, "#555555"
  // );

  const svgText = `
  <svg width="${width}" height="${FOOTER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    ${forMoreDetailsPath}
    ${titlePath}
    ${contactPath}
    ${reraPath}
    ${partnerPath}
  </svg>
  `;

  // ========================================
  // CREATE FOOTER
  // ========================================

  const compositeInputs = [
    {
      input: Buffer.from(svgText),
      top: 0,
      left: 0,
    },
  ];

  if (logoBuffer) {
    const resizedLogo =
      await sharp(logoBuffer)
        .resize(140, 140)
        .png()
        .toBuffer();

    // Logo anchored to the top of the footer (with a small margin),
    // not vertically centered.
    compositeInputs.unshift({
      input: resizedLogo,
      top: 15,
      left: 15,
    });
  }

  const finalFooter =
    await sharp(footer)
      .composite(compositeInputs)
      .png()
      .toBuffer();

  // ========================================
  // COMBINE IMAGE + FOOTER
  // ========================================

  return await sharp({
    create: {
      width,
      height: imageMeta.height + FOOTER_HEIGHT,
      channels: 4,
      background: {
        r: 255,
        g: 255,
        b: 255,
        alpha: 1,
      },
    },
  })
    .composite([
      {
        input: imageBuffer,
        top: 0,
        left: 0,
      },
      {
        input: finalFooter,
        top: imageMeta.height,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
}

// ==========================================
// PDF FOOTER FUNCTION (ORIGINAL — unchanged)
// ==========================================

async function generatePdfWithFooter({
  pdfBuffer,
  logoBuffer,
  companyName,
  email,
  phone,
  reraNumber,
}) {

  const originalPdf =
    await PDFDocument.load(pdfBuffer);

  const newPdf =
    await PDFDocument.create();

  newPdf.registerFontkit(fontkit);

  const copiedPages =
    await newPdf.copyPages(
      originalPdf,
      originalPdf.getPageIndices()
    );

  // ========================================
  // LOGO (optional)
  // ========================================

  let logoImage = null;

  if (logoBuffer) {
    try {
      logoImage = await newPdf.embedPng(logoBuffer);
    } catch {
      logoImage = await newPdf.embedJpg(logoBuffer);
    }
  }

  // ========================================
  // FONTS — Poppins (bold / semibold / regular)
  // ========================================

  const fonts = await loadPoppinsFonts();

  const titleFont = await newPdf.embedFont(fonts.bold, { subset: true });
  const contactFont = await newPdf.embedFont(fonts.bold, { subset: true });
  const reraFont = await newPdf.embedFont(fonts.semiBold, { subset: true });
  const noteFont = await newPdf.embedFont(fonts.regular, { subset: true });

  // ========================================
  // LAYOUT CONSTANTS
  // ========================================

  const FOOTER_HEIGHT = 115;
  const logoSize = 85;

  const emailText = email?.trim() || "";
  const phoneText = phone?.trim() || "";
  const reraText = reraNumber?.trim() || "";

  const contactLine = [emailText, phoneText]
    .filter(Boolean)
    .join("   |   ");

  // ========================================
  // PROCESS PAGES
  // ========================================

  for (let i = 0; i < copiedPages.length; i++) {
    const originalPage = copiedPages[i];
    const isLastPage = i === copiedPages.length - 1;

    const { width, height } =
      originalPage.getSize();

    const page = newPdf.addPage([
      width,
      height + (isLastPage ? FOOTER_HEIGHT : 0),
    ]);

    const FOOTER_Y = 0;

    if (isLastPage) {

      // Footer Background

      page.drawRectangle({
        x: 0,
        y: FOOTER_Y,
        width,
        height: FOOTER_HEIGHT,
        color: rgb(0.975, 0.975, 0.975),
      });

      // Bottom Accent Bar

      page.drawRectangle({
        x: 0,
        y: FOOTER_Y,
        width,
        height: 4,
        color: rgb(0.12, 0.35, 0.65),
      });

      // Divider Line (top of footer)

      page.drawLine({
        start: { x: 20, y: FOOTER_Y + FOOTER_HEIGHT },
        end: { x: width - 20, y: FOOTER_Y + FOOTER_HEIGHT },
        thickness: 1,
        color: rgb(0.82, 0.82, 0.82),
      });

      // Logo (only if provided)

      const logoX = 15;
      const textX = logoImage
        ? logoX + logoSize + 16
        : logoX;

      if (logoImage) {
        // Logo anchored to the top of the footer (with a small margin),
        // not vertically centered.
        const logoY =
          FOOTER_Y + FOOTER_HEIGHT - logoSize - 10;

        page.drawImage(logoImage, {
          x: logoX,
          y: logoY,
          width: logoSize,
          height: logoSize,
        });
      }

      // Text — company name (bold, big), contact line (bold, big),
      // RERA (semibold), note (regular)

      const footerCenterY =
        FOOTER_Y + FOOTER_HEIGHT / 2;

      page.drawText(companyName, {
        x: textX,
        y: footerCenterY + 30,
        size: 20,
        font: titleFont,
        color: rgb(0, 0, 0),
      });

      if (contactLine) {
        page.drawText(contactLine, {
          x: textX,
          y: footerCenterY + 10,
          size: 15,
          font: contactFont,
          color: rgb(0.05, 0.05, 0.05),
        });
      }

      if (reraText) {
        page.drawText(`RERA: ${reraText}`, {
          x: textX,
          y: footerCenterY - 9,
          size: 13,
          font: reraFont,
          color: rgb(0.1, 0.1, 0.1),
        });
      }

      page.drawText(
        "To know more details, kindly contact us at the above contact details.",
        {
          x: textX,
          y: footerCenterY - 27,
          size: 10.5,
          font: noteFont,
          color: rgb(0.25, 0.25, 0.25),
        }
      );
    }

    // Original Page (drawn above footer)

    const embeddedPage =
      await newPdf.embedPage(originalPage);

    page.drawPage(embeddedPage, {
      x: 0,
      y: isLastPage ? FOOTER_HEIGHT : 0,
      width,
      height,
    });
  }

  return await newPdf.save({
    useObjectStreams: false,
  });
}

// ==========================================
// ROUTE
// ==========================================

app.post(
  "/generate-file",

  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "logo", maxCount: 1 },
  ]),

  async (req, res) => {

    try {

      // File is required

      if (!req.files?.file) {
        return res.status(400).json({
          error: "File required",
        });
      }

      const file = req.files.file[0];

      // companyName and reraNumber are required

      const { companyName, email, phone, reraNumber } =
        req.body;

      if (!companyName?.trim()) {
        return res.status(400).json({
          error: "companyName required",
        });
      }

      if (!reraNumber?.trim()) {
        return res.status(400).json({
          error: "reraNumber required",
        });
      }

      // Logo: use only if uploaded, else null

      const logo = req.files.logo?.[0] || null;
      const logoBuffer = logo ? logo.buffer : null;

      const mimeType = file.mimetype;

      // ======================================
      // PDF
      // ======================================

      if (mimeType === "application/pdf") {

        const finalPdf =
          await generatePdfWithFooter({
            pdfBuffer: file.buffer,
            logoBuffer,
            companyName,
            email,
            phone,
            reraNumber,
          });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="generated-${Date.now()}.pdf"`
        );
        res.setHeader("Content-Length", finalPdf.length);

        return res.send(Buffer.from(finalPdf));
      }

      // ======================================
      // IMAGE
      // ======================================

      else if (mimeType.startsWith("image/")) {

        const finalImage =
          await generateImageWithFooter({
            imageBuffer: file.buffer,
            logoBuffer,
            companyName,
            email,
            phone,
            reraNumber,
          });

        res.setHeader("Content-Type", "image/png");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="generated-${Date.now()}.png"`
        );
        res.setHeader("Content-Length", finalImage.length);

        return res.send(finalImage);
      }

      // ======================================
      // UNSUPPORTED
      // ======================================

      else {
        return res.status(400).json({
          error: "Unsupported file type. Only PDF and images are supported.",
        });
      }

    } catch (error) {

      console.error(error);

      return res.status(500).json({
        error: error.message,
      });
    }
  }
);

// ==========================================
// HEALTH CHECK
// ==========================================

app.get("/", (req, res) => {
  res.send("File Generation API Running");
});

// ==========================================
// START
// ==========================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});